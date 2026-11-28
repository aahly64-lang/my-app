import { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { contrast, ensureContrast, isHex, mix, textOn } from './colorUtil';

// Visual theme "גרפיט וצהוב" (approved by Avi, 21/11/2026): graphite surfaces, yellow accent,
// Heebo font. Only looks live here – no app logic.

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface Palette {
  dark: boolean;
  bg: string;
  card: string;
  subtle: string;
  subtle2: string;
  border: string;
  borderSoft: string;
  text: string;
  text2: string;
  muted: string;
  accent: string; // the yellow: main buttons, active tab and chips
  onAccent: string; // text/icons on the yellow
  accentText: string; // yellow-ish text that is readable on bg
  accentSoft: string; // pale yellow chips (reminder tags)
  onAccentSoft: string;
  seg: string; // tab bar track
  note: string;
  noteDone: string;
  noteLight: string;
  noteInput: string;
  noteBox: string;
  noteText: string;
  noteText2: string;
  noteLine: string;
  checkLine: string;
  link: string;
  warnBg: string;
  warnText: string;
  okBg: string;
  okText: string;
  infoBg: string;
  infoText: string;
  success: string;
  danger: string;
  dangerSoft: string;
  onDangerSoft: string;
  primary: string; // strong neutral (graphite in light, white in dark)
  onPrimary: string;
  overlay: string;
  cardEdge: string; // thin frame around cards (light backgrounds, so white cards don't vanish on white)
  accentOnPrimary: string; // accent-colored text on the `primary` surface (snackbar "undo")
  switchOff: string; // track of a switch that is off
}

export const LIGHT: Palette = {
  dark: false,
  bg: '#FFFFFF',
  card: '#FFFFFF',
  subtle: '#F4F4F6',
  subtle2: '#E9E9ED',
  border: '#E2E2E6',
  borderSoft: '#EEEEF1',
  text: '#111113',
  text2: '#3A3A40',
  muted: '#6B6B73',
  accent: '#FFD60A',
  onAccent: '#111113',
  accentText: '#7A5F00',
  accentSoft: '#FFF4BF',
  onAccentSoft: '#5C4700',
  seg: '#E5E5EA',
  note: '#FFFFFF',
  noteDone: '#ECECEF',
  noteLight: '#FFFFFF',
  noteInput: '#F4F4F6',
  noteBox: '#F4F4F6',
  noteText: '#111113',
  noteText2: '#45454C',
  noteLine: '#E6E6EA',
  checkLine: '#C7C7CE',
  link: '#7A5F00',
  warnBg: '#FFF4BF',
  warnText: '#6B5300',
  okBg: '#DDF3E3',
  okText: '#1B6B30',
  infoBg: '#E0EEFF',
  infoText: '#004C99',
  success: '#248A3D',
  danger: '#D70015',
  dangerSoft: '#FDE2E4',
  onDangerSoft: '#9F0010',
  primary: '#1C1C1E',
  onPrimary: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.45)',
  cardEdge: '#E4E4E9',
  accentOnPrimary: '#FFD60A',
  switchOff: '#D1D1D6',
};

export const DARK: Palette = {
  dark: true,
  bg: '#000000',
  card: '#1C1C1E',
  subtle: '#2C2C2E',
  subtle2: '#3A3A3C',
  border: '#2C2C2E',
  borderSoft: '#242426',
  text: '#F5F5F7',
  text2: '#D1D1D6',
  muted: '#9C9CA3',
  accent: '#FFD60A',
  onAccent: '#111113',
  accentText: '#FFD60A',
  accentSoft: '#3A3204',
  onAccentSoft: '#FFE066',
  seg: '#1C1C1E',
  note: '#1C1C1E',
  noteDone: '#121214',
  noteLight: '#1C1C1E',
  noteInput: '#2C2C2E',
  noteBox: '#2C2C2E',
  noteText: '#F5F5F7',
  noteText2: '#C7C7CC',
  noteLine: '#2C2C2E',
  checkLine: '#5A5A60',
  link: '#FFD60A',
  warnBg: '#3A3204',
  warnText: '#FFE066',
  okBg: '#0F2E18',
  okText: '#6EE28D',
  infoBg: '#0B2440',
  infoText: '#7DB9FF',
  success: '#30D158',
  danger: '#FF453A',
  dangerSoft: '#3A1212',
  onDangerSoft: '#FF8A80',
  primary: '#F5F5F7',
  onPrimary: '#111113',
  overlay: 'rgba(0, 0, 0, 0.65)',
  cardEdge: 'transparent',
  accentOnPrimary: '#7A5F00',
  switchOff: '#3A3A3C',
};

