import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Badge, Button, Card, Segmented, Text, confirm, toast } from '@/components/ui';
import {
  SYSTEM_PRINTER, PrinterError, disconnectPrinter, getCapabilities, printKot, printReceipt, requestPermissions, scanPrinters,
  type PrinterDevice, type PrinterKind,
} from '@/lib/print/printers';
import { buildKotText, buildReceiptText, type PaperWidth } from '@/lib/print/receipt';
import { printErrorMessage } from '@/lib/billing';
import { usePrefs } from '@/store/prefs';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FormSection, Hairline, monoFont, SettingSwitch } from './components';
import { sampleKot, sampleReceipt } from './sample';

const KIND_LABEL: Record<PrinterKind, string> = {
  'bt-classic': 'Bluetooth',
  ble: 'Bluetooth LE',
  'web-bluetooth': 'Web Bluetooth',
  system: 'Print dialog',
};

interface Env {
  kind: 'android' | 'ios' | 'expo-go' | 'web' | 'web-ios';
  title: string;
  summary: string;
  rows: { label: string; ok: boolean; detail: string }[];
  canScan: boolean;
}

function detectEnvironment(): Env {
  const caps = getCapabilities();
  if (Platform.OS === 'web') {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const iosBrowser = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
    const secure = typeof window === 'undefined' || window.isSecureContext !== false;
    const rows = [
      {
        label: 'Bluetooth printers (BLE)',
        ok: caps.webBluetooth && secure,
        detail: caps.webBluetooth
          ? secure ? 'Chrome/Edge Web Bluetooth. Works with BLE thermal printers.' : 'Needs the site to be opened over HTTPS.'
          : iosBrowser ? 'No browser on iPhone/iPad supports Bluetooth. Use AirPrint or the Tallyko app on Android.' : 'This browser has no Web Bluetooth. Use Chrome or Edge.',
      },
      { label: 'Classic Bluetooth printers', ok: false, detail: 'Browsers cannot use Classic Bluetooth (most cheap 58mm printers). Use the Android app.' },
      { label: 'Print dialog', ok: true, detail: 'USB, Wi-Fi and network printers installed on this computer, or Save as PDF.' },
    ];
    return {
      kind: iosBrowser ? 'web-ios' : 'web',
      title: iosBrowser ? 'Safari / iPhone browser' : 'Web browser',
      summary: caps.webBluetooth && secure
        ? 'You can print to BLE printers from this browser, or use the print dialog.'
        : 'This browser prints through the print dialog. Bluetooth needs Chrome/Edge or the Tallyko app.',
      rows,
      canScan: caps.webBluetooth && secure,
    };
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return {
      kind: 'expo-go',
      title: 'Expo Go (preview app)',
      summary: 'Bluetooth printing does not work inside Expo Go. Install the Tallyko app (APK, Play Store or App Store).',
      rows: [
        { label: 'Bluetooth printers', ok: false, detail: 'Needs the installed Tallyko app.' },
        { label: 'Print dialog', ok: true, detail: Platform.OS === 'ios' ? 'AirPrint printers on your Wi-Fi.' : 'Android print service / Save as PDF.' },
      ],
      canScan: false,
    };
  }
  if (Platform.OS === 'android') {
    return {
      kind: 'android',
      title: 'Android app',
      summary: caps.btClassic || caps.ble ? 'Pair your printer in Android Bluetooth settings first, then find it here.' : 'Bluetooth modules are missing from this build.',
      rows: [
        { label: 'Classic Bluetooth printers', ok: caps.btClassic, detail: caps.btClassic ? 'Most 58mm/80mm thermal printers. Pair them in Android settings first.' : 'Not included in this build.' },
        { label: 'Bluetooth LE printers', ok: caps.ble, detail: caps.ble ? 'Found by scanning nearby.' : 'Not included in this build.' },
        { label: 'Print dialog', ok: true, detail: 'Android print service (Wi-Fi printers) or Save as PDF.' },
      ],
      canScan: caps.btClassic || caps.ble,
    };
  }
  return {
    kind: 'ios',
    title: 'iPhone / iPad app',
    summary: 'iOS supports Bluetooth LE printers and AirPrint. Classic Bluetooth printers are not supported by Apple.',
    rows: [
      { label: 'Bluetooth LE printers', ok: caps.ble, detail: caps.ble ? 'Found by scanning nearby.' : 'Not included in this build.' },
      { label: 'Classic Bluetooth printers', ok: false, detail: 'Apple does not allow these without MFi certification.' },
      { label: 'AirPrint', ok: true, detail: 'Any AirPrint printer on the same Wi-Fi.' },
    ],
    canScan: caps.ble,
  };
}

