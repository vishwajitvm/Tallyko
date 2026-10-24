/**
 * Confirm / prompt dialogs that can open on top of another Sheet.
 *
 * The shared `confirm()` / `prompt()` host is mounted once at app start. On web, react-native-web
 * creates a Modal's portal node when the Modal *mounts*, so that early host sits underneath any
 * Sheet opened later and its dialogs are hidden behind it. This host only mounts its Sheet while a
 * dialog is open, so the dialog's portal is always the newest (top-most) one.
 * Render <TopDialogHost /> once per screen; call confirmTop() / promptTop() anywhere.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import { Button, Input, Sheet, Text } from '@/components/ui';

interface DialogState {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  danger: boolean;
  prompt?: { label?: string; placeholder?: string; initial?: string; maxLength?: number };
  resolve?: (v: string | boolean | null) => void;
}

const useTopDialog = create<DialogState>(() => ({ open: false, title: '', confirmLabel: 'Confirm', danger: false }));

export function confirmTop(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useTopDialog.getState().resolve?.(null);
    useTopDialog.setState({
      open: true, title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel ?? 'Confirm', danger: !!opts.danger, prompt: undefined,
      resolve: (v) => resolve(v === true),
    });
  });
}

export function promptTop(opts: { title: string; message?: string; confirmLabel?: string; label?: string; placeholder?: string; initial?: string; maxLength?: number }): Promise<string | null> {
  return new Promise((resolve) => {
    useTopDialog.getState().resolve?.(null);
    useTopDialog.setState({
      open: true, title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel ?? 'Save', danger: false,
      prompt: { label: opts.label, placeholder: opts.placeholder, initial: opts.initial, maxLength: opts.maxLength },
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    });
  });
}

export function TopDialogHost() {
  const open = useTopDialog((s) => s.open);
  // Screens stay mounted under a pushed screen / inactive tab: only the focused one shows dialogs
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  // Mount only while open so the portal is created last (see file comment)
  return open && focused ? <TopDialog /> : null;
}

function TopDialog() {
  const state = useTopDialog();
  const [value, setValue] = useState(state.prompt?.initial ?? '');
  useEffect(() => () => {
    // Unmounted without an answer (screen left): settle the promise
    const s = useTopDialog.getState();
    if (s.open) {
      s.resolve?.(null);
      useTopDialog.setState({ open: false, resolve: undefined });
    }
  }, []);
  const close = (result: string | boolean | null) => {
    const resolve = state.resolve;
    useTopDialog.setState({ open: false, resolve: undefined });
    resolve?.(result);
  };
  const valid = !state.prompt || value.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    close(state.prompt ? value.trim() : true);
  };
  return (
    <Sheet visible onClose={() => close(null)} title={state.title} width={440}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={() => close(null)} />
          <Button title={state.confirmLabel} variant={state.danger ? 'danger' : 'primary'} disabled={!valid} onPress={submit} />
        </View>
      }>
      {state.message ? <Text tone="muted">{state.message}</Text> : null}
      {state.prompt ? (
        <Input autoFocus label={state.prompt.label} placeholder={state.prompt.placeholder} value={value} onChangeText={setValue}
          maxLength={state.prompt.maxLength} onSubmitEditing={submit} />
      ) : null}
    </Sheet>
  );
}