export const ThemeContext = createContext<Palette>(LIGHT);

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

// Heebo is bundled into the APK (expo-font plugin in app.json). On Android every weight is its
// own font family, so fontWeight is translated to the matching family.
const FONT_BY_WEIGHT: Record<string, string> = {
  normal: 'Heebo_400Regular',
  '100': 'Heebo_300Light',
  '200': 'Heebo_300Light',
  '300': 'Heebo_300Light',
  '400': 'Heebo_400Regular',
  '500': 'Heebo_500Medium',
  '600': 'Heebo_600SemiBold',
  bold: 'Heebo_700Bold',
  '700': 'Heebo_700Bold',
  '800': 'Heebo_800ExtraBold',
  '900': 'Heebo_800ExtraBold',
};

export function fontFor(weight?: string | number): string {
  return FONT_BY_WEIGHT[String(weight ?? '400')] ?? 'Heebo_400Regular';
}

/** Adds the Heebo family to every text style (anything with a font size or weight). */
export function withFonts<T extends Record<string, any>>(defs: T): T {
  const out: Record<string, any> = {};
  for (const key of Object.keys(defs)) {
    const s = { ...defs[key] };
    if (s.fontWeight !== undefined || s.fontSize !== undefined) {
      s.fontFamily = fontFor(s.fontWeight);
      delete s.fontWeight;
    }
    out[key] = s;
  }
  return out as T;
}

/** Soft shadow for raised cards (light mode only). */
export function cardShadow(c: Palette) {
  return c.dark
    ? {}
    : {
        elevation: 2,
        shadowColor: '#000000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      };
}

/** Builds themed styles once per palette. */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T): T {
  const c = useTheme();
  return useMemo(() => StyleSheet.create(withFonts(factory(c))), [c, factory]);
}

// ---------------------------------------------------------------- accent presets

type AccentSet = Pick<Palette, 'accent' | 'onAccent' | 'accentText' | 'accentSoft' | 'onAccentSoft' | 'link'>;

