import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation, type Href } from 'expo-router';
import { catalogApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { MenuScanResult } from '@/api/types';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, Card, IconButton, Screen, Text, toast } from '@/components/ui';
import { TopDialogHost, confirmTop } from '../dialogs';
import { can, useRole } from '@/store/auth';
import { useData } from '@/store/data';
import { syncNow, useNet } from '@/lib/sync';
import { NoAccess } from '../components';
import { kitchenDefault, plural } from '../utils';
import { MAX_PHOTOS, PickError, buildMenuForm, pickPhotos, preparePhoto, releasePhoto, type MenuPhoto, type PickSource } from './photos';
import { blankRow, existingNameSet, rowsFromScan, toImportItems, type ReviewRow } from './review';
import { ReviewStep, type ImportOptions } from './ReviewStep';

type Step = 'pick' | 'reading' | 'review' | 'done';
interface ScanError { title: string; message: string; icon: keyof typeof Ionicons.glyphMap }

export function MenuScanScreen() {
  const role = useRole();
  if (!can(role, 'manage')) {
    return (
      <Screen title="Scan menu photo">
        <NoAccess title="Only owners and managers can import a menu" message="Ask your owner or manager to scan the menu." />
      </Screen>
    );
  }
  return <MenuScanFlow />;
}

