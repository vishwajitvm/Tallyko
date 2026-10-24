import { useMemo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { qrMatrix, qrPath, type QrErrorCorrection } from '@/lib/barcode/qr';

export interface QrCodeProps {
  value: string;
  /** Rendered size in px (square). Default 160. */
  size?: number;
  color?: string;
  background?: string;
  ecc?: QrErrorCorrection;
  /** Quiet zone in modules. Default 2. */
  margin?: number;
  /** Optional caption below the code (e.g. "Scan to pay"). */
  showText?: boolean;
  caption?: string;
  style?: StyleProp<ViewStyle>;
}

/** Renders a QR code with react-native-svg. */
export function QrCode({
  value,
  size = 160,
  color = '#000',
  background = '#fff',
  ecc = 'M',
  margin = 2,
  showText = false,
  caption,
  style,
}: QrCodeProps) {
  const result = useMemo(() => {
    try {
      const matrix = qrMatrix(value, ecc);
      return { dim: matrix.length + margin * 2, d: qrPath(matrix, margin), error: null };
    } catch (e) {
      return { dim: 0, d: '', error: e instanceof Error ? e.message : 'Invalid QR data' };
    }
  }, [value, ecc, margin]);

  if (result.error) {
    return (
      <View style={style}>
        <Text style={{ color: '#b91c1c', fontSize: 12 }}>{result.error}</Text>
      </View>
    );
  }
  return (
    <View style={[{ alignItems: 'center' }, style]} accessibilityRole="image" accessibilityLabel="QR code">
      <Svg width={size} height={size} viewBox={`0 0 ${result.dim} ${result.dim}`}>
        {background !== 'transparent' ? <Rect x={0} y={0} width={result.dim} height={result.dim} fill={background} /> : null}
        <Path d={result.d} fill={color} />
      </Svg>
      {showText || caption ? (
        <Text style={{ color, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
          {caption ?? value}
        </Text>
      ) : null}
    </View>
  );
}

export default QrCode;
