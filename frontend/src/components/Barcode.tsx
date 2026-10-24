import { useMemo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';

import { barcodeGeometry, barcodeLayout, type BarcodeFormat } from '@/lib/barcode/svg';

export interface BarcodeProps {
  value: string;
  format?: BarcodeFormat;
  /** Bar height in px (text is added below). Default 60. */
  height?: number;
  /** Module width in px. Ignored when `width` is given. Default 2. */
  moduleWidth?: number;
  /** Fit the barcode (incl. quiet zones) to this width in px. */
  width?: number;
  color?: string;
  background?: string;
  showText?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Renders a Code 128 / EAN-13 barcode with react-native-svg. Invalid values render an inline message. */
export function Barcode({
  value,
  format = 'code128',
  height = 60,
  moduleWidth = 2,
  width,
  color = '#000',
  background = '#fff',
  showText = true,
  style,
}: BarcodeProps) {
  const result = useMemo(() => {
    try {
      const geom = barcodeGeometry(value, format);
      const quiet = format === 'ean13' ? 9 : 10;
      const mw = width ? width / (geom.totalModules + quiet * 2) : moduleWidth;
      return { layout: barcodeLayout(geom, { height, moduleWidth: mw, showText, quietZone: quiet }), error: null };
    } catch (e) {
      return { layout: null, error: e instanceof Error ? e.message : 'Invalid barcode' };
    }
  }, [value, format, height, moduleWidth, width, showText]);

  if (!result.layout) {
    return (
      <View style={style} accessibilityRole="image" accessibilityLabel={`Invalid barcode ${value}`}>
        <Text style={{ color: '#b91c1c', fontSize: 12 }}>{result.error}</Text>
      </View>
    );
  }
  const lay = result.layout;
  const d = lay.rects.map((b) => `M${b.x} ${b.y}h${b.w}v${b.h}h-${b.w}z`).join('');
  return (
    <View style={style} accessibilityRole="image" accessibilityLabel={`Barcode ${value}`}>
      <Svg width={lay.width} height={lay.totalHeight} viewBox={`0 0 ${lay.width} ${lay.totalHeight}`}>
        {background !== 'transparent' ? <Rect x={0} y={0} width={lay.width} height={lay.totalHeight} fill={background} /> : null}
        <Path d={d} fill={color} />
        {lay.texts.map((t, i) => (
          <SvgText key={i} x={t.x} y={t.y} fontSize={lay.fontSize} fontFamily="monospace" textAnchor={t.anchor} fill={color}>
            {t.text}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

export default Barcode;
