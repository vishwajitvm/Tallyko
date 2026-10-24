/**
 * Keyboard shortcuts for desktop web (docs/20_High_Volume_UX.md §1.5). No-op on native.
 *
 *   useHotkeys({
 *     F8: pay,
 *     'Ctrl+Enter': pay,
 *     F9: sendKot,
 *     '/': () => searchRef.current?.focus(),
 *     Escape: close,
 *     '+': () => changeQty(1),
 *     '-': () => changeQty(-1),
 *     ArrowDown: { handler: next, repeat: true },
 *   }, [pay, sendKot], { enabled: isFocused });
 *
 * While the user is typing in an input/textarea/select/contenteditable, only "global" bindings fire:
 * F-keys, Escape and any combo with Ctrl/Alt/Meta are global by default; pass `{ global: true|false }` to override.
 * A handler that returns `false` lets the browser's default action happen; otherwise the event is prevented.
 * `Ctrl` also matches the Cmd key so Ctrl+Enter works as Cmd+Enter on a Mac. `Mod` is an alias of `Ctrl`.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export type HotkeyHandler = (event: KeyboardEvent) => void | boolean;
export interface HotkeyBinding {
  handler: HotkeyHandler;
  /** Fire even while typing in an input. */
  global?: boolean;
  /** Fire on auto-repeat (key held down). Default true for arrows and +/-, false otherwise. */
  repeat?: boolean;
  /** Skip this binding without re-registering. */
  enabled?: boolean;
}
export type HotkeyMap = Record<string, HotkeyHandler | HotkeyBinding | undefined | null | false>;
export interface HotkeyOptions {
  enabled?: boolean;
  /**
   * Priority map (open menus/sheets): runs before every other map and stops them from seeing the keys it handles.
   */
  capture?: boolean;
}

export interface ParsedCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape', return: 'enter', space: ' ', spacebar: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
  plus: '+', minus: '-', del: 'delete', slash: '/', add: '+', subtract: '-',
};

