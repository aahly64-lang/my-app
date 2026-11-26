import { daysSummary, parseYMD } from './pickers';
import { Task, localDateString } from './storage';

/**
 * Recurring tasks. A task repeats by one of:
 *  - repeatDays:     week days (0 = Sunday)          "כל יום שלישי"
 *  - repeatMonthDay: day of the month (1–31)         "כל חודש ב-10"
 *  - repeatEvery:    every N days                    "כל 3 ימים", "כל שבועיים"
 * When it is checked off it moves to the next date instead of being done.
 */
export type RepeatFields = Pick<Task, 'repeatDays' | 'repeatMonthDay' | 'repeatEvery'>;

export const hasRepeat = (t: RepeatFields) => !!(t.repeatDays?.length || t.repeatMonthDay || t.repeatEvery);

export const noRepeat: RepeatFields = { repeatDays: undefined, repeatMonthDay: undefined, repeatEvery: undefined };

export function addDaysYMD(ymd: string, n: number): string {
  const d = parseYMD(ymd) ?? new Date();
  d.setDate(d.getDate() + n);
  return localDateString(d);
}

/** The given day of the month in (year, month), clamped to the month's last day. */
function monthDate(y: number, m: number, day: number) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}

/** First date strictly after `from` (or on it, with inclusive) on which the task repeats. */
export function nextRepeatDue(t: RepeatFields, from: string, inclusive = false): string {
  const start = inclusive ? addDaysYMD(from, -1) : from;
  if (t.repeatDays?.length) {
    for (let i = 1; i <= 7; i++) {
      const cand = addDaysYMD(start, i);
      const d = parseYMD(cand);
      if (d && t.repeatDays.includes(d.getDay())) return cand;
    }
    return addDaysYMD(start, 7);
  }
  if (t.repeatMonthDay) {
    const s = parseYMD(start) ?? new Date();
    let c = monthDate(s.getFullYear(), s.getMonth(), t.repeatMonthDay);
    if (localDateString(c) <= start) c = monthDate(s.getFullYear(), s.getMonth() + 1, t.repeatMonthDay);
    return localDateString(c);
  }
  if (t.repeatEvery) return inclusive ? from : addDaysYMD(from, t.repeatEvery);
  return addDaysYMD(from, 1);
}

export function repeatSummary(t: RepeatFields): string {
  if (t.repeatDays?.length) return daysSummary(t.repeatDays);
  if (t.repeatMonthDay) return `כל ${t.repeatMonthDay} בחודש`;
  if (t.repeatEvery === 1) return 'כל יום';
  if (t.repeatEvery === 2) return 'כל יומיים';
  if (t.repeatEvery === 7) return 'כל שבוע';
  if (t.repeatEvery === 14) return 'כל שבועיים';
  if (t.repeatEvery) return `כל ${t.repeatEvery} ימים`;
  return '';
}
