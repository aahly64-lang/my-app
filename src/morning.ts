import * as Notifications from 'expo-notifications';
import { DocMeta, Task, loadDocMeta, loadMorning, loadTasks } from './storage';

// v2: no number on the app icon (a channel's badge setting can't be changed later)
const MORNING_CHANNEL = 'morning_v2';
const ids = Array.from({ length: 7 }, (_, i) => `morning-${i}`);

/** Documents show up in the summary from this many days before their expiry. */
const DOC_DAYS = 14;

const daysBetween = (fromYmd: string, toYmd: string) => {
  const t = (s: string) => {
    const [y, mo, d] = s.split('-').map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  return Math.round((t(toYmd) - t(fromYmd)) / 86_400_000);
};

const expiryWords = (left: number) =>
  left < 0 ? `פג תוקף לפני ${-left} ימים` : left === 0 ? 'פג תוקף היום' : left === 1 ? 'פג תוקף מחר' : `פג תוקף בעוד ${left} ימים`;

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Morning summary: one notification per day for the next 7 days, each listing the open tasks due that day
 * (and overdue ones), plus documents whose expiry is close. Rebuilt whenever the tasks or the setting change, so the content stays current.
 */
export async function scheduleMorning(tasks: Task[], cfg: { enabled: boolean; time: string }) {
  for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (!cfg.enabled) return;
  await Notifications.setNotificationChannelAsync(MORNING_CHANNEL, {
    name: 'סיכום בוקר',
    importance: Notifications.AndroidImportance.DEFAULT,
    showBadge: false,
  }).catch(() => {});
  const meta = await loadDocMeta().catch(() => ({} as Record<string, DocMeta>));
  const docs = Object.values(meta).filter((d) => !!d.expiry && !d.archived);
  const [h, m] = cfg.time.split(':').map(Number);
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const day = ymd(at);
    const open = tasks.filter((t) => !t.done && t.due && t.due <= day);
    // documents whose expiry is within DOC_DAYS days of that morning (or passed in the last week)
    const expiring = docs
      .map((d) => ({ name: d.name.replace(/\.[^.]+$/, ''), left: daysBetween(day, d.expiry!) }))
      .filter((d) => d.left <= DOC_DAYS && d.left >= -7)
      .sort((a, b) => a.left - b.left);
    if (!open.length && !expiring.length) continue;
    const late = open.filter((t) => t.due! < day).length;
    const sorted = [...open].sort((a, b) => Number(!!b.star) - Number(!!a.star) || (a.due! < b.due! ? -1 : 1));
    const lines = sorted.slice(0, 6).map((t) => `${t.due! < day ? '🔴' : t.star ? '⭐' : '•'} ${t.title}`);
    if (sorted.length > 6) lines.push(`ועוד ${sorted.length - 6}…`);
    for (const d of expiring.slice(0, 3)) lines.push(`📄 ${d.name}: ${expiryWords(d.left)}`);
    if (expiring.length > 3) lines.push(`📄 ועוד ${expiring.length - 3} מסמכים`);
    const title = open.length
      ? `☀️ ${open.length} משימות להיום${late ? ` (${late} באיחור)` : ''}`
      : `☀️ ${expiring.length === 1 ? 'מסמך שתוקפו מסתיים' : `${expiring.length} מסמכים שתוקפם מסתיים`}`;
    await Notifications.scheduleNotificationAsync({
      identifier: ids[i],
      content: {
        title,
        body: lines.join('\n'),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: MORNING_CHANNEL },
    }).catch(() => {});
  }
}

/** Rebuilds the morning summary from storage (after a document's expiry changed, or when the app opens). */
export async function refreshMorning() {
  try {
    await scheduleMorning(await loadTasks(), await loadMorning());
  } catch {}
}
