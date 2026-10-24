import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { Brand } from '@/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, SectionTitle, Text, confirm, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout } from './components';

export default function BrandsScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (!can(role, 'manage')) {
    return (
      <SettingsFrame active="brands" title="Brands">
        <EmptyState icon="lock-closed-outline" title="Managers only" message="Ask the owner or a manager to manage brands." />
      </SettingsFrame>
    );
  }
  return <BrandsList />;
}

function syncCache(list: Brand[]) {
  useData.setState({ brands: list });
}

function BrandsList() {
  const { isPhone } = useLayout();
  const businessType = useData((s) => s.settings?.business_type);
  const { data, error, loading, reload, refreshing, setData } = useApi(() => adminApi.brands(), []);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const brands = data ?? [];
  const active = brands.filter((b) => b.is_active);
  const inactive = brands.filter((b) => !b.is_active);

  const replace = (b: Brand) => {
    const next = brands.some((x) => x.id === b.id) ? brands.map((x) => (x.id === b.id ? b : x)) : [...brands, b];
    next.sort((a, c) => a.name.localeCompare(c.name));
    setData(next);
    syncCache(next);
  };

  const add = async () => {
    const n = name.trim();
    if (!n) return setNameError('Enter a brand name.');
    if (n.length > 60) return setNameError('Use 60 characters or fewer.');
    if (brands.some((b) => b.name.toLowerCase() === n.toLowerCase())) return setNameError('You already have a brand with this name.');
    setAdding(true);
    try {
      const created = await adminApi.createBrand(n);
      replace(created);
      setName('');
      setNameError(null);
      toast.success(`${created.name} added`);
    } catch (e) {
      setNameError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <SettingsFrame active="brands" title="Brands" subtitle="Run several delivery brands from one kitchen." refreshing={refreshing} onRefresh={reload}>
      <Callout tone="neutral" icon="bulb-outline" title="What are virtual brands?">
        {`Cloud kitchens often sell under more than one name, for example "Biryani Box" and "Wrap Republic", each with its own Swiggy/Zomato listing. Add each brand here, assign menu items to it, and pick the brand on an order. Kitchen tickets and reports then show which brand an order belongs to.${businessType && businessType !== 'cloud_kitchen' ? ' Single-brand shops can skip this.' : ''}`}
      </Callout>

      <Card style={{ gap: 10 }}>
        <Text variant="h3">Add a brand</Text>
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 10, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
          <Input containerStyle={{ flex: 1 }} value={name} onChangeText={(v) => { setName(v); setNameError(null); }} placeholder="Brand name, e.g. Biryani Box"
            accessibilityLabel="New brand name" maxLength={60} error={nameError} onSubmitEditing={add} returnKeyType="done" />
          <Button title="Add brand" icon="add" onPress={add} loading={adding} disabled={!name.trim()} />
        </View>
      </Card>

      {loading && !data ? <Loading label="Loading brands" /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}

      {data && brands.length === 0 ? (
        <Card><EmptyState icon="pricetags-outline" title="No brands yet" message="Your business name is used on every order. Add brands only if you sell under more than one name." /></Card>
      ) : null}

      {active.length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle title={`Active · ${active.length}`} />
          <Card padded={false}>
            {active.map((b, i) => <BrandRow key={b.id} brand={b} first={i === 0} brands={brands} onSaved={replace} />)}
          </Card>
        </View>
      ) : null}

      {inactive.length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle title={`Inactive · ${inactive.length}`} />
          <Card padded={false}>
            {inactive.map((b, i) => <BrandRow key={b.id} brand={b} first={i === 0} brands={brands} onSaved={replace} />)}
          </Card>
        </View>
      ) : null}
    </SettingsFrame>
  );
}

function BrandRow({ brand, first, brands, onSaved }: { brand: Brand; first: boolean; brands: Brand[]; onSaved: (b: Brand) => void }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(brand.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = async (body: { name: string; is_active: boolean }, success: string) => {
    setBusy(true);
    try {
      const saved = await adminApi.updateBrand(brand.id, body);
      onSaved(saved);
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const n = value.trim();
    if (!n) return setError('Enter a brand name.');
    if (brands.some((b) => b.id !== brand.id && b.name.toLowerCase() === n.toLowerCase())) return setError('Another brand already has this name.');
    if (n === brand.name) return setEditing(false);
    if (await update({ name: n, is_active: brand.is_active }, 'Brand renamed')) setEditing(false);
  };

  const toggleActive = async () => {
    if (brand.is_active) {
      const ok = await confirm({
        title: `Deactivate ${brand.name}?`,
        message: 'It is hidden when taking new orders. Past orders and reports keep the brand name. You can turn it back on any time.',
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    await update({ name: brand.name, is_active: !brand.is_active }, brand.is_active ? `${brand.name} deactivated` : `${brand.name} is active again`);
  };

  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider, paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
      {editing ? (
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 8, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
          <Input containerStyle={{ flex: 1 }} autoFocus value={value} onChangeText={(v) => { setValue(v); setError(null); }} maxLength={60}
            error={error} accessibilityLabel="Brand name" onSubmitEditing={rename} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Cancel" variant="secondary" onPress={() => { setEditing(false); setValue(brand.name); setError(null); }} disabled={busy} />
            <Button title="Save" onPress={rename} loading={busy} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: brand.is_active ? colors.accentSoft : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="pricetag" size={16} color={brand.is_active ? colors.accentText : colors.textSubtle} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" tone={brand.is_active ? 'default' : 'muted'} numberOfLines={1}>{brand.name}</Text>
          </View>
          {!brand.is_active ? <Badge label="Inactive" /> : null}
          <Button icon="create-outline" variant="ghost" size="sm" accessibilityLabel={`Rename ${brand.name}`} onPress={() => setEditing(true)} disabled={busy} />
          <Button title={brand.is_active ? 'Deactivate' : 'Activate'} variant={brand.is_active ? 'ghost' : 'soft'} size="sm" onPress={toggleActive} loading={busy} />
        </View>
      )}
    </View>
  );
}