function normaliseKey(key: string): string {
  const k = key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

/** Parse "Ctrl+Enter", "F8", "+", "Shift+ArrowDown". A lone "+" is the plus key. */
export function parseCombo(combo: string): ParsedCombo {
  const trimmed = combo.trim();
  let parts: string[];
  if (trimmed === '+') parts = ['+'];
  else if (trimmed.endsWith('++')) parts = [...trimmed.slice(0, -2).split('+'), '+'];
  else parts = trimmed.split('+');
  const out: ParsedCombo = { key: '', ctrl: false, alt: false, shift: false, meta: false };
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (p === 'ctrl' || p === 'control' || p === 'mod' || p === 'cmd') out.ctrl = true;
    else if (p === 'alt' || p === 'option') out.alt = true;
    else if (p === 'shift') out.shift = true;
    else if (p === 'meta' || p === 'win') out.meta = true;
    else out.key = normaliseKey(raw.trim());
  }
  return out;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

/** True when a printable symbol (e.g. "+", "/", "?") whose Shift state depends on the keyboard layout. */
function isSymbol(key: string) {
  return key.length === 1 && !/[a-z0-9 ]/i.test(key);
}

export function matchesCombo(combo: ParsedCombo, e: KeyEventLike): boolean {
  if (!e.key) return false;
  const key = normaliseKey(e.key);
  if (key !== combo.key) return false;
  if (combo.meta) {
    if (!e.metaKey || combo.ctrl !== !!e.ctrlKey) return false;
  } else if (combo.ctrl !== (!!e.ctrlKey || !!e.metaKey)) {
    return false;
  }
  if (combo.alt !== !!e.altKey) return false;
  // "+" is Shift+= on most layouts but plain "+" on the numpad: ignore Shift for symbols unless asked for.
  if (!isSymbol(combo.key) || combo.shift) {
    if (combo.shift !== !!e.shiftKey) return false;
  }
  return true;
}

/** F1–F12, Escape and any modifier combo fire even while typing. */
export function isGlobalByDefault(combo: ParsedCombo): boolean {
  return /^f([1-9]|1[0-2])$/.test(combo.key) || combo.key === 'escape' || combo.ctrl || combo.alt || combo.meta;
}

function repeatsByDefault(combo: ParsedCombo): boolean {
  return combo.key.startsWith('arrow') || combo.key === '+' || combo.key === '-';
}

interface TargetLike { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null; type?: string }

/** True when the event target is a text-entry element (where plain keys must type, not trigger shortcuts). */
export function isTypingTarget(target: unknown): boolean {
  const t = target as TargetLike | null;
  if (!t || typeof t !== 'object') return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t.type ?? 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

/** True when Enter/Space would activate the focused control (button, link, checkbox…): leave those keys to it. */
export function isActivationTarget(target: unknown): boolean {
  const t = target as TargetLike | null;
  if (!t || typeof t !== 'object') return false;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'BUTTON' || tag === 'A') return true;
  const role = t.getAttribute?.('role') ?? '';
  return ['button', 'link', 'checkbox', 'menuitem', 'tab', 'radio', 'switch', 'option'].includes(role);
}

interface CompiledBinding { combo: ParsedCombo; binding: HotkeyBinding }

export function compileHotkeys(map: HotkeyMap): CompiledBinding[] {
  const out: CompiledBinding[] = [];
  for (const [combo, value] of Object.entries(map)) {
    if (!value) continue;
    const binding: HotkeyBinding = typeof value === 'function' ? { handler: value } : value;
    if (binding.enabled === false) continue;
    // "F2|/" or "F2, /" binds several combos to one handler.
    for (const c of combo.split(/\s*[|,]\s*/)) if (c) out.push({ combo: parseCombo(c), binding });
  }
  return out;
}

/** Pure dispatcher (exported for tests): returns the binding that should handle this event, if any. */
export function findBinding(bindings: CompiledBinding[], e: KeyEventLike & { target?: unknown; repeat?: boolean; isComposing?: boolean }): CompiledBinding | undefined {
  if (e.isComposing) return undefined;
  const typing = isTypingTarget(e.target);
  const activating = isActivationTarget(e.target);
  return bindings.find(({ combo, binding }) => {
    if (!matchesCombo(combo, e)) return false;
    const global = binding.global ?? isGlobalByDefault(combo);
    if (typing && !global) return false;
    if (activating && !global && (combo.key === 'enter' || combo.key === ' ')) return false;
    if (e.repeat && !(binding.repeat ?? repeatsByDefault(combo))) return false;
    return true;
  });
}

export function useHotkeys(map: HotkeyMap, deps: unknown[] = [], options: HotkeyOptions = {}) {
  const { enabled = true, capture = false } = options;
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const match = findBinding(compileHotkeys(mapRef.current), event);
      if (!match) return;
      const result = match.binding.handler(event);
      if (result !== false) {
        event.preventDefault();
        if (capture) event.stopPropagation();
      }
    };
    // Always the capture phase: react-native-web's TextInput stops keydown propagation, so a bubbling
    // listener would never see F8/Esc pressed in the search box. Priority maps listen on window (captured
    // first), normal maps on document.
    const target: Window | Document = capture ? window : document;
    target.addEventListener('keydown', onKeyDown as EventListener, true);
    return () => target.removeEventListener('keydown', onKeyDown as EventListener, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, capture, ...deps]);
}

const isMac = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** Human label for a combo: "Ctrl+Enter" → "Ctrl+↵" (or "⌘↵" on a Mac), "ArrowDown" → "↓". */
export function formatShortcut(combo: string, mac = isMac()): string {
  const first = combo.split(/\s*[|,]\s*/)[0] ?? combo;
  // Key sequences ("g b" = press G, then B) show every step the same way
  if (/\S\s+\S/.test(first.trim()) && !/[+]/.test(first)) {
    return first.trim().split(/\s+/).map((part) => formatShortcut(part, mac)).join(' ');
  }
  const c = parseCombo(first);
  const names: Record<string, string> = {
    enter: '↵', escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', ' ': 'Space',
    backspace: '⌫', delete: 'Del', tab: 'Tab', '/': '/', '+': '+', '-': '−',
  };
  const key = names[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1));
  const mods = [c.ctrl ? (mac ? '⌘' : 'Ctrl') : '', c.alt ? (mac ? '⌥' : 'Alt') : '', c.shift ? (mac ? '⇧' : 'Shift') : '', c.meta && !c.ctrl ? (mac ? '⌘' : 'Win') : '']
    .filter(Boolean);
  return [...mods, key].join(mac ? '' : '+');
}
