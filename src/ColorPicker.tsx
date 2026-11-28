import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { PopupShell } from './ui';
import { Palette, useTheme, withFonts } from './theme';
import { hexToHsv, hsvToHex, isHex, textOn } from './colorUtil';

// Color picker (1.17.0): ready swatches + three bars (shade, strength, brightness) + live preview.
// Pure JS – the bars are rows of small Views, dragged with a PanResponder.

const SWATCHES = [
  '#E53935', '#F06292', '#AB47BC', '#7E57C2', '#3949AB', '#1E88E5', '#039BE5', '#00ACC1',
  '#00897B', '#43A047', '#7CB342', '#C0CA33', '#FDD835', '#FFB300', '#FB8C00', '#F4511E',
  '#8D6E63', '#757575', '#546E7A', '#212121', '#FFFFFF', '#FFF8E1', '#E8F5E9', '#E3F2FD',
];

const SEGMENTS = 30;

function Bar({
  value,
  colorAt,
  onChange,
}: {
  value: number; // 0..1
  colorAt: (t: number) => string;
  onChange: (t: number) => void;
}) {
  const width = useRef(1);
  const cb = useRef(onChange);
  cb.current = onChange;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => cb.current(Math.max(0, Math.min(1, e.nativeEvent.locationX / width.current))),
        onPanResponderMove: (e) => cb.current(Math.max(0, Math.min(1, e.nativeEvent.locationX / width.current))),
      }),
    []
  );
  const segs = Array.from({ length: SEGMENTS }, (_, i) => colorAt(i / (SEGMENTS - 1)));
  return (
    <View
      style={bar.wrap}
      onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))}
      {...pan.panHandlers}
    >
      <View style={bar.track} pointerEvents="none">
        {segs.map((col, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: col }} />
        ))}
      </View>
      <View pointerEvents="none" style={[bar.knob, { left: `${value * 100}%`, backgroundColor: colorAt(value) }]} />
    </View>
  );
}

const bar = StyleSheet.create({
  // Always left-to-right, so dragging right means "more" even in the Hebrew (RTL) layout.
  wrap: { height: 40, justifyContent: 'center', direction: 'ltr', marginBottom: 10 },
  track: { flexDirection: 'row', height: 26, borderRadius: 13, overflow: 'hidden', borderWidth: 1, borderColor: '#00000022' },
  knob: {
    position: 'absolute',
    width: 30,
    height: 30,
    marginLeft: -15,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});

export function ColorPicker({
  visible,
  title,
  initial,
  preview,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial: string;
  /** Draws the sample with the color being chosen. */
  preview: (color: string) => React.ReactNode;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [hsv, setHsv] = useState(() => hexToHsv(isHex(initial) ? initial : '#1E88E5'));
  const [hexText, setHexText] = useState('');
  useEffect(() => {
    if (visible) {
      const start = isHex(initial) ? initial : '#1E88E5';
      setHsv(hexToHsv(start));
      setHexText(start.toUpperCase());
    }
  }, [visible, initial]);
  const color = hsvToHex(hsv.h, hsv.s, hsv.v);
  const set = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    setHexText(hsvToHex(next.h, next.s, next.v));
  };

  return (
    <PopupShell
      visible={visible}
      title={title}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <TouchableOpacity style={[styles.btn, styles.btnMain]} onPress={() => onPick(color)}>
            <Text style={styles.btnMainText}>✓ בחר צבע זה</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPlain]} onPress={onClose}>
            <Text style={styles.btnPlainText}>ביטול</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <View style={styles.previewBox}>{preview(color)}</View>

      <Text style={styles.label}>צבעים מוכנים</Text>
      <View style={styles.grid}>
        {SWATCHES.map((s) => (
          <TouchableOpacity key={s} onPress={() => set(hexToHsv(s))} style={[styles.sw, { backgroundColor: s }, color === s && styles.swOn]}>
            {color === s ? <Text style={{ color: textOn(s), fontSize: 15, fontWeight: '900' }}>✓</Text> : null}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>גוון</Text>
      <Bar value={hsv.h / 360} colorAt={(t) => hsvToHex(t * 360, 1, 1)} onChange={(t) => set({ ...hsv, h: t * 360 })} />
      <Text style={styles.label}>עוצמת הצבע</Text>
      <Bar value={hsv.s} colorAt={(t) => hsvToHex(hsv.h, t, Math.max(hsv.v, 0.35))} onChange={(t) => set({ ...hsv, s: t })} />
      <Text style={styles.label}>בהירות</Text>
      <Bar value={hsv.v} colorAt={(t) => hsvToHex(hsv.h, hsv.s, t)} onChange={(t) => set({ ...hsv, v: t })} />

      <View style={styles.hexRow}>
        <Text style={styles.hexLabel}>קוד צבע (לא חובה):</Text>
        <TextInput
          style={styles.hexInput}
          value={hexText}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          onChangeText={(t) => {
            const v = (t.startsWith('#') ? t : `#${t}`).toUpperCase();
            setHexText(v);
            if (isHex(v)) setHsv(hexToHsv(v));
          }}
        />
        <View style={[styles.hexDot, { backgroundColor: color }]} />
      </View>
    </PopupShell>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create(
    withFonts({
      previewBox: { borderRadius: 16, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: c.border },
      label: { fontSize: 13.5, fontWeight: '700', color: c.text2, marginBottom: 6 },
      grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
      sw: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
      swOn: { borderWidth: 3, borderColor: c.text },
      hexRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 6 },
      hexLabel: { fontSize: 13, color: c.muted },
      hexInput: {
        flex: 1,
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.subtle,
        color: c.text,
        paddingHorizontal: 10,
        fontSize: 15,
        textAlign: 'left',
      },
      hexDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: c.border },
      footer: { flexDirection: 'row', gap: 8 },
      btn: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
      btnMain: { backgroundColor: c.accent },
      btnMainText: { color: c.onAccent, fontWeight: '700', fontSize: 15 },
      btnPlain: { backgroundColor: c.subtle2 },
      btnPlainText: { color: c.text, fontWeight: '600', fontSize: 15 },
    })
  );
