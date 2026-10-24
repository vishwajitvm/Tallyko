/**
 * Live-screen plumbing (first used by Tables, Kitchen and Online orders) (docs/20_High_Volume_UX.md §2.5):
 * polling that pauses while the page/app is hidden or the screen is not focused, a clock that
 * keeps timers current, per-device preferences (sound, density) and a Web Audio beep.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorMessage } from '@/api/client';

/** True while the browser tab is visible / the app is in the foreground. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') return document.visibilityState !== 'hidden';
    return AppState.currentState !== 'background';
  });
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return undefined;
      const update = () => setVisible(document.visibilityState !== 'hidden');
      document.addEventListener('visibilitychange', update);
      return () => document.removeEventListener('visibilitychange', update);
    }
    const sub = AppState.addEventListener('change', (s) => setVisible(s === 'active'));
    return () => sub.remove();
  }, []);
  return visible;
}

/** True while this route is focused (expo-router). */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
}

/**
 * Fetch now, then every `intervalMs` while the screen is focused and visible.
 * Coming back (tab shown, app resumed, screen focused) refreshes at once. Keeps the last good data on errors.
 */
export function useLivePoll<T>(fetcher: () => Promise<T>, deps: unknown[], intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const gen = useRef(0);
  const visible = usePageVisible();
  const focused = useScreenFocused();
  const live = visible && focused;

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'silent' && inFlight.current) return;
    const my = mode === 'initial' ? ++gen.current : gen.current;
    inFlight.current = true;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const result = await fetcherRef.current();
      if (!mounted.current || my !== gen.current) return;
      setData(result);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (mounted.current && my === gen.current) setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      if (mounted.current && my === gen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void load('initial');
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const wasLive = useRef(live);
  useEffect(() => {
    if (!live) { wasLive.current = false; return undefined; }
    if (!wasLive.current) void load('silent');
    wasLive.current = true;
    const id = setInterval(() => void load('silent'), intervalMs);
    return () => clearInterval(id);
  }, [live, intervalMs, load]);

  return {
    data, setData, error, loading, refreshing, updatedAt, live,
    reload: () => load('refresh'),
    silentReload: () => load('silent'),
  };
}

/** Re-renders every `ms` while visible so age timers stay current. */
export function useNow(ms = 15_000): number {
  const visible = usePageVisible();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, visible]);
  return now;
}

/** A small preference remembered on this device (sound on/off, tile size). */
export function useDevicePref<T extends string | boolean | number>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(`tallyko.ops.${key}`)
      .then((raw) => {
        if (!alive || raw === null) return;
        try { setValue(JSON.parse(raw) as T); } catch { /* ignore bad value */ }
      })
      .catch(() => { /* storage unavailable: keep the default */ });
    return () => { alive = false; };
  }, [key]);
  const set = useCallback((v: T) => {
    setValue(v);
    AsyncStorage.setItem(`tallyko.ops.${key}`, JSON.stringify(v)).catch(() => { /* ignore */ });
  }, [key]);
  return [value, set];
}

let audioCtx: any = null;

/**
 * Short alert on web (Web Audio, no files): `kitchen` = two quick high beeps, `online` = rising two-note chime.
 * Browsers only allow sound after the user has interacted with the page once; it fails silently before that.
 */
export function playAlert(kind: 'kitchen' | 'online' = 'online') {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume?.();
    const notes = kind === 'kitchen' ? [[1046.5, 0], [1046.5, 0.18]] : [[880, 0], [1318.5, 0.22]];
    for (const [freq, delay] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + delay;
      o.type = kind === 'kitchen' ? 'square' : 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'kitchen' ? 0.12 : 0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    }
  } catch {
    /* audio blocked — ignore */
  }
}
