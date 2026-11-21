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

export async function scheduleAlarmClock(a: AlarmClock) {
  cancelRing(alarmRingId(a.id));
  if (!a.enabled) return;
  GeoAlarm.scheduleRing({
    id: alarmRingId(a.id),
    at: nextAlarmTime(a.hour, a.minute, a.days),
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
  });
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