function MenuScanFlow() {
  const { colors } = useTheme();
  const { isPhone, isWide } = useLayout();
  const navigation = useNavigation();
  const settings = useData((s) => s.settings);
  const online = useNet((s) => s.online);

  const [step, setStep] = useState<Step>('pick');
  const [photos, setPhotos] = useState<MenuPhoto[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [error, setError] = useState<ScanError | null>(null);
  const [scan, setScan] = useState<MenuScanResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [options, setOptions] = useState<ImportOptions>(() => ({
    taxRate: null,
    printToKitchen: kitchenDefault(settings?.business_type),
    applyVeg: settings?.business_type !== 'retail',
  }));
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: string[] } | null>(null);
  const [existingNames, setExistingNames] = useState<Set<string>>(() => existingNameSet(useData.getState().products));
  const [existingCategories, setExistingCategories] = useState<string[]>(() => useData.getState().categories.filter((c) => c.is_active).map((c) => c.name));
  const runId = useRef(0);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Fresh product names for duplicate detection (cache is the fallback)
  useEffect(() => {
    let alive = true;
    catalogApi.products().then((p) => { if (alive) setExistingNames(existingNameSet(p)); }).catch(() => {});
    catalogApi.categories().then((c) => { if (alive) setExistingCategories(c.map((x) => x.name)); }).catch(() => {});
    return () => {
      alive = false;
      photosRef.current.forEach((p) => releasePhoto(p));
    };
  }, []);

  // Don't lose a reviewed list to an accidental back press
  const unsaved = step === 'review' && rows.length > 0 && !importing;
  useEffect(() => {
    if (!unsaved) return undefined;
    const sub = navigation.addListener('beforeRemove' as any, (e: any) => {
      e.preventDefault();
      void confirmTop({ title: 'Leave without importing?', message: 'The items you reviewed will be lost.', confirmLabel: 'Leave', danger: true })
        .then((ok) => { if (ok) navigation.dispatch(e.data.action); });
    });
    return sub;
  }, [navigation, unsaved]);

  const addPhotos = async (source: PickSource) => {
    setError(null);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return toast.info(`You can add up to ${MAX_PHOTOS} photos at a time.`);
    try {
      const assets = await pickPhotos(source, remaining);
      if (!assets.length) return;
      setPreparing(assets.length);
      const prepared: MenuPhoto[] = [];
      for (let i = 0; i < assets.length; i++) {
        prepared.push(await preparePhoto(assets[i]!, photos.length + i));
        setPreparing(assets.length - i - 1);
      }
      setPhotos((list) => [...list, ...prepared].slice(0, MAX_PHOTOS));
    } catch (e) {
      if (e instanceof PickError) setError({ title: 'Permission needed', message: e.message, icon: 'lock-closed-outline' });
      else toast.error(errorMessage(e, 'Could not open the photo.'));
    } finally {
      setPreparing(0);
    }
  };

  const removePhoto = (key: string) => setPhotos((list) => {
    const gone = list.find((p) => p.key === key);
    if (gone) releasePhoto(gone);
    return list.filter((p) => p.key !== key);
  });

  const read = async () => {
    if (!photos.length || photos.some((p) => p.error)) return;
    if (!online) {
      setError({ title: 'You are offline', message: 'Reading a menu photo needs an internet connection. Connect to the internet and try again — or add items by hand.', icon: 'cloud-offline-outline' });
      return;
    }
    setError(null);
    const id = ++runId.current;
    setStep('reading');
    try {
      const form = await buildMenuForm(photos);
      const res = await catalogApi.scanMenu(form);
      if (id !== runId.current) return; // cancelled
      setScan(res);
      if (!res.items.length) {
        setError({
          title: 'No menu items found',
          message: 'We could not find item names with prices in these photos. Try a sharper, well-lit photo taken straight on with the whole page in frame. Printed English menus work best — handwritten or Hindi text is not read yet.',
          icon: 'search-outline',
        });
        setStep('pick');
        return;
      }
      setRows(rowsFromScan(res.items, existingNames, existingCategories));
      setStep('review');
    } catch (e) {
      if (id !== runId.current) return;
      setError(describeError(e));
      setStep('pick');
    }
  };

  const cancelRead = () => {
    runId.current += 1;
    setStep('pick');
    toast.info('Stopped reading the menu.');
  };

  const typeInstead = () => {
    setScan(null);
    setRows([blankRow()]);
    setError(null);
    setStep('review');
  };

  const doImport = async () => {
    const items = toImportItems(rows, { taxRate: options.taxRate, applyVeg: options.applyVeg });
    if (!items.length) return;
    setImporting(true);
    try {
      let created = 0;
      const skipped: string[] = [];
      for (let i = 0; i < items.length; i += 500) {
        const r = await catalogApi.bulkImport(items.slice(i, i + 500), options.printToKitchen);
        created += r.created;
        skipped.push(...r.skipped);
      }
      setResult({ created, skipped });
      setStep('done');
      void syncNow();
    } catch (e) {
      toast.error(describeError(e).message);
    } finally {
      setImporting(false);
    }
  };

  const restart = () => {
    photos.forEach((p) => releasePhoto(p));
    setPhotos([]);
    setRows([]);
    setScan(null);
    setResult(null);
    setError(null);
    setStep('pick');
    catalogApi.products().then((p) => setExistingNames(existingNameSet(p))).catch(() => {});
    catalogApi.categories().then((c) => setExistingCategories(c.map((x) => x.name))).catch(() => {});
  };

  const back = () => {
    // Pop back to the menu list when we were pushed from it; otherwise (deep link / refresh) replace
    const stack = navigation.getState();
    if (stack && stack.index > 0) navigation.goBack();
    else router.replace('/menu' as Href);
  };

  const subtitle = {
    pick: 'Photograph your printed menu — we read the items and prices for you',
    reading: 'This usually takes 5–30 seconds',
    review: 'Check the list, fix anything we misread, then import',
    done: 'Your menu is ready',
  }[step];

  return (
    <Screen
      title="Scan menu photo"
      subtitle={subtitle}
      actions={<Button title={isPhone ? undefined : 'Back to menu'} icon="arrow-back" variant="secondary" onPress={back} accessibilityLabel="Back to menu" />}
      toolbar={<Steps step={step} />}
      scroll={step !== 'review'}
      contentStyle={step === 'review' ? { flex: 1 } : undefined}
      maxWidth={step === 'review' ? 1280 : 1040}
    >
      {step === 'pick' ? (
        <View style={[styles.pickGrid, !isWide && { flexDirection: 'column' }]}>
          <View style={{ flex: isWide ? 1.6 : undefined, gap: 16, alignSelf: 'stretch' }}>
            {!online ? (
              <Notice icon="cloud-offline-outline" tone="warning" title="No internet connection" message="Reading a menu photo needs internet. You can still choose photos now." />
            ) : null}
            {error ? (
              <Notice icon={error.icon} tone="danger" title={error.title} message={error.message}
                action={<View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {photos.length ? <Button title="Try again" icon="refresh" size="sm" onPress={read} /> : null}
                  <Button title="Type items instead" size="sm" variant="secondary" onPress={typeInstead} />
                </View>} />
            ) : null}
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="h3" style={{ flex: 1 }}>Menu photos</Text>
                <Text variant="smallStrong" tone="muted">{photos.length} / {MAX_PHOTOS}</Text>
              </View>
              <View style={styles.thumbs}>
                {photos.map((p, i) => (
                  <View key={p.key} style={[styles.thumb, { borderColor: p.error ? colors.danger : colors.border, backgroundColor: colors.surfaceSunken }]}>
                    <Image source={{ uri: p.previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`Menu photo ${i + 1}`} />
                    {p.error ? null : (
                      <View style={[styles.thumbNum, { backgroundColor: colors.overlay }]}>
                        <Text variant="caption" color={colors.sidebarText}>Page {i + 1}</Text>
                      </View>
                    )}
                    <View style={styles.thumbRemove}>
                      <IconButton icon="close" size="sm" variant="secondary" accessibilityLabel={`Remove photo ${i + 1}`} onPress={() => removePhoto(p.key)} />
                    </View>
                    {p.error ? (
                      <View style={[styles.thumbError, { backgroundColor: colors.dangerSoft }]}>
                        <Text variant="caption" tone="danger" numberOfLines={4}>{p.error}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
                {preparing > 0 ? (
                  <View style={[styles.thumb, styles.addTile, { borderColor: colors.border }]}>
                    <Ionicons name="hourglass-outline" size={22} color={colors.textSubtle} />
                    <Text variant="small" tone="muted">Preparing…</Text>
                  </View>
                ) : null}
                {photos.length < MAX_PHOTOS && !preparing ? (
                  <>
                    {Platform.OS !== 'web' ? (
                      <AddTile icon="camera" label="Take photo" onPress={() => void addPhotos('camera')} primary />
                    ) : null}
                    <AddTile icon="images-outline" label={Platform.OS === 'web' ? 'Choose photos' : 'From gallery'} onPress={() => void addPhotos('library')} primary={Platform.OS === 'web'} />
                  </>
                ) : null}
              </View>
              {photos.some((p) => p.error) ? (
                <Text variant="smallStrong" tone="danger">Remove the photo marked in red to continue.</Text>
              ) : (
                <Text variant="small" tone="subtle">One photo per page · JPEG, PNG, WEBP or HEIC · up to {MAX_PHOTOS} photos</Text>
              )}
            </Card>
            <View style={[styles.cta, isPhone && { flexDirection: 'column-reverse', alignItems: 'stretch' }]}>
              <Button title="Type items instead" variant="ghost" onPress={typeInstead} />
              {isPhone ? null : <View style={{ flex: 1 }} />}
              <Button
                title={photos.length ? `Read menu (${plural(photos.length, 'photo')})` : 'Read menu'}
                icon="sparkles"
                size="lg"
                onPress={read}
                disabled={!photos.length || preparing > 0 || photos.some((p) => p.error)}
                full={isPhone}
              />
            </View>
          </View>
          <Tips wide={isWide} />
        </View>
      ) : null}

      {step === 'reading' ? <Reading count={photos.length} photos={photos} onCancel={cancelRead} /> : null}

      {step === 'review' ? (
        <ReviewStep rows={rows} setRows={setRows} scan={scan} settings={settings} options={options} setOptions={setOptions}
          importing={importing} onImport={doImport} onRescan={restart} />
      ) : null}

      <TopDialogHost />
      {step === 'done' && result ? (
        <Done result={result} onMenu={back} onAgain={restart} />
      ) : null}
    </Screen>
  );
}

function describeError(e: unknown): ScanError {
  if (e instanceof ApiError) {
    if (e.network && e.code === 'TIMEOUT') return { title: 'This took too long', message: 'The menu could not be read in time. Try fewer photos at once, or a smaller / clearer photo.', icon: 'time-outline' };
    if (e.network) return { title: 'Cannot reach Tallyko', message: 'Reading a menu photo needs an internet connection. Check your connection and try again.', icon: 'cloud-offline-outline' };
    if (e.status === 429) return { title: 'Too many scans', message: 'You have scanned several times in the last minute. Please wait a minute, then try again.', icon: 'hourglass-outline' };
    if (e.status === 400 || e.status === 413 || e.status === 422) return { title: 'This photo could not be used', message: e.message || 'Use clear JPEG, PNG, WEBP or HEIC photos under 10 MB.', icon: 'image-outline' };
    if (e.status === 401 || e.status === 403) return { title: 'Not allowed', message: e.message, icon: 'lock-closed-outline' };
    return { title: 'Could not read the menu', message: e.message || 'Something went wrong. Please try again.', icon: 'alert-circle-outline' };
  }
  return { title: 'Could not read the menu', message: errorMessage(e), icon: 'alert-circle-outline' };
}

function Steps({ step }: { step: Step }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const list: { key: Step; label: string }[] = [
    { key: 'pick', label: 'Photos' },
    { key: 'reading', label: 'Reading' },
    { key: 'review', label: 'Review' },
    { key: 'done', label: 'Done' },
  ];
  const current = list.findIndex((s) => s.key === step);
  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of 4: ${list[current]?.label}`}>
      {list.map((s, i) => {
        const done = i < current || step === 'done';
        const active = i === current;
        return (
          <React.Fragment key={s.key}>
            {i > 0 ? <View style={[styles.stepLine, { backgroundColor: done || active ? colors.primary : colors.border }]} /> : null}
            <View style={styles.stepItem}>
              <View style={[styles.stepDot, { backgroundColor: done || active ? colors.primary : colors.surfaceSunken, borderColor: done || active ? colors.primary : colors.border }]}>
                {done ? <Ionicons name="checkmark" size={13} color={colors.primaryText} /> : <Text variant="caption" color={active ? colors.primaryText : colors.textSubtle}>{i + 1}</Text>}
              </View>
              {!isPhone || active ? <Text variant="smallStrong" color={active ? colors.text : colors.textMuted}>{s.label}</Text> : null}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function AddTile({ icon, label, onPress, primary }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: any) => [
        styles.thumb,
        styles.addTile,
        {
          borderColor: primary ? colors.primary : colors.borderStrong,
          backgroundColor: hovered || pressed ? colors.primarySoft : primary ? colors.surfaceAlt : colors.surface,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <Ionicons name={icon} size={26} color={primary ? colors.primary : colors.textMuted} />
      <Text variant="smallStrong" color={primary ? colors.primary : colors.text} align="center">{label}</Text>
    </Pressable>
  );
}

function Tips({ wide }: { wide: boolean }) {
  const { colors } = useTheme();
  const tips: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
    { icon: 'scan-outline', title: 'Whole page in frame', text: 'All four edges visible, one page per photo.' },
    { icon: 'sunny-outline', title: 'Good, even light', text: 'No shadows or glare from laminated menus — avoid the flash.' },
    { icon: 'phone-portrait-outline', title: 'Flat and straight', text: 'Hold the phone parallel to the menu, not at an angle.' },
    { icon: 'text-outline', title: 'Printed English works best', text: 'Handwritten or Hindi-only text is not read yet — add those by hand.' },
  ];
  return (
    <Card style={{ flex: wide ? 1 : undefined, gap: 14, alignSelf: wide ? 'flex-start' : 'stretch' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="bulb-outline" size={18} color={colors.accentText} />
        <Text variant="h3">Tips for a perfect scan</Text>
      </View>
      {tips.map((t) => (
        <View key={t.title} style={{ flexDirection: 'row', gap: 12 }}>
          <View style={[styles.tipIcon, { backgroundColor: colors.surfaceSunken }]}>
            <Ionicons name={t.icon} size={17} color={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong">{t.title}</Text>
            <Text variant="small" tone="muted">{t.text}</Text>
          </View>
        </View>
      ))}
      <View style={[styles.privacy, { backgroundColor: colors.surfaceSunken }]}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
        <Text variant="small" tone="muted" style={{ flex: 1 }}>Photos are read on Tallyko’s server and not stored. Nothing is added until you press Import.</Text>
      </View>
    </Card>
  );
}

function Reading({ count, photos, onCancel }: { count: number; photos: MenuPhoto[]; onCancel: () => void }) {
  const { colors } = useTheme();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => clearInterval(id);
  }, []);
  const expected = 6 + count * 7;
  // Ease towards 95% — never claims to be finished before the server answers
  const progress = Math.min(0.95, 1 - Math.exp(-elapsed / (expected * 0.7)));
  const stage = progress < 0.25 ? 'Uploading photos…' : progress < 0.55 ? 'Finding text on the menu…' : progress < 0.8 ? 'Reading names and prices…' : 'Grouping categories and sizes…';
  return (
    <Card style={styles.reading}>
      <View style={styles.readingThumbs}>
        {photos.slice(0, 5).map((p, i) => (
          <Image key={p.key} source={{ uri: p.previewUri }} style={[styles.readingThumb, { borderColor: colors.border, transform: [{ rotate: `${(i - (photos.length - 1) / 2) * 5}deg` }] }]} />
        ))}
      </View>
      <Text variant="h2" align="center">Reading your menu…</Text>
      <Text tone="muted" align="center" accessibilityLiveRegion="polite">{stage}</Text>
      <View style={[styles.bar, { backgroundColor: colors.surfaceSunken }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
        <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
      </View>
      <Text variant="small" tone="subtle" align="center">
        {elapsed > expected * 1.6 ? 'Taking longer than usual — large or detailed menus can take up to a minute.' : `${plural(count, 'photo')} · usually 5–30 seconds`}
      </Text>
      <Button title="Cancel" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

function Done({ result, onMenu, onAgain }: { result: { created: number; skipped: string[] }; onMenu: () => void; onAgain: () => void }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  return (
    <Card style={styles.done}>
      <View style={[styles.doneIcon, { backgroundColor: result.created ? colors.successSoft : colors.warningSoft }]}>
        <Ionicons name={result.created ? 'checkmark-circle' : 'information-circle'} size={44} color={result.created ? colors.success : colors.warning} />
      </View>
      <Text variant="display" align="center">{result.created ? `${plural(result.created, 'item')} added` : 'Nothing new to add'}</Text>
      <Text tone="muted" align="center" style={{ maxWidth: 480 }}>
        {result.created
          ? 'They are on your billing screen now. Fine-tune any item — GST, stock tracking, barcodes, descriptions — from Menu & items.'
          : 'Every item you ticked is already on your menu.'}
      </Text>
      {result.skipped.length ? (
        <View style={[styles.skipped, { backgroundColor: colors.surfaceSunken }]}>
          <Text variant="smallStrong" tone="muted">{plural(result.skipped.length, 'item')} skipped — already on your menu</Text>
          <Text variant="small" tone="subtle" numberOfLines={4}>{result.skipped.join(', ')}</Text>
        </View>
      ) : null}
      <View style={[{ flexDirection: 'row', gap: 12, marginTop: 8 }, isPhone && { flexDirection: 'column', alignSelf: 'stretch' }]}>
        <Button title="Go to menu" icon="fast-food-outline" size="lg" onPress={onMenu} full={isPhone} />
        <Button title="Scan another menu" icon="camera-outline" size="lg" variant="secondary" onPress={onAgain} full={isPhone} />
      </View>
    </Card>
  );
}

function Notice({ icon, title, message, tone, action }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; message: string; tone: 'warning' | 'danger'; action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const bg = tone === 'danger' ? colors.dangerSoft : colors.warningSoft;
  const fg = tone === 'danger' ? colors.danger : colors.warning;
  return (
    <View style={[styles.notice, { backgroundColor: bg, borderColor: fg }]} accessibilityRole="alert">
      <Ionicons name={icon} size={22} color={fg} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" tone={tone}>{title}</Text>
        <Text variant="small" tone={tone}>{message}</Text>
        {action ? <View style={{ marginTop: 6 }}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pickGrid: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  thumb: { width: 128, height: 168, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  thumbNum: { position: 'absolute', left: 6, bottom: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  thumbRemove: { position: 'absolute', top: 4, right: 4 },
  thumbError: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 6 },
  addTile: { borderStyle: 'dashed', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tipIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  privacy: { flexDirection: 'row', gap: 8, borderRadius: 10, padding: 10, alignItems: 'flex-start' },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, maxWidth: 64, height: 2, borderRadius: 1 },
  reading: { alignItems: 'center', gap: 14, paddingVertical: 40, maxWidth: 560, width: '100%', alignSelf: 'center' },
  readingThumbs: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8, height: 110 },
  readingThumb: { width: 76, height: 104, borderRadius: 8, borderWidth: 2, marginHorizontal: -10 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', alignSelf: 'stretch', marginHorizontal: 24 },
  barFill: { height: '100%', borderRadius: 4 },
  done: { alignItems: 'center', gap: 12, paddingVertical: 40, maxWidth: 640, width: '100%', alignSelf: 'center' },
  doneIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  skipped: { borderRadius: 12, padding: 12, gap: 4, alignSelf: 'stretch' },
  notice: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
});
