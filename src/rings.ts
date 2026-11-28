import { GeoAlarm } from '../modules/geo-alarm';
import { AlarmClock, SoundKind, loadSounds } from './storage';

export const RING_DURATION_MS: Record<SoundKind, number> = {
  alarm: 10 * 60 * 1000,
  timer: 3 * 60 * 1000,
  reminder: 3 * 60 * 1000,
  geo: 3 * 60 * 1000,
};

export const TIMER_RING_ID = 'timer';
export const noteRingId = (noteId: string) => `note:${noteId}`;
export const alarmRingId = (alarmId: string) => `alarm:${alarmId}`;

async function soundFor(kind: SoundKind): Promise<string> {
  const s = await loadSounds();
  return s[kind] ?? '';
}

export async function ringNow(kind: SoundKind, title: string, body: string) {
  GeoAlarm.triggerAlarm(title, body, kind, (await soundFor(kind)) || null, RING_DURATION_MS[kind]);
}

export async function scheduleSimpleRing(id: string, kind: SoundKind, at: number, title: string, body: string) {
  GeoAlarm.scheduleRing({
    id,
    at,
    title,
    body,
    kind,
    sound: await soundFor(kind),
    durationMs: RING_DURATION_MS[kind],
    snoozeMin: 0,
    snoozeLeft: 0,
    daysMask: 0,
    hour: 0,
    minute: 0,
  });
}

export function cancelRing(id: string) {
  GeoAlarm.cancelRing(id);
}

export function daysMask(days: number[]): number {
  return days.reduce((m, d) => m | (1 << d), 0);
}

/** Next occurrence (epoch ms) of hour:minute on one of the given days (empty = any day). */
export function nextAlarmTime(hour: number, minute: number, days: number[], from = Date.now()): number {
  for (let d = 0; d <= 7; d++) {
    const c = new Date(from);
    c.setHours(hour, minute, 0, 0);
    c.setDate(c.getDate() + d);
    if (c.getTime() <= from) continue;
    if (days.length === 0 || days.includes(c.getDay())) return c.getTime();
  }
  return from + 24 * 3600 * 1000;
}

