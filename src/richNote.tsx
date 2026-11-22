import React, { useRef, useState } from 'react';
import { Modal, Text, TextStyle, TouchableOpacity, View } from 'react-native';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import { Palette, fontFor, useTheme, useThemedStyles } from './theme';

// ---------------------------------------------------------------- note colors

export const NOTE_COLORS: { key: string; name: string; light: string; dark: string }[] = [
  { key: 'default', name: 'רגיל', light: '', dark: '' },
  { key: 'yellow', name: 'צהוב', light: '#FFF6C2', dark: '#3A3410' },
  { key: 'pink', name: 'ורוד', light: '#FFE0EC', dark: '#3A1A26' },
  { key: 'blue', name: 'תכלת', light: '#DCEBFF', dark: '#14263D' },
  { key: 'green', name: 'ירוק', light: '#DDF5E3', dark: '#15301D' },
  { key: 'orange', name: 'כתום', light: '#FFE7CC', dark: '#3A2A12' },
  { key: 'purple', name: 'סגול', light: '#ECE3FF', dark: '#271D40' },
  { key: 'gray', name: 'אפור', light: '#E9E9ED', dark: '#2A2A2D' },
];

export function noteBg(key: string | undefined, c: Palette): string | undefined {
  const n = NOTE_COLORS.find((x) => x.key === key);
  if (!n || n.key === 'default') return undefined;
  return c.dark ? n.dark : n.light;
}

export function NoteColorPicker({ value, onChange }: { value?: string; onChange: (k: string) => void }) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.colorRow}>
      {NOTE_COLORS.map((n) => {
        const bg = n.key === 'default' ? c.note : c.dark ? n.dark : n.light;
        const on = (value ?? 'default') === n.key;
        return (
          <TouchableOpacity
            key={n.key}
            accessibilityLabel={n.name}
            style={[styles.colorDot, { backgroundColor: bg }, on && styles.colorDotOn]}
            onPress={() => onChange(n.key)}
          >
            {on ? <Text style={styles.colorCheck}>✓</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- html helpers

const ENT: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s: string) => s.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENT[m]);
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text (used for search, sharing and reminders). */
export function htmlToPlain(html: string): string {
  return spans(html, 14)
    .map((s) => s.text)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainToHtml(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map((l) => `<div>${l ? escapeHtml(l) : '<br>'}</div>`)
    .join('');
}

const SIZES: Record<string, number> = { '1': 0.7, '2': 0.85, '3': 1, '4': 1.15, '5': 1.35, '6': 1.65, '7': 2 };

interface Span {
  text: string;
  style: TextStyle;
}

/** A tiny HTML -> styled spans converter for what the editor produces. */
function spans(html: string, baseSize: number): Span[] {
  const out: Span[] = [];
  const stack: { tag: string; style: TextStyle; list?: { ordered: boolean; n: number; todo: boolean } }[] = [];
  let pendingCheck: boolean | null = null;
  const cur = (): TextStyle => Object.assign({}, ...stack.map((s) => s.style));
  const lastChar = () => {
    for (let i = out.length - 1; i >= 0; i--) if (out[i].text) return out[i].text[out[i].text.length - 1];
    return '';
  };
  const newline = () => {
    if (out.length && lastChar() !== '\n') out.push({ text: '\n', style: {} });
  };
  const listOf = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].list) return stack[i].list!;
    return null;
  };

  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const t = decode(m[4]);
      if (!t) continue;
      if (pendingCheck !== null) {
        out.push({ text: pendingCheck ? '☑ ' : '☐ ', style: {} });
        pendingCheck = null;
      }
      out.push({ text: t, style: cur() });
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (tag === 'br') {
      out.push({ text: '\n', style: {} });
      continue;
    }
    if (tag === 'input') {
      pendingCheck = /checked/i.test(attrs);
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i, 1);
          break;
        }
      }
      if (['div', 'p', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'blockquote'].includes(tag)) newline();
      continue;
    }
    const style: TextStyle = {};
    if (tag === 'b' || tag === 'strong') style.fontWeight = '700';
    if (tag === 'i' || tag === 'em') style.fontStyle = 'italic';
    if (tag === 'u') style.textDecorationLine = 'underline';
    if (tag === 'strike' || tag === 's' || tag === 'del') style.textDecorationLine = 'line-through';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      style.fontWeight = '700';
      style.fontSize = baseSize * (tag === 'h1' ? 1.5 : tag === 'h2' ? 1.3 : 1.15);
    }
    const size = /size=["']?(\d)/i.exec(attrs);
    if (size && SIZES[size[1]]) style.fontSize = baseSize * SIZES[size[1]];
    const color = /color=["']?(#[0-9a-fA-F]{3,8}|rgb\([^)]*\)|[a-zA-Z]+)/i.exec(attrs);
    if (tag === 'font' && color) style.color = color[1];
    const st = /style=["']([^"']*)["']/i.exec(attrs);
    if (st) {
      const css = st[1];
      const fg = /(?:^|;)\s*color:\s*([^;]+)/i.exec(css);
      const bg = /background-color:\s*([^;]+)/i.exec(css);
      const fw = /font-weight:\s*(bold|[6-9]00)/i.exec(css);
      const fs = /font-style:\s*italic/i.exec(css);
      const td = /text-decoration[^:]*:\s*([^;]+)/i.exec(css);
      if (fg) style.color = fg[1].trim();
      if (bg && !/transparent|initial|inherit/.test(bg[1])) style.backgroundColor = bg[1].trim();
      if (fw) style.fontWeight = '700';
      if (fs) style.fontStyle = 'italic';
      if (td) {
        if (/underline/.test(td[1])) style.textDecorationLine = 'underline';
        if (/line-through/.test(td[1])) style.textDecorationLine = 'line-through';
      }
    }
    const entry: (typeof stack)[number] = { tag, style };
    if (tag === 'ul' || tag === 'ol') {
      newline();
      entry.list = { ordered: tag === 'ol', n: 0, todo: /x-todo/.test(attrs) };
    }
    if (['div', 'p', 'h1', 'h2', 'h3', 'blockquote'].includes(tag)) newline();
    stack.push(entry);
    if (tag === 'li') {
      newline();
      const l = listOf();
      if (l && !l.todo) {
        l.n += 1;
        out.push({ text: l.ordered ? `${l.n}. ` : '• ', style: {} });
      }
    }
  }
  // trim trailing newlines
  while (out.length && out[out.length - 1].text === '\n') out.pop();
  return out;
}