export default function PrintersScreen() {
  const { colors } = useTheme();
  const { width, isPhone } = useLayout();
  const env = useMemo(detectEnvironment, []);
  const prefs = usePrefs();
  const setPrefs = usePrefs((s) => s.set);
  const settings = useData((s) => s.settings);
  const session = useAuth((s) => s.session);
  const isManager = can(session?.role ?? null, 'manage');

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<PrinterDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [disclosed, setDisclosed] = useState(false);
  const [testing, setTesting] = useState<'bill' | 'kot' | null>(null);
  const [preview, setPreview] = useState<'bill' | 'kot'>('bill');

  const receipt = useMemo(() => sampleReceipt(settings, session?.businessName ?? null, session?.fullName ?? null), [settings, session?.businessName, session?.fullName]);
  const kot = useMemo(sampleKot, []);
  const previewText = useMemo(
    () => (preview === 'bill' ? buildReceiptText(receipt, prefs.paperWidth) : buildKotText(kot, prefs.paperWidth)),
    [preview, receipt, kot, prefs.paperWidth],
  );

  const billPrinter = prefs.printer ?? SYSTEM_PRINTER;
  const kitchenPrinter = prefs.kitchenPrinter;

  const find = async (showAllDevices = false) => {
    setScanError(null);
    // Prominent disclosure before the Android runtime permission prompt (Play policy).
    if (Platform.OS === 'android' && !disclosed) {
      const ok = await confirm({
        title: 'Allow Bluetooth for printing',
        message: 'Tallyko uses Bluetooth ("Nearby devices") only to find and connect to your receipt printer. It does not use your location or track you. Android will ask you to allow it next.',
        confirmLabel: 'Continue',
      });
      if (!ok) return;
      setDisclosed(true);
      const granted = await requestPermissions();
      if (!granted) {
        setScanError(new PrinterError('PERMISSION_DENIED').message);
        return;
      }
    }
    setScanning(true);
    try {
      const list = await scanPrinters(8000, { showAllDevices });
      setScanned(true);
      if (Platform.OS === 'web') {
        if (list.length === 0) {
          toast.info('No printer was chosen.');
          return;
        }
        setFound((prev) => [...list, ...prev.filter((p) => !list.some((l) => l.id === p.id))]);
      } else {
        setFound(list);
      }
    } catch (e) {
      const message = printErrorMessage(e);
      setScanError(message);
      if (!(e instanceof PrinterError && e.code === 'CANCELLED')) toast.error(message);
    } finally {
      setScanning(false);
    }
  };

  const assign = async (target: 'bill' | 'kitchen', device: PrinterDevice | null) => {
    const previous = target === 'bill' ? prefs.printer : prefs.kitchenPrinter;
    if (previous && previous.kind !== 'system' && previous.id !== device?.id) {
      const stillUsed = target === 'bill' ? prefs.kitchenPrinter?.id === previous.id : prefs.printer?.id === previous.id;
      if (!stillUsed) await disconnectPrinter(previous);
    }
    setPrefs(target === 'bill' ? { printer: device } : { kitchenPrinter: device });
    const name = device ? device.name : target === 'bill' ? 'the print dialog' : 'the bill printer';
    toast.success(target === 'bill' ? `Bills will print on ${name}` : `Kitchen tickets will print on ${name}`);
  };

  const testBill = async () => {
    setTesting('bill');
    try {
      await printReceipt(prefs.printer, receipt, prefs.paperWidth, { barcode: prefs.printBarcodeOnBill, qr: prefs.printQrOnBill, openDrawer: false });
      if (prefs.printer && prefs.printer.kind !== 'system') toast.success('Test bill sent to the printer');
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  const testKot = async () => {
    setTesting('kot');
    try {
      const device = prefs.kitchenPrinter ?? prefs.printer;
      await printKot(device, kot, prefs.paperWidth);
      if (device && device.kind !== 'system') toast.success('Test kitchen ticket sent to the printer');
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  const sideBySide = width >= 1320;

  const capabilityCard = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={env.kind.startsWith('web') ? 'globe-outline' : 'phone-portrait-outline'} size={20} color={colors.primarySoftText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>This device</Text>
          <Text variant="h3">{env.title}</Text>
        </View>
      </View>
      <Text tone="muted">{env.summary}</Text>
      <View style={{ gap: 10 }}>
        {env.rows.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Ionicons name={r.ok ? 'checkmark-circle' : 'close-circle'} size={18} color={r.ok ? colors.success : colors.textSubtle} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="smallStrong">{r.label}</Text>
              <Text variant="small" tone="muted">{r.detail}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );

  const printerRow = (label: string, device: PrinterDevice | null, fallback: string, actions: React.ReactNode) => (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={device && device.kind !== 'system' ? 'bluetooth' : 'print-outline'} size={20} color={colors.textMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="small" tone="muted">{label}</Text>
          <Text variant="bodyStrong" numberOfLines={1}>{device ? device.name : fallback}</Text>
        </View>
        {device ? <Badge label={KIND_LABEL[device.kind]} tone={device.kind === 'system' ? 'neutral' : 'primary'} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{actions}</View>
    </View>
  );

  const previewCard = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Text variant="h3">Preview</Text>
        <View style={{ width: 200 }}>
          <Segmented size="sm" value={preview} onChange={setPreview} options={[{ value: 'bill', label: 'Bill' }, { value: 'kot', label: 'Kitchen' }]} />
        </View>
      </View>
      <View style={{ alignItems: 'center', backgroundColor: colors.surfaceSunken, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 8 }}>
        <View
          accessibilityLabel={preview === 'bill' ? 'Sample bill preview' : 'Sample kitchen ticket preview'}
          style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 4, maxWidth: '100%' }}
        >
          <Text selectable style={{ fontFamily: monoFont, fontSize: prefs.paperWidth === 58 ? 12 : 10.5, lineHeight: prefs.paperWidth === 58 ? 16 : 14, color: colors.text }}>
            {previewText}
          </Text>
        </View>
      </View>
      <Text variant="small" tone="subtle">
        How a {prefs.paperWidth}mm Bluetooth printer prints it{prefs.printBarcodeOnBill || prefs.printQrOnBill ? ' (barcode and QR are printed as images)' : ''}. The print dialog uses a cleaner layout.
      </Text>
    </Card>
  );

  return (
    <SettingsFrame active="printers" title="Printers & receipts" subtitle="Saved on this device only. Set up each phone, tablet or computer that prints." maxWidth={sideBySide ? 1180 : 960}>
      <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 24, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 24, minWidth: 0, width: sideBySide ? undefined : '100%' }}>
          {capabilityCard}

          <Callout tone="info" icon="bluetooth" title="About Bluetooth printing">
            Bluetooth printing needs the Tallyko app installed from the APK, Play Store or App Store. In a browser, use Chrome or Edge (BLE printers only) or the print dialog. iPhone browsers cannot use Bluetooth.
          </Callout>

          <FormSection stacked title="Your printers" description="Bills go to the bill printer. Kitchen tickets (KOT) go to the kitchen printer, or the bill printer if you only have one.">
            {printerRow('Bill printer', billPrinter, 'Print dialog', (
              <>
                <Button title="Test bill" size="sm" icon="receipt-outline" onPress={testBill} loading={testing === 'bill'} disabled={testing !== null} />
                {prefs.printer ? <Button title="Use print dialog instead" size="sm" variant="ghost" onPress={() => assign('bill', null)} disabled={testing !== null} /> : null}
              </>
            ))}
            {prefs.printer?.kind === 'web-bluetooth' ? (
              <Text variant="small" tone="subtle">Browsers forget Bluetooth printers after the page reloads. If a print fails, tap Find printers and choose it again.</Text>
            ) : null}
            <Hairline />
            {printerRow('Kitchen printer (KOT)', kitchenPrinter, `Same as bill printer (${billPrinter.name})`, (
              <>
                <Button title="Test kitchen ticket" size="sm" variant="secondary" icon="flame-outline" onPress={testKot} loading={testing === 'kot'} disabled={testing !== null} />
                {kitchenPrinter ? <Button title="Same as bill printer" size="sm" variant="ghost" onPress={() => assign('kitchen', null)} /> : null}
                {kitchenPrinter?.kind !== 'system' ? <Button title="Use print dialog" size="sm" variant="ghost" onPress={() => assign('kitchen', SYSTEM_PRINTER)} /> : null}
              </>
            ))}
          </FormSection>

          <FormSection
            stacked
            title="Find printers"
            description={Platform.OS === 'web'
              ? 'Switch the printer on, then choose it in the browser window that opens.'
              : Platform.OS === 'android'
                ? 'Switch the printer on and pair it in Android Settings → Bluetooth (PIN is usually 0000 or 1234). Paired printers are listed first.'
                : 'Switch the printer on and keep it close to this device.'}
          >
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button title={Platform.OS === 'web' ? 'Choose Bluetooth printer' : scanned ? 'Search again' : 'Find printers'} icon="search"
                onPress={() => find(false)} loading={scanning} disabled={!env.canScan || scanning} />
              {Platform.OS === 'web' && env.canScan ? (
                <Button title="Show all devices" variant="ghost" size="sm" onPress={() => find(true)} disabled={scanning} />
              ) : null}
            </View>
            {!env.canScan ? (
              <Text variant="small" tone="muted">Bluetooth isn't available here. You can still print with the print dialog.</Text>
            ) : Platform.OS === 'web' ? (
              <Text variant="small" tone="subtle">Printer not in the list? Tap "Show all devices" and pick it by name.</Text>
            ) : null}
            {scanning && Platform.OS !== 'web' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.primary} />
                <Text tone="muted">Looking for printers nearby (about 8 seconds)…</Text>
              </View>
            ) : null}
            {scanError ? <Callout tone="danger" title="Couldn't find printers">{scanError}</Callout> : null}
            {scanned && !scanning && !scanError && found.length === 0 ? (
              <Callout tone="warning" title="No printers found">
                Make sure the printer is on, charged and not connected to another phone. On Android, pair it in Bluetooth settings first.
              </Callout>
            ) : null}
            {found.length > 0 ? (
              <View style={{ gap: 8 }}>
                {found.map((d) => {
                  const isBill = prefs.printer?.id === d.id;
                  const isKitchen = prefs.kitchenPrinter?.id === d.id;
                  return (
                    <View key={d.id} style={{ borderWidth: 1, borderColor: isBill || isKitchen ? colors.primary : colors.border, borderRadius: 12, padding: 12, gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="print" size={20} color={colors.textMuted} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>{d.name}</Text>
                          <Text variant="small" tone="subtle" numberOfLines={1}>{KIND_LABEL[d.kind]}{d.address ? ` · ${d.address}` : ''}</Text>
                        </View>
                        {isBill ? <Badge label="Bills" tone="success" icon="checkmark" /> : null}
                        {isKitchen ? <Badge label="Kitchen" tone="success" icon="checkmark" /> : null}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        <Button title={isBill ? 'Bill printer' : 'Use for bills'} size="sm" variant={isBill ? 'soft' : 'secondary'} disabled={isBill}
                          onPress={() => assign('bill', d)} />
                        <Button title={isKitchen ? 'Kitchen printer' : 'Use for kitchen'} size="sm" variant={isKitchen ? 'soft' : 'secondary'} disabled={isKitchen}
                          onPress={() => assign('kitchen', d)} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </FormSection>

          <FormSection stacked title="Receipt options" description="How bills look and what happens after payment.">
            <View style={{ gap: 6 }}>
              <Text variant="smallStrong" tone="muted">Paper width</Text>
              <View style={{ maxWidth: 320 }}>
                <Segmented<'58' | '80'>
                  value={String(prefs.paperWidth) as '58' | '80'}
                  onChange={(v) => setPrefs({ paperWidth: Number(v) as PaperWidth })}
                  options={[{ value: '58', label: '58 mm (2 inch)' }, { value: '80', label: '80 mm (3 inch)' }]}
                />
              </View>
              <Text variant="small" tone="subtle">Check the paper roll: most small handheld printers use 58 mm.</Text>
            </View>
            <Hairline />
            <SettingSwitch title="Print bill after payment" subtitle="Prints automatically when a bill is paid. You can always reprint from Orders."
              value={prefs.autoPrintReceipt} onValueChange={(v) => setPrefs({ autoPrintReceipt: v })} />
            <SettingSwitch title="Print kitchen ticket (KOT)" subtitle="Prints a KOT when items are sent to the kitchen."
              value={prefs.autoPrintKot} onValueChange={(v) => setPrefs({ autoPrintKot: v })} />
            <SettingSwitch title="Barcode on bill" subtitle="Scan the bill later to find it quickly for returns or reprints."
              value={prefs.printBarcodeOnBill} onValueChange={(v) => setPrefs({ printBarcodeOnBill: v })} />
            <SettingSwitch title="UPI QR on bill"
              subtitle={settings?.upi_id ? `Customers scan to pay ${settings.upi_id}. Turn off if your printer prints garbage for QR codes.` : 'Add a UPI ID in Business settings to print a payment QR.'}
              value={prefs.printQrOnBill} onValueChange={(v) => setPrefs({ printQrOnBill: v })} />
            {!settings?.upi_id && isManager ? (
              <Button title="Add UPI ID" size="sm" variant="ghost" iconRight="arrow-forward" style={{ alignSelf: 'flex-start' }}
                onPress={() => router.navigate('/settings/business?section=payments' as Href)} />
            ) : null}
            <SettingSwitch title="Open cash drawer" subtitle="Kicks a cash drawer plugged into a Bluetooth printer when a bill is paid. Not available with the print dialog."
              value={prefs.openCashDrawer} onValueChange={(v) => setPrefs({ openCashDrawer: v })} />
          </FormSection>

          {!sideBySide ? previewCard : null}
          {isPhone ? null : <View style={{ height: 8 }} />}
        </View>
        {sideBySide ? <View style={{ width: 400, gap: 16 }}>{previewCard}</View> : null}
      </View>
    </SettingsFrame>
  );
}
