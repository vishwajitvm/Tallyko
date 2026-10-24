/**
 * Edit one customer email: subject / heading / body / button / accent colour / on-off, with clickable {placeholder}
 * chips and a debounced live preview rendered by the server (the same renderer that sends the real email).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import {
  emailApi, unknownPlaceholders, type EmailPlaceholder, type EmailPreview, type EmailTemplate, type EmailTemplateFields,
} from '@/api/email';
import { Badge, Button, Card, Input, Segmented, Text, toast } from '@/components/ui';
import { confirmTop, promptTop } from '@/features/catalog/dialogs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, FieldRow, Hairline, SettingSwitch } from '../components';
import { EmailPreviewFrame } from './EmailPreviewFrame';

type TextField = 'subject' | 'heading' | 'body' | 'button_text' | 'button_url';

/** Brand colours a shop can pick for the email header and button (email content, not app theme colours). */
export const ACCENT_SWATCHES: { value: string | null; label: string; swatch: string }[] = [
  { value: null, label: 'Tallyko teal (default)', swatch: '#0F766E' },
  { value: '#B45309', label: 'Turmeric', swatch: '#B45309' },
  { value: '#BE123C', label: 'Chilli red', swatch: '#BE123C' },
  { value: '#7C3AED', label: 'Purple', swatch: '#7C3AED' },
  { value: '#1D4ED8', label: 'Blue', swatch: '#1D4ED8' },
  { value: '#15803D', label: 'Green', swatch: '#15803D' },
  { value: '#0F172A', label: 'Charcoal', swatch: '#0F172A' },
];

export function fieldsOf(t: EmailTemplateFields): EmailTemplateFields {
  return {
    subject: t.subject ?? '', heading: t.heading ?? '', body: t.body ?? '', button_text: t.button_text ?? '', button_url: t.button_url ?? '',
    accent_color: t.accent_color ?? null, enabled: t.enabled !== false,
  };
}

function payload(d: EmailTemplateFields): EmailTemplateFields {
  return {
    subject: d.subject.trim(), heading: d.heading.trim(), body: d.body.trim(),
    button_text: d.button_text?.trim() || null, button_url: d.button_url?.trim() || null, accent_color: d.accent_color || null, enabled: d.enabled,
  };
}

