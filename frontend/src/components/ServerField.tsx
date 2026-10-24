import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { healthApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import { defaultServerUrl, normaliseServerUrl, usePrefs } from '@/store/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Text } from './ui';

/**
 * App builds can point at any Tallyko server (cloud, or a PC on the shop's Wi-Fi).
 * Hidden on the web app, which always talks to the server it was loaded from.
 */
export function ServerField() {
  const { colors } = useTheme();
  const serverUrl = usePrefs((s) => s.serverUrl);
  const setPrefs = usePrefs((s) => s.set);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(serverUrl ?? defaultServerUrl());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);

  if (Platform.OS === 'web' && !process.env.EXPO_PUBLIC_ALLOW_SERVER_CHANGE) return null;

  const test = async () => {
    const url = normaliseServerUrl(value);
    setChecking(true);
    setStatus(null);
    try {
      const health = await healthApi.check(url);
      setPrefs({ serverUrl: url });
      setValue(url);
      setStatus({ ok: true, text: `Connected · Tallyko ${health.version}` });
    } catch (e) {
      setStatus({ ok: false, text: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
        <Ionicons name="server-outline" size={16} color={colors.textMuted} />
        <Text variant="small" tone="muted">Server: {(serverUrl ?? defaultServerUrl()).replace(/\/api\/v1$/, '')}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          <Input label="Server address" value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url"
            placeholder="https://pos.yourshop.com or 192.168.1.20:8000" hint="Ask whoever set up Tallyko for your shop." />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Test & save" size="sm" onPress={test} loading={checking} icon="pulse-outline" />
            <Button title="Reset" size="sm" variant="ghost" onPress={() => { setPrefs({ serverUrl: null }); setValue(defaultServerUrl()); setStatus(null); }} />
          </View>
          {status ? <Text variant="small" tone={status.ok ? 'success' : 'danger'}>{status.text}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
