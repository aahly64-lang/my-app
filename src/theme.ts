// Visual theme "גרפיט וצהוב": colors for light and dark mode (follows the phone),
// and the Heebo font. Only looks are defined here – no app logic.
import { ColorSchemeName, StyleSheet, TextStyle } from 'react-native';

export type Palette = {
  dark: boolean;
  bg: string; // screen background
  surface: string; // cards, header
  surface2: string; // inputs on cards, quiet buttons
  seg: string; // segmented / tab track
  line: string; // hairlines and borders
  text: string;
  text2: string; // secondary text
  muted: string; // hints, dates
  accent: string; // the yellow
  onAccent: string; // text on the yellow
  accentText: string; // yellow used as text (readable on bg)
  accentSoft: string; // pale yellow backgrounds
  onAccentSoft: string;
  note: string; // sticky note card
  noteLine: string;
  noteText: string;
  noteBody: string;
  noteDone: string;
  checkLine: string;
  success: string;
  successSoft: string;
  onSuccessSoft: string;
  danger: string;
  dangerSoft: string;
  onDangerSoft: string;
  info: string;
  infoSoft: string;
  onInfoSoft: string;
  warnSoft: string;
  onWarnSoft: string;
  overlay: string;
  primary: string; // strong neutral button (graphite / white)
  onPrimary: string;
};

export const LIGHT: Palette = {
  dark: false,
  bg: '#F2F2F4',
  surface: '#FFFFFF',
  surface2: '#F4F4F6',
  seg: '#E5E5EA',
  line: '#E2E2E6',
  text: '#111113',
  text2: '#3A3A40',
  muted: '#6B6B73',
  accent: '#FFD60A',
  onAccent: '#111113',
  accentText: '#7A5F00',
  accentSoft: '#FFF4BF',
  onAccentSoft: '#5C4700',
  note: '#FFFFFF',
  noteLine: '#E6E6EA',
  noteText: '#111113',
  noteBody: '#45454C',
  noteDone: '#ECECEF',
  checkLine: '#C7C7CE',
  success: '#248A3D',
  successSoft: '#DDF3E3',
  onSuccessSoft: '#1B6B30',
  danger: '#D70015',
  dangerSoft: '#FDE2E4',
  onDangerSoft: '#9F0010',
  info: '#0066CC',
  infoSoft: '#E0EEFF',
  onInfoSoft: '#004C99',
  warnSoft: '#FFF4BF',
  onWarnSoft: '#6B5300',
  overlay: 'rgba(0, 0, 0, 0.45)',
  primary: '#1C1C1E',
  onPrimary: '#FFFFFF',
};

export const DARK: Palette = {
  dark: true,
  bg: '#000000',
  surface: '#1C1C1E',
  surface2: '#2C2C2E',
  seg: '#1C1C1E',
  line: '#2C2C2E',
  text: '#F5F5F7',
  text2: '#D1D1D6',
  muted: '#9C9CA3',
  accent: '#FFD60A',
  onAccent: '#111113',
  accentText: '#FFD60A',
  accentSoft: '#3A3204',
  onAccentSoft: '#FFE066',
  note: '#1C1C1E',
  noteLine: '#2C2C2E',
  noteText: '#F5F5F7',
  noteBody: '#C7C7CC',
  noteDone: '#121214',
  checkLine: '#5A5A60',
  success: '#30D158',
  successSoft: '#0F2E18',
  onSuccessSoft: '#6EE28D',
  danger: '#FF453A',
  dangerSoft: '#3A1212',
  onDangerSoft: '#FF8A80',
  info: '#0A84FF',
  infoSoft: '#0B2440',
  onInfoSoft: '#7DB9FF',
  warnSoft: '#3A3204',
  onWarnSoft: '#FFE066',
  overlay: 'rgba(0, 0, 0, 0.65)',
  primary: '#F5F5F7',
  onPrimary: '#111113',
};

export function paletteFor(scheme: ColorSchemeName): Palette {
  return scheme === 'dark' ? DARK : LIGHT;
}

// Heebo is bundled into the APK (expo-font plugin in app.json). On Android each weight is its
// own font family, so fontWeight is translated to the matching family.
const FONT_BY_WEIGHT: Record<string, string> = {
  normal: 'Heebo_400Regular',
  '100': 'Heebo_400Regular',
  '200': 'Heebo_400Regular',
  '300': 'Heebo_300Light',
  '400': 'Heebo_400Regular',
  '500': 'Heebo_500Medium',
  '600': 'Heebo_600SemiBold',
  bold: 'Heebo_700Bold',
  '700': 'Heebo_700Bold',
  '800': 'Heebo_800ExtraBold',
  '900': 'Heebo_800ExtraBold',
};

export function font(weight: TextStyle['fontWeight'] = '400'): TextStyle {
  return { fontFamily: FONT_BY_WEIGHT[String(weight)] ?? 'Heebo_400Regular' };
}

function withFonts<T extends Record<string, any>>(defs: T): T {
  const out: Record<string, any> = {};
  for (const key of Object.keys(defs)) {
    const s = { ...defs[key] };
    if (s.fontWeight !== undefined || s.fontSize !== undefined) {
      s.fontFamily = FONT_BY_WEIGHT[String(s.fontWeight ?? '400')] ?? 'Heebo_400Regular';
      delete s.fontWeight;
    }
    out[key] = s;
  }
  return out as T;
}

// Builds the same style sheet twice (light + dark) once, at start-up.
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T) {
  const light = StyleSheet.create(withFonts(factory(LIGHT)));
  const dark = StyleSheet.create(withFonts(factory(DARK)));
  return {
    light,
    get: (scheme: ColorSchemeName) => (scheme === 'dark' ? dark : light),
  };
}

// Common shadow for raised cards.
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