export function TemplateEditor({ template, placeholders, canEdit, online, defaultTestTo, emailEnabled, onSaved, onDirtyChange, onBack }: {
  template: EmailTemplate; placeholders: EmailPlaceholder[]; canEdit: boolean; online: boolean; defaultTestTo: string;
  emailEnabled: boolean; onSaved: (t: EmailTemplate) => void; onDirtyChange: (dirty: boolean) => void; onBack: () => void;
}) {
  const { colors, radius } = useTheme();
  const { width, isPhone } = useLayout();
  const [saved, setSaved] = useState<EmailTemplateFields>(() => fieldsOf(template));
  const [draft, setDraft] = useState<EmailTemplateFields>(() => fieldsOf(template));
  const [busy, setBusy] = useState<null | 'save' | 'reset' | 'test'>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const focused = useRef<TextField>('body');
  const selections = useRef<Partial<Record<TextField, { start: number; end: number }>>>({});

  const dirty = JSON.stringify(payload(draft)) !== JSON.stringify(payload(saved));
  useEffect(() => { onDirtyChange(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced live preview of the unsaved draft
  const previewSeq = useRef(0);
  const previewBody = JSON.stringify(payload(draft));
  useEffect(() => {
    if (!online) {
      setPreviewError("You're offline, so the preview can't be refreshed.");
      return undefined;
    }
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const p = payload(draft);
        const result = await emailApi.preview(template.key, {
          subject: p.subject || undefined, heading: p.heading || undefined, body: p.body || undefined,
          button_text: p.button_text ?? '', button_url: p.button_url ?? '', accent_color: p.accent_color ?? '',
        });
        if (seq !== previewSeq.current) return;
        setPreview(result);
        setPreviewError(null);
      } catch (e) {
        if (seq === previewSeq.current) setPreviewError(errorMessage(e));
      } finally {
        if (seq === previewSeq.current) setPreviewLoading(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [previewBody, template.key, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const known = placeholders.map((p) => p.key);
  const unknown = unknownPlaceholders([draft.subject, draft.heading, draft.body, draft.button_text, draft.button_url], known);
  const errors: Partial<Record<TextField, string>> = {};
  if (draft.subject.trim().length < 3) errors.subject = 'Subject needs at least 3 characters.';
  if (!draft.heading.trim()) errors.heading = 'Add a heading.';
  if (!draft.body.trim()) errors.body = 'Write the message.';
  if (draft.button_text?.trim() && !draft.button_url?.trim()) errors.button_url = 'Add the link the button opens, e.g. {store_url}.';
  if (draft.button_url?.trim() && !/^(https?:\/\/|\{[a-z_]+\})/.test(draft.button_url.trim())) errors.button_url = 'Start the link with https:// or use {store_url}.';
  const invalid = Object.keys(errors).length > 0 || unknown.length > 0;
  const show = (k: TextField) => (submitted ? errors[k] : undefined);

  const set = <K extends keyof EmailTemplateFields>(key: K, value: EmailTemplateFields[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const insert = (key: string) => {
    if (!canEdit) return;
    const field = focused.current;
    const token = `{${key}}`;
    const current = (draft[field] ?? '') as string;
    const sel = selections.current[field] ?? { start: current.length, end: current.length };
    const next = current.slice(0, sel.start) + token + current.slice(sel.end);
    set(field, next);
    const pos = sel.start + token.length;
    selections.current[field] = { start: pos, end: pos };
  };

  const trackSel = (field: TextField) => (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selections.current[field] = e.nativeEvent.selection;
  };
  const fieldProps = (field: TextField) => ({
    onFocus: () => { focused.current = field; },
    onSelectionChange: trackSel(field),
    editable: canEdit,
  });

  const save = async () => {
    setSubmitted(true);
    if (invalid) {
      toast.error(unknown.length ? `Unknown placeholder: ${unknown.map((u) => `{${u}}`).join(', ')}` : 'Fix the highlighted fields first.');
      return;
    }
    setBusy('save');
    try {
      const res = await emailApi.save(template.key, payload(draft));
      const next = fieldsOf(res);
      setSaved(next);
      setDraft(next);
      setSubmitted(false);
      onSaved({ ...template, ...res, customised: true });
      toast.success(`${template.label} saved`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    const ok = await confirmTop({ title: 'Reset to the default email?', message: 'Your changes to this email will be replaced with Tallyko\'s default text.', confirmLabel: 'Reset', danger: true });
    if (!ok) return;
    setBusy('reset');
    try {
      const res = await emailApi.reset(template.key);
      const next = fieldsOf({ ...saved, ...res, enabled: res.enabled ?? true, accent_color: res.accent_color ?? null } as EmailTemplateFields);
      setSaved(next);
      setDraft(next);
      onSaved({ ...template, ...next, customised: false });
      toast.success('Reset to default');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    const to = await promptTop({
      title: 'Send a test email', message: dirty ? 'The saved version is sent. Save first to test your latest changes.' : 'Sent with sample customer details.',
      label: 'Send to', placeholder: 'you@example.com', initial: defaultTestTo, confirmLabel: 'Send test',
    });
    if (!to) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
      toast.error('Enter a valid email address.');
      return;
    }
    setBusy('test');
    try {
      const res = await emailApi.test(template.key, to);
      if (res.status === 'failed') toast.error(res.error || 'The email could not be sent.');
      else if (res.status === 'skipped') toast.warning(res.error || 'Email sending is not set up on the server, so it was skipped.');
      else toast.success(`Test email ${res.status === 'sent' ? 'sent' : 'on its way'} to ${to}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const anyBusy = busy !== null;
  const sideBySide = width >= 1280;
  const showEditor = sideBySide || pane === 'edit';
  const showPreview = sideBySide || pane === 'preview';

  const editor = (
    <View style={{ gap: 16, flex: sideBySide ? 1 : undefined, minWidth: 0 }}>
      <Card style={{ gap: 16 }}>
        <SettingSwitch title="Send this email" value={draft.enabled} onValueChange={(v) => set('enabled', v)} disabled={!canEdit}
          subtitle={draft.enabled ? (emailEnabled ? template.description : 'On, but customer emails are turned off for the whole business.') : 'Off. Customers will not get this email.'} />
        <Hairline />
        <Input label="Subject" required value={draft.subject} onChangeText={(t) => set('subject', t)} maxLength={150} error={show('subject')} {...fieldProps('subject')} />
        <Input label="Heading" required value={draft.heading} onChangeText={(t) => set('heading', t)} maxLength={120} error={show('heading')} {...fieldProps('heading')} />
        <Input label="Message" required value={draft.body} onChangeText={(t) => set('body', t)} maxLength={3000} multiline error={show('body')}
          hint={`${draft.body.length}/3000 · Plain text. Blank lines start a new paragraph.`} style={{ minHeight: 180, textAlignVertical: 'top' }} {...fieldProps('body')} />
        <FieldRow>
          <Input label="Button text" value={draft.button_text ?? ''} onChangeText={(t) => set('button_text', t)} maxLength={40} placeholder="Leave empty for no button"
            {...fieldProps('button_text')} />
          <Input label="Button link" value={draft.button_url ?? ''} onChangeText={(t) => set('button_url', t)} maxLength={300} placeholder="{store_url}"
            autoCapitalize="none" autoCorrect={false} error={show('button_url')} {...fieldProps('button_url')} />
        </FieldRow>
        <View style={{ gap: 8 }}>
          <Text variant="smallStrong" tone="muted">Accent colour</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel="Accent colour">
            {ACCENT_SWATCHES.map((s) => {
              const selected = (draft.accent_color ?? null)?.toLowerCase() === (s.value ?? null)?.toLowerCase();
              return (
                <Pressable key={s.label} accessibilityRole="radio" accessibilityLabel={s.label} accessibilityState={{ checked: selected }} disabled={!canEdit}
                  onPress={() => set('accent_color', s.value)}
                  style={[{ width: 44, height: 44, borderRadius: 22, padding: 3, borderWidth: 2, borderColor: selected ? colors.text : 'transparent' },
                    Platform.OS === 'web' && canEdit && ({ cursor: 'pointer' } as any)]}>
                  <View style={{ flex: 1, borderRadius: 18, backgroundColor: s.swatch, alignItems: 'center', justifyContent: 'center' }}>
                    {selected ? <Ionicons name="checkmark" size={18} color={colors.textInverse} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={{ gap: 2 }}>
          <Text variant="bodyStrong">Personalise</Text>
          <Text variant="small" tone="muted">Tap to insert at the cursor in the field you last clicked. They're replaced with each customer's details.</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {placeholders.map((p) => (
            <Pressable key={p.key} onPress={() => insert(p.key)} disabled={!canEdit} accessibilityRole="button" accessibilityLabel={`Insert ${p.description}`}
              style={({ hovered }: any) => [{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1,
                borderColor: colors.border, backgroundColor: hovered ? colors.primarySoft : colors.surfaceAlt, minHeight: 32, justifyContent: 'center' },
              Platform.OS === 'web' && canEdit && ({ cursor: 'copy' } as any)]}>
              <Text variant="small" color={colors.primarySoftText}>{`{${p.key}}`}</Text>
            </Pressable>
          ))}
        </View>
        {unknown.length ? (
          <Callout tone="danger" title="Unknown placeholder">
            {`${unknown.map((u) => `{${u}}`).join(', ')} won't be filled in. Check the spelling or pick one of the chips above.`}
          </Callout>
        ) : null}
      </Card>
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button title="All emails" icon="arrow-back" variant="ghost" size="sm" onPress={onBack} style={{ marginLeft: -8 }} />
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h2">{template.label}</Text>
            <Badge label={template.customised ? 'Customised' : 'Default text'} tone={template.customised ? 'primary' : 'neutral'} />
            {!draft.enabled ? <Badge label="Off" tone="warning" /> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button title={isPhone ? undefined : 'Send test'} icon="paper-plane-outline" variant="secondary" size="sm" onPress={sendTest}
            loading={busy === 'test'} disabled={anyBusy || !online || !canEdit} accessibilityLabel="Send a test email" />
          {template.customised && canEdit ? (
            <Button title={isPhone ? undefined : 'Reset to default'} icon="refresh" variant="secondary" size="sm" onPress={reset}
              loading={busy === 'reset'} disabled={anyBusy || !online} accessibilityLabel="Reset to default" />
          ) : null}
          {canEdit && dirty ? (
            <Button title="Save" icon="checkmark" size="sm" onPress={save} loading={busy === 'save'} disabled={anyBusy || !online} />
          ) : null}
        </View>
      </View>

      {!sideBySide ? (
        <Segmented<'edit' | 'preview'> value={pane} onChange={setPane}
          options={[{ value: 'edit', label: 'Edit', icon: 'create-outline' }, { value: 'preview', label: 'Preview', icon: 'eye-outline' }]} />
      ) : null}

      <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
        {showEditor ? editor : null}
        {showPreview ? (
          <View style={{ flex: sideBySide ? 1 : undefined, width: sideBySide ? undefined : '100%', minWidth: 0, gap: 8 }}>
            <EmailPreviewFrame preview={preview} loading={previewLoading} error={previewError} height={sideBySide ? 720 : 560} />
            <Text variant="small" tone="subtle">Sample customer “Priya”. Real emails use each customer's details and your business name, address and phone.</Text>
          </View>
        ) : null}
      </View>

      {canEdit && dirty ? (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button title="Discard" variant="secondary" onPress={() => { setDraft(saved); setSubmitted(false); }} disabled={anyBusy} />
          <Button title="Save email" icon="checkmark" onPress={save} loading={busy === 'save'} disabled={anyBusy || !online} />
        </View>
      ) : null}
    </View>
  );
}