export const ACCENTS: { key: string; name: string; light: AccentSet; dark: AccentSet }[] = [
  {
    key: 'yellow',
    name: 'צהוב',
    light: { accent: '#FFD60A', onAccent: '#111113', accentText: '#7A5F00', accentSoft: '#FFF4BF', onAccentSoft: '#5C4700', link: '#7A5F00' },
    dark: { accent: '#FFD60A', onAccent: '#111113', accentText: '#FFD60A', accentSoft: '#3A3204', onAccentSoft: '#FFE066', link: '#FFD60A' },
  },
  {
    key: 'blue',
    name: 'כחול',
    light: { accent: '#0A84FF', onAccent: '#FFFFFF', accentText: '#0060C7', accentSoft: '#DCEBFF', onAccentSoft: '#00427F', link: '#0060C7' },
    dark: { accent: '#0A84FF', onAccent: '#FFFFFF', accentText: '#64AFFF', accentSoft: '#0B2440', onAccentSoft: '#9CCBFF', link: '#64AFFF' },
  },
  {
    key: 'green',
    name: 'ירוק',
    light: { accent: '#1FA34A', onAccent: '#FFFFFF', accentText: '#17783A', accentSoft: '#DDF5E3', onAccentSoft: '#0F5227', link: '#17783A' },
    dark: { accent: '#30D158', onAccent: '#0B0B0C', accentText: '#5EDC7D', accentSoft: '#0F2E18', onAccentSoft: '#8CE9A3', link: '#5EDC7D' },
  },
  {
    key: 'red',
    name: 'אדום',
    light: { accent: '#E5202E', onAccent: '#FFFFFF', accentText: '#B5121E', accentSoft: '#FDE2E4', onAccentSoft: '#8A0A14', link: '#B5121E' },
    dark: { accent: '#FF453A', onAccent: '#FFFFFF', accentText: '#FF7A70', accentSoft: '#3A1212', onAccentSoft: '#FFA59E', link: '#FF7A70' },
  },
  {
    key: 'purple',
    name: 'סגול',
    light: { accent: '#7D4CF0', onAccent: '#FFFFFF', accentText: '#5B2FC9', accentSoft: '#ECE3FF', onAccentSoft: '#40208F', link: '#5B2FC9' },
    dark: { accent: '#A07BFF', onAccent: '#0B0B0C', accentText: '#B99CFF', accentSoft: '#271D40', onAccentSoft: '#CFBCFF', link: '#B99CFF' },
  },
  {
    key: 'orange',
    name: 'כתום',
    light: { accent: '#FF8A00', onAccent: '#111113', accentText: '#A85400', accentSoft: '#FFE7CC', onAccentSoft: '#7A3D00', link: '#A85400' },
    dark: { accent: '#FF9F0A', onAccent: '#111113', accentText: '#FFB340', accentSoft: '#3A2A12', onAccentSoft: '#FFCC80', link: '#FFB340' },
  },
  {
    key: 'teal',
    name: 'טורקיז',
    light: { accent: '#00A6A6', onAccent: '#FFFFFF', accentText: '#007575', accentSoft: '#D2F4F2', onAccentSoft: '#005252', link: '#007575' },
    dark: { accent: '#2CD4D0', onAccent: '#0B0B0C', accentText: '#5FE0DC', accentSoft: '#0E3231', onAccentSoft: '#94ECE9', link: '#5FE0DC' },
  },
  {
    key: 'pink',
    name: 'ורוד',
    light: { accent: '#F0408A', onAccent: '#FFFFFF', accentText: '#C01F65', accentSoft: '#FFE0EC', onAccentSoft: '#8C1248', link: '#C01F65' },
    dark: { accent: '#FF5FA2', onAccent: '#0B0B0C', accentText: '#FF8CBD', accentSoft: '#3A1A26', onAccentSoft: '#FFB3D3', link: '#FF8CBD' },
  },
  {
    key: 'navy',
    name: 'כחול כהה',
    light: { accent: '#1D3A8A', onAccent: '#FFFFFF', accentText: '#1D3A8A', accentSoft: '#DDE4F7', onAccentSoft: '#142A66', link: '#1D3A8A' },
    dark: { accent: '#5B7FE0', onAccent: '#FFFFFF', accentText: '#8FA8F0', accentSoft: '#162140', onAccentSoft: '#B3C4F5', link: '#8FA8F0' },
  },
  {
    key: 'mono',
    name: 'שחור-לבן',
    light: { accent: '#1C1C1E', onAccent: '#FFFFFF', accentText: '#1C1C1E', accentSoft: '#E9E9ED', onAccentSoft: '#1C1C1E', link: '#1C1C1E' },
    dark: { accent: '#F5F5F7', onAccent: '#111113', accentText: '#F5F5F7', accentSoft: '#2C2C2E', onAccentSoft: '#F5F5F7', link: '#F5F5F7' },
  },
];

// ---------------------------------------------------------------- background presets (1.17.0)

/** 'default' = plain white (or black in dark mode). Any other value is a hex color. */
export const BACKGROUNDS: { key: string; name: string; color: string }[] = [
  { key: 'default', name: 'לבן', color: '#FFFFFF' },
  { key: '#FFF8E7', name: 'שמנת', color: '#FFF8E7' },
  { key: '#EDF7EE', name: 'ירקרק', color: '#EDF7EE' },
  { key: '#EAF3FC', name: 'תכלת', color: '#EAF3FC' },
  { key: '#FCEEF3', name: 'ורדרד', color: '#FCEEF3' },
  { key: '#F1EDFB', name: 'לבנדר', color: '#F1EDFB' },
  { key: '#EEEEF1', name: 'אפור', color: '#EEEEF1' },
  { key: '#141B2D', name: 'כחול לילה', color: '#141B2D' },
  { key: '#10211A', name: 'ירוק כהה', color: '#10211A' },
];

const DARK_TEXT = '#111113';
const LIGHT_TEXT = '#F5F5F7';

/** Does this background give a dark (white-text) screen? */
export function bgIsDark(hex: string): boolean {
  return contrast(LIGHT_TEXT, hex) > contrast(DARK_TEXT, hex);
}

/**
 * The background actually used: nudged lighter (or darker) until the text on it is clearly
 * readable, so no color choice can make the app unreadable.
 */
export function readableBg(hex: string): string {
  if (!isHex(hex)) return '#FFFFFF';
  return bgIsDark(hex) ? ensureContrast(hex, [LIGHT_TEXT], 7, '#000000') : ensureContrast(hex, [DARK_TEXT], 7, '#FFFFFF');
}

