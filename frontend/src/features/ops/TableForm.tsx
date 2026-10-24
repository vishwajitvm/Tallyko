import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Input, Segmented, Sheet, Text, toast } from '@/components/ui';
import { tablesApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { TableInfo } from '@/api/types';
import { ChipRow } from './common';

type Mode = 'one' | 'range';

/** Add one table, add a numbered range (T1–T10), or edit an existing table. */
export function TableForm({ visible, onClose, editing, sections, existing, onSaved }: {
  visible: boolean; onClose: () => void; editing: TableInfo | null; sections: string[]; existing: TableInfo[]; onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>('one');
  const [number, setNumber] = useState('');
  const [section, setSection] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [prefix, setPrefix] = useState('T');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setMode('one');
    setErrors({});
    setNumber(editing?.table_number ?? '');
    setSection(editing?.section ?? '');
    setCapacity(String(editing?.capacity ?? 4));
    setPrefix('T');
    const nums = existing.map((t) => parseInt(t.table_number.replace(/\D/g, ''), 10)).filter((n) => Number.isFinite(n));
    const start = nums.length ? Math.max(...nums) + 1 : 1;
    setFrom(String(start));
    setTo(String(start + 9));
    // Only reset when the sheet opens — background table refreshes must not wipe what the user typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing?.id]);

  const cap = parseInt(capacity, 10);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!Number.isFinite(cap) || cap < 1 || cap > 100) e.capacity = 'Seats must be between 1 and 100';
    if (mode === 'one') {
      const n = number.trim();
      if (!n) e.number = 'Enter a table number or name';
      else if (n.length > 20) e.number = 'Keep it under 20 characters';
      else if (existing.some((t) => t.id !== editing?.id && t.table_number.toLowerCase() === n.toLowerCase())) e.number = `Table ${n} already exists`;
    } else {
      const a = parseInt(from, 10);
      const b = parseInt(to, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) e.range = 'Enter a valid range, e.g. 1 to 10';
      else if (b - a + 1 > 50) e.range = 'Add up to 50 tables at a time';
    }
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    try {
      const body = { section: section.trim() || null, capacity: cap };
      if (editing) {
        await tablesApi.update(editing.id, { ...body, table_number: number.trim() });
        toast.success(`Table ${number.trim()} updated`);
      } else if (mode === 'one') {
        await tablesApi.create({ ...body, table_number: number.trim() });
        toast.success(`Table ${number.trim()} added`);
      } else {
        let created = 0;
        const skipped: string[] = [];
        for (let n = parseInt(from, 10); n <= parseInt(to, 10); n += 1) {
          const label = `${prefix.trim()}${n}`;
          if (existing.some((t) => t.table_number.toLowerCase() === label.toLowerCase())) {
            skipped.push(label);
            continue;
          }
          try {
            await tablesApi.create({ ...body, table_number: label });
            created += 1;
          } catch (err) {
            if (err instanceof ApiError && err.status === 409) skipped.push(label);
            else throw err;
          }
        }
        toast.success(`${created} table${created === 1 ? '' : 's'} added${skipped.length ? ` · ${skipped.length} already existed` : ''}`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
      onSaved(); // a range may have partly succeeded
    } finally {
      setSaving(false);
    }
  };

  const preview = mode === 'range' && parseInt(to, 10) >= parseInt(from, 10)
    ? `${prefix.trim()}${from}, ${prefix.trim()}${parseInt(from, 10) + 1}${parseInt(to, 10) - parseInt(from, 10) > 1 ? ` … ${prefix.trim()}${to}` : ''}`
    : null;

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? `Edit table ${editing.table_number}` : 'Add tables'} width={480}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={editing ? 'Save' : mode === 'range' ? 'Add tables' : 'Add table'} onPress={save} loading={saving} />
        </View>
      }>
      {!editing ? (
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'one', label: 'One table' }, { value: 'range', label: 'Several at once' }]} />
      ) : null}
      {mode === 'one' ? (
        <Input label="Table number or name" required value={number} onChangeText={setNumber} placeholder="e.g. T5, 12, Patio 2" maxLength={20}
          error={errors.number} autoFocus={!editing} autoCapitalize="characters" />
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Input label="Prefix" value={prefix} onChangeText={setPrefix} placeholder="T" maxLength={8} containerStyle={{ flex: 1 }} autoCapitalize="characters" />
            <Input label="From" value={from} onChangeText={(v) => setFrom(v.replace(/\D/g, ''))} keyboardType="number-pad" containerStyle={{ flex: 1 }} maxLength={4} />
            <Input label="To" value={to} onChangeText={(v) => setTo(v.replace(/\D/g, ''))} keyboardType="number-pad" containerStyle={{ flex: 1 }} maxLength={4} />
          </View>
          {errors.range ? <Text variant="small" tone="danger">{errors.range}</Text> : preview ? <Text variant="small" tone="subtle">Creates {preview}</Text> : null}
        </View>
      )}
      <View style={{ gap: 8 }}>
        <Input label="Section" value={section} onChangeText={setSection} placeholder="e.g. Ground floor, Terrace, AC hall" maxLength={40}
          hint="Tables are grouped by section on the floor view" />
        {sections.length ? (
          <ChipRow>
            {sections.map((s) => <Chip key={s} label={s} selected={section.trim() === s} onPress={() => setSection(section.trim() === s ? '' : s)} />)}
          </ChipRow>
        ) : null}
      </View>
      <Input label="Seats" value={capacity} onChangeText={(v) => setCapacity(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3}
        error={errors.capacity} containerStyle={{ maxWidth: 160 }} />
    </Sheet>
  );
}
