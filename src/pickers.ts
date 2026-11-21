import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { localDateString } from './storage';

/** Time picker with scrolling wheels (no clock dial). */
export function pickTimeWheels(hour: number, minute: number, onPick: (h: number, m: number) => void) {
  const base = new Date();
  base.setHours(hour, minute, 0, 0);
  DateTimePickerAndroid.open({
    value: base,
    mode: 'time',
    display: 'spinner',
    is24Hour: true,
    onChange: (e, d) => {
      if (e.type === 'set' && d) onPick(d.getHours(), d.getMinutes());
    },
  });
}

export function parseHHMM(t?: string): [number, number] {
  const m = (t ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? [Number(m[1]), Number(m[2])] : [9, 0];
}

export function hhmm(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseYMD(s?: string): Date | null {
  const m = (s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function displayYMD(s?: string): string {
  const d = parseYMD(s);
  return d ? d.toLocaleDateString('he-IL') : '';
}

/** Calendar date picker. */
export function pickDate(current: string | undefined, onPick: (ymd: string) => void, minToday = true) {
  DateTimePickerAndroid.open({
    value: parseYMD(current) ?? new Date(),
    mode: 'date',
    minimumDate: minToday ? new Date() : undefined,
    onChange: (e, d) => {
      if (e.type === 'set' && d) onPick(localDateString(d));
    },
  });
}

/** End of the given local day, epoch ms. */
export function endOfDay(ymd: string): number {
  const d = parseYMD(ymd);
  if (!d) return 0;
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export function daysSummary(days: number[]): string {
  if (days.length === 0) return 'פעם אחת';
  if (days.length === 7) return 'כל יום';
  const sorted = [...days].sort();
  if (sorted.join() === '0,1,2,3,4') return 'א׳–ה׳';
  if (sorted.join() === '0,1,2,3,4,5') return 'א׳–ו׳';
  return sorted.map((d) => DAY_LETTERS[d] + '׳').join(' ');
}