/** Renders a note's formatted text inside a single Text (so numberOfLines works). */
export function RichText({
  html,
  style,
  numberOfLines,
}: {
  html: string;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
}) {
  const flat: TextStyle = Object.assign({}, ...(Array.isArray(style) ? style : [style ?? {}]));
  const base = flat.fontSize ?? 14;
  const parts = spans(html, base);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) => (
        <Text key={i} style={p.style.fontWeight ? { ...p.style, fontWeight: undefined, fontFamily: fontFor(p.style.fontWeight) } : p.style}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

// ---------------------------------------------------------------- editor

const TEXT_COLORS = ['#111113', '#D70015', '#E8590C', '#1F9D55', '#0A84FF', '#8E5CF7', '#FF4F9A', '#8E8E93', '#FFFFFF'];
const HILITE_COLORS = ['transparent', '#FFF07A', '#B8F5C8', '#BFE0FF', '#FFD0E4', '#FFD8A8'];
const FONT_SIZES: [1 | 2 | 3 | 4 | 5 | 6 | 7, string][] = [
  [2, 'קטן'],
  [3, 'רגיל'],
  [5, 'גדול'],
  [6, 'ענק'],
];

export function NoteEditor({ initialHtml, onChange }: { initialHtml: string; onChange: (html: string) => void }) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ref = useRef<RichEditor>(null);
  const [pick, setPick] = useState<'size' | 'color' | 'hilite' | null>(null);

  // Returning from the picker: give the editor its focus back, then format the selection.
  const apply = (fn: () => void) => {
    ref.current?.focusContentEditor();
    setTimeout(fn, 80);
  };

  const glyph = (t: string, extra?: TextStyle) => ({ tintColor }: { tintColor?: string }) => (
    <Text style={[styles.tool, { color: tintColor }, extra]}>{t}</Text>
  );

  return (
    <View style={styles.editorWrap}>
      <RichEditor
        ref={ref}
        initialContentHTML={initialHtml}
        onChange={onChange}
        placeholder="כתוב כאן..."
        initialHeight={170}
        useContainer
        editorStyle={{
          backgroundColor: c.noteInput,
          color: c.noteText,
          placeholderColor: c.muted,
          caretColor: c.text,
          contentCSSText: 'font-size: 16px; direction: rtl; text-align: right; padding: 4px 8px; min-height: 160px;',
          initialCSSText: 'body { direction: rtl; } ol.x-todo { padding-right: 24px; }',
        }}
        style={styles.editor}
      />
      <RichToolbar
        editor={ref}
        style={styles.toolbar}
        iconTint={c.text}
        selectedIconTint={c.onAccent}
        selectedButtonStyle={styles.toolOn}
        actions={[
          actions.setBold,
          actions.setItalic,
          actions.setUnderline,
          actions.setStrikethrough,
          'fontSizePick',
          'colorPick',
          'hilitePick',
          actions.insertBulletsList,
          actions.insertOrderedList,
          actions.checkboxList,
          actions.alignRight,
          actions.alignCenter,
          actions.alignLeft,
          actions.undo,
          actions.redo,
        ]}
        iconMap={{
          [actions.setBold]: glyph('B', { fontWeight: '900' }),
          [actions.setItalic]: glyph('I', { fontStyle: 'italic', fontWeight: '700' }),
          [actions.setUnderline]: glyph('U', { textDecorationLine: 'underline', fontWeight: '700' }),
          [actions.setStrikethrough]: glyph('S', { textDecorationLine: 'line-through', fontWeight: '700' }),
          fontSizePick: glyph('Aא'),
          colorPick: glyph('🎨'),
          hilitePick: glyph('🖍️'),
          [actions.insertBulletsList]: glyph('•≡'),
          [actions.insertOrderedList]: glyph('1≡'),
          [actions.checkboxList]: glyph('☑'),
          [actions.alignRight]: glyph('⇥'),
          [actions.alignCenter]: glyph('↔'),
          [actions.alignLeft]: glyph('⇤'),
          [actions.undo]: glyph('↶'),
          [actions.redo]: glyph('↷'),
        }}
        fontSizePick={() => setPick('size')}
        colorPick={() => setPick('color')}
        hilitePick={() => setPick('hilite')}
      />

      <Modal visible={pick !== null} transparent animationType="fade" onRequestClose={() => setPick(null)}>
        <TouchableOpacity style={styles.pickBackdrop} activeOpacity={1} onPress={() => setPick(null)}>
          <View style={styles.pickBox}>
            {pick === 'size' ? (
              <>
                <Text style={styles.pickTitle}>גודל טקסט</Text>
                {FONT_SIZES.map(([n, label]) => (
                  <TouchableOpacity
                    key={n}
                    style={styles.pickRow}
                    onPress={() => {
                      setPick(null);
                      apply(() => ref.current?.setFontSize(n));
                    }}
                  >
                    <Text style={[styles.pickText, { fontSize: 14 * (SIZES[String(n)] ?? 1) }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : null}
            {pick === 'color' || pick === 'hilite' ? (
              <>
                <Text style={styles.pickTitle}>{pick === 'color' ? 'צבע טקסט' : 'צבע מרקר'}</Text>
                <View style={styles.swatches}>
                  {(pick === 'color' ? TEXT_COLORS : HILITE_COLORS).map((col) => (
                    <TouchableOpacity
                      key={col}
                      style={[styles.swatch, { backgroundColor: col === 'transparent' ? c.card : col }]}
                      onPress={() => {
                        const which = pick;
                        setPick(null);
                        apply(() => (which === 'color' ? ref.current?.setForeColor(col) : ref.current?.setHiliteColor(col)));
                      }}
                    >
                      {col === 'transparent' ? <Text style={styles.pickText}>✕</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  colorRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginVertical: 8 },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  colorDotOn: { borderWidth: 3, borderColor: c.accent },
  colorCheck: { fontSize: 14, fontWeight: '900' as const, color: c.text },
  editorWrap: { borderRadius: 12, overflow: 'hidden' as const, borderWidth: 1, borderColor: c.border, marginBottom: 10 },
  toolbar: { backgroundColor: c.subtle, height: 44, borderTopWidth: 1, borderTopColor: c.border },
  tool: { fontSize: 17, minWidth: 22, textAlign: 'center' as const },
  toolOn: { backgroundColor: c.accent, borderRadius: 8 },
  editor: { minHeight: 170 },
  pickBackdrop: { flex: 1, backgroundColor: c.overlay, alignItems: 'center' as const, justifyContent: 'center' as const },
  pickBox: { width: 280, borderRadius: 18, padding: 16, backgroundColor: c.card },
  pickTitle: { fontSize: 16, fontWeight: '800' as const, color: c.text, marginBottom: 10 },
  pickRow: { paddingVertical: 10 },
  pickText: { color: c.text, fontWeight: '600' as const },
  swatches: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
