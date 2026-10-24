import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Button, Sheet, Text } from '@/components/ui';
import { useLayout, useTheme } from '@/theme/ThemeProvider';

/** Camera barcode scanner. Stays open for fast retail scanning; one physical scan = one add. */
export function ScannerSheet({ visible, onClose, onCode, lastAdded }: {
  visible: boolean; onClose: () => void; onCode: (code: string) => void; lastAdded: string | null;
}) {
  const { colors, radius } = useTheme();
  const { isPhone, height } = useLayout();
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busyUntil = useRef(0);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain && !asked) {
      setAsked(true);
      void requestPermission();
    }
  }, [visible, permission, asked, requestPermission]);
  useEffect(() => { if (!visible) setAsked(false); }, [visible]);

  const onScanned = (r: BarcodeScanningResult) => {
    const code = (r.data ?? '').trim();
    if (!code) return;
    const now = Date.now();
    // Debounce: the camera reports the same code many times per second while it's in view
    if (now < busyUntil.current) return;
    if (code === last.current.code && now - last.current.at < 2000) { last.current.at = now; return; }
    last.current = { code, at: now };
    busyUntil.current = now + 900;
    onCode(code);
  };

  const camHeight = Math.min(isPhone ? height * 0.45 : 340, 380);

  return (
    <Sheet visible={visible} onClose={onClose} title="Scan barcode" subtitle="Point the camera at the item's barcode" width={520} scroll={false}
      footer={<Button title="Done" variant="secondary" full onPress={onClose} />}>
      {!permission ? (
        <View style={[styles.state, { height: camHeight }]}><Text tone="muted">Starting camera…</Text></View>
      ) : !permission.granted ? (
        <View style={[styles.state, { height: camHeight, backgroundColor: colors.surfaceSunken, borderRadius: radius.lg }]}>
          <Ionicons name="camera-outline" size={36} color={colors.textSubtle} />
          <Text variant="h3" align="center">Camera access needed</Text>
          <Text tone="muted" align="center" style={{ maxWidth: 320 }}>
            {permission.canAskAgain ? 'Allow camera access to scan barcodes.' : 'Camera access is turned off for Tallyko. Turn it on in your device settings, or use a USB/Bluetooth barcode scanner.'}
          </Text>
          {permission.canAskAgain ? (
            <Button title="Allow camera" icon="camera" onPress={() => void requestPermission()} />
          ) : Platform.OS !== 'web' ? (
            <Button title="Open settings" icon="settings-outline" variant="secondary" onPress={() => void Linking.openSettings()} />
          ) : null}
        </View>
      ) : visible ? (
        <View style={{ height: camHeight, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.sidebar }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'qr'] }}
            onBarcodeScanned={onScanned}
          />
          <View pointerEvents="none" style={styles.frameWrap}>
            <View style={[styles.frame, { borderColor: colors.primaryHover, borderRadius: radius.md }]} />
          </View>
        </View>
      ) : null}
      <View style={styles.status}>
        <Ionicons name={lastAdded ? 'checkmark-circle' : 'scan-outline'} size={18} color={lastAdded ? colors.success : colors.textSubtle} />
        <Text variant="small" tone={lastAdded ? 'success' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
          {lastAdded ? `Added ${lastAdded}` : 'Tip: USB / Bluetooth scanners work too — just scan with the search box focused.'}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  frameWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '72%', height: '42%', borderWidth: 3 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
});
