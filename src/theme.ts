import { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';

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
  accent: string; // dark buttons / active chips (white text on top)
  note: string;
  noteDone: string;
  noteLight: string;
  noteInput: string;
  noteBox: string;
  noteText: string;
  noteText2: string;
  link: string;
  warnBg: string;
  warnText: string;
  okBg: string;
  okText: string;
  infoBg: string;
  infoText: string;
}

export const LIGHT: Palette = {
  dark: false,
  bg: '#EFECE4',
  card: '#FFFFFF',
  subtle: '#F1F5F9',
  subtle2: '#E2E8F0',
  border: '#CBD5E1',
  borderSoft: '#F1F5F9',
  text: '#0F172A',
  text2: '#334155',
  muted: '#64748B',
  accent: '#0F172A',
  note: '#FEF08A',
  noteDone: '#E7E5E4',
  noteLight: '#FEF9C3',
  noteInput: '#FFFBEB',
  noteBox: '#FEF08A',
  noteText: '#422006',
  noteText2: '#713F12',
  link: '#0284C7',
  warnBg: '#FEF3C7',
  warnText: '#92400E',
  okBg: '#DCFCE7',
  okText: '#166534',
  infoBg: '#DBEAFE',
  infoText: '#1E3A8A',
};

export const DARK: Palette = {
  dark: true,
  bg: '#0B1220',
  card: '#172033',
  subtle: '#1E293B',
  subtle2: '#273449',
  border: '#334155',
  borderSoft: '#1E293B',
  text: '#F1F5F9',
  text2: '#CBD5E1',
  muted: '#94A3B8',
  accent: '#334155',
  note: '#E6CF5C',
  noteDone: '#57534E',
  noteLight: '#EADB8A',
  noteInput: '#F6EDB8',
  noteBox: '#DCC24E',
  noteText: '#2A1503',
  noteText2: '#4A2C0A',
  link: '#38BDF8',
  warnBg: '#422006',
  warnText: '#FCD34D',
  okBg: '#14532D',
  okText: '#BBF7D0',
  infoBg: '#1E3A8A',
  infoText: '#DBEAFE',
};

export const ThemeContext = createContext<Palette>(LIGHT);

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

/** Builds themed styles once per palette. */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T): T {
  const c = useTheme();
  return useMemo(() => StyleSheet.create(factory(c)), [c, factory]);
}