/** The button color for an accent setting (preset key or custom hex). */
export function accentColorFor(accentKey: string | undefined, dark: boolean): string {
  if (isHex(accentKey)) return accentKey.toUpperCase();
  const a = ACCENTS.find((x) => x.key === accentKey) ?? ACCENTS[0];
  return dark ? a.dark.accent : a.light.accent;
}

/** True when the buttons would almost melt into the background. */
export function accentTooClose(accent: string, bg: string): boolean {
  return contrast(accent, bg) < 1.25;
}

/** A version of the accent that stands out from the background (for the "fix" button). */
export function accentFixed(accent: string, bg: string): string {
  return ensureContrast(accent, [bg], 2.2, bgIsDark(bg) ? '#FFFFFF' : '#000000');
}

function surfacesFor(base: Palette, bg: string): Partial<Palette> {
  const t = base.text;
  if (base.dark) {
    const card = mix(bg, '#FFFFFF', 0.08);
    const subtle = mix(bg, '#FFFFFF', 0.15);
    return {
      bg,
      card,
      subtle,
      subtle2: mix(bg, '#FFFFFF', 0.21),
      border: subtle,
      borderSoft: mix(bg, '#FFFFFF', 0.11),
      seg: card,
      note: card,
      noteDone: mix(bg, '#000000', 0.35),
      noteLight: card,
      noteInput: subtle,
      noteBox: subtle,
      noteLine: subtle,
      checkLine: mix(bg, '#FFFFFF', 0.35),
      cardEdge: 'transparent',
      switchOff: mix(bg, '#FFFFFF', 0.22),
    };
  }
  const card = mix(bg, '#FFFFFF', 0.7);
  const subtle = mix(card, t, 0.04);
  return {
    bg,
    card,
    subtle,
    subtle2: mix(card, t, 0.085),
    border: mix(bg, t, 0.11),
    borderSoft: mix(bg, t, 0.065),
    seg: mix(bg, t, 0.08),
    note: card,
    noteDone: mix(bg, t, 0.07),
    noteLight: card,
    noteInput: subtle,
    noteBox: subtle,
    noteLine: mix(card, t, 0.1),
    checkLine: mix(card, t, 0.25),
    cardEdge: mix(bg, t, 0.1),
    switchOff: mix(bg, t, 0.18),
  };
}

/** Accent tokens worked out from any button color, kept readable on the given palette. */
function accentFrom(p: Palette, accent: string): Partial<Palette> {
  const toward = p.dark ? '#FFFFFF' : DARK_TEXT;
  const accentText = ensureContrast(accent, [p.bg, p.card], 4.5, toward);
  const accentSoft = mix(p.bg, accent, p.dark ? 0.24 : 0.17);
  return {
    accent,
    onAccent: textOn(accent),
    accentText,
    link: accentText,
    accentSoft,
    onAccentSoft: ensureContrast(accent, [accentSoft], 4.5, toward),
  };
}

const paletteCache: Record<string, Palette> = {};

/**
 * The palette for the chosen mode, button color (preset key or hex) and background
 * ('default' or hex). A custom background decides by itself whether the app is light or dark.
 */
export function paletteFor(dark: boolean, accentKey?: string, bgKey?: string): Palette {
  const customBg = isHex(bgKey) ? readableBg(bgKey) : null;
  const isDark = customBg ? bgIsDark(customBg) : dark;
  const key = `${isDark ? 'd' : 'l'}:${accentKey ?? 'yellow'}:${customBg ?? '-'}`;
  if (!paletteCache[key]) {
    const base0 = isDark ? DARK : LIGHT;
    let p: Palette = base0;
    if (customBg) {
      p = { ...base0, ...surfacesFor(base0, customBg) };
      p = {
        ...p,
        muted: ensureContrast(base0.muted, [p.bg, p.card], 4.5, base0.text),
        text2: ensureContrast(base0.text2, [p.bg, p.card], 7, base0.text),
      };
    }
    const preset = ACCENTS.find((x) => x.key === accentKey);
    if (customBg || isHex(accentKey)) {
      p = { ...p, ...accentFrom(p, accentColorFor(accentKey, isDark)) };
    } else if (preset && preset.key !== 'yellow') {
      p = { ...p, ...(isDark ? preset.dark : preset.light) };
    }
    p = { ...p, accentOnPrimary: ensureContrast(p.accent, [p.primary], 3, p.onPrimary) };
    paletteCache[key] = p;
  }
  return paletteCache[key];
}
