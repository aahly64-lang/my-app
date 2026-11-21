import { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';

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
}

export const LIGHT: Palette = {
  dark: false,
  bg: '#F2F2F4',
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