/** Epoch-day (days since 1970-01-01) of a local date. */
export function epochDay(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Epoch-day of the Sunday of the week containing `at` (plus `weeks` weeks). */
export function weekSunday(at: number, weeks = 0): number {
  const d = new Date(at);
  return epochDay(d) - d.getDay() + weeks * 7;
}

/** The next occurrence strictly after `from`, ignoring skipNext. 0 = none (one-time alarm in the past). */
function occurrenceAfter(a: AlarmClock, from: number): number {
  if (a.days.length === 0) {
    if (a.date) {
      const [y, mo, d] = a.date.split('-').map(Number);
      const t = new Date(y, mo - 1, d, a.hour, a.minute, 0, 0).getTime();
      return t > from ? t : 0;
    }
    return nextAlarmTime(a.hour, a.minute, [], from);
  }
  const spec = {
    hour: a.hour,
    minute: a.minute,
    daysMask: daysMask(a.days),
    weekAnchor: a.everyOtherWeek ? a.weekAnchor ?? 0 : 0,
    skipHolidays: !!a.skipHolidays,
  };
  const native = GeoAlarm.computeNextRing(spec, from);
  if (native > from) return native;
  // Fallback without the native module (holidays not known here).
  let t = from;
  for (let i = 0; i < 60; i++) {
    t = nextAlarmTime(a.hour, a.minute, a.days, t);
    if (!spec.weekAnchor || (((Math.floor((epochDay(new Date(t)) - spec.weekAnchor) / 7) % 2) + 2) % 2) === 0) return t;
  }
  return t;
}

/** When the alarm will ring next (taking a skipped occurrence into account). 0 = not in the future. */
export function alarmNextAt(a: AlarmClock, from = Date.now()): number {
  let t = occurrenceAfter(a, from);
  if (t && a.skipNext && t === a.skipNext) t = occurrenceAfter(a, t + 1000);
  return t;
}

/** The occurrence after the next one (for "skip once"). */
export function alarmOccurrenceAfterNext(a: AlarmClock): number {
  const first = occurrenceAfter(a, Date.now());
  return first ? occurrenceAfter(a, first + 1000) : 0;
}

/** Next occurrence ignoring skipNext. */
export function alarmPlainNext(a: AlarmClock): number {
  return occurrenceAfter(a, Date.now());
}

/** Holiday that a holiday-skipping alarm will skip next ('' if none before its next ring). */
export function skippedHolidayBefore(a: AlarmClock, nextAt: number): string {
  if (!a.skipHolidays || a.days.length === 0 || !nextAt) return '';
  const plain = occurrenceAfter({ ...a, skipHolidays: false }, Date.now());
  if (!plain || plain >= nextAt) return '';
  return GeoAlarm.holidayName(plain);
}

/** Schedules the alarm; returns when it will ring (0 = not scheduled). */
export async function scheduleAlarmClock(a: AlarmClock): Promise<number> {
  cancelRing(alarmRingId(a.id));
  if (!a.enabled) return 0;
  const at = alarmNextAt(a);
  if (!at) return 0;
  GeoAlarm.scheduleRing({
    id: alarmRingId(a.id),
    at,
    title: a.label || 'שעון מעורר',
    body: `${String(a.hour).padStart(2, '0')}:${String(a.minute).padStart(2, '0')}`,
    kind: 'alarm',
    sound: await soundFor('alarm'),
    durationMs: RING_DURATION_MS.alarm,
    snoozeMin: a.snoozeEnabled ? a.snoozeMin : 0,
    snoozeLeft: a.snoozeEnabled ? a.snoozeCount : 0,
    daysMask: daysMask(a.days),
    hour: a.hour,
    minute: a.minute,
    weekAnchor: a.days.length && a.everyOtherWeek ? a.weekAnchor ?? 0 : 0,
    skipHolidays: !!a.skipHolidays && a.days.length > 0,
    challenge: a.challenge ?? 'none',
    speak: !!a.speak,
  });
  return at;
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "יום ב' 07:00" style label of a ring time, with today/tomorrow words. */
export function ringDayText(at: number): string {
  const d = new Date(at);
  const today = epochDay(new Date());
  const diff = epochDay(d) - today;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 0) return `היום ${time}`;
  if (diff === 1) return `מחר ${time}`;
  if (diff < 7) return `יום ${DAY_NAMES[d.getDay()]} ${time}`;
  return `${d.toLocaleDateString('he-IL')} ${time}`;
}

export function scheduledRingIds(): Set<string> {
  return new Set(GeoAlarm.getScheduledRingIds());
}

export function untilText(at: number): string {
  const mins = Math.max(1, Math.round((at - Date.now()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const d = Math.floor(h / 24);
  if (d >= 1) return `בעוד ${d} ימים ו-${h % 24} שעות`;
  if (h >= 1) return `בעוד ${h} שעות ו-${m} דקות`;
  return `בעוד ${m} דקות`;
}

// ---------- v4: generic reminders (notes & tasks), once or repeating ----------

export interface ReminderSpec {
  id: string;
  title: string;
  body: string;
  silent: boolean;
  once?: { at: number };
  repeat?: { days: number[]; hour: number; minute: number; endAt: number };
}

/** Schedules a reminder. Returns false when there is no future occurrence. */
export async function scheduleReminder(spec: ReminderSpec): Promise<boolean> {
  cancelRing(spec.id);
  let at = 0;
  if (spec.once) at = spec.once.at;
  if (spec.repeat) at = nextAlarmTime(spec.repeat.hour, spec.repeat.minute, spec.repeat.days);
  if (!at || at <= Date.now()) return false;
  if (spec.repeat && spec.repeat.endAt && at > spec.repeat.endAt) return false;
  GeoAlarm.scheduleRing({
    id: spec.id,
    at,
    title: spec.title,
    body: spec.body,
    kind: 'reminder',
    sound: await soundFor('reminder'),
    durationMs: RING_DURATION_MS.reminder,
    snoozeMin: 0,
    snoozeLeft: 0,
    daysMask: spec.repeat ? daysMask(spec.repeat.days) : 0,
    hour: spec.repeat?.hour ?? 0,
    minute: spec.repeat?.minute ?? 0,
    endAt: spec.repeat?.endAt ?? 0,
    silent: spec.silent,
  });
  return true;
}

export const taskRingId = (taskId: string) => `task:${taskId}`;
