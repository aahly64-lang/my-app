import * as Notifications from 'expo-notifications';
import { Task } from './storage';

const ids = Array.from({ length: 7 }, (_, i) => `morning-${i}`);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Morning summary: one notification per day for the next 7 days, each listing the open tasks due that day
 * (and overdue ones). Rebuilt whenever the tasks or the setting change, so the content stays current.
 */
export async function scheduleMorning(tasks: Task[], cfg: { enabled: boolean; time: string }) {
  for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (!cfg.enabled) return;
  await Notifications.setNotificationChannelAsync('morning', {
    name: 'סיכום בוקר',
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {});
  const [h, m] = cfg.time.split(':').map(Number);
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const day = ymd(at);
    const open = tasks.filter((t) => !t.done && t.due && t.due <= day);
    if (!open.length) continue;
    const late = open.filter((t) => t.due! < day).length;
    const sorted = [...open].sort((a, b) => Number(!!b.star) - Number(!!a.star) || (a.due! < b.due! ? -1 : 1));
    const lines = sorted.slice(0, 6).map((t) => `${t.due! < day ? '🔴' : t.star ? '⭐' : '•'} ${t.title}`);
    if (sorted.length > 6) lines.push(`ועוד ${sorted.length - 6}…`);
    await Notifications.scheduleNotificationAsync({
      identifier: ids[i],
      content: {
        title: `☀️ ${open.length} משימות להיום${late ? ` (${late} באיחור)` : ''}`,
        body: lines.join('\n'),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'morning' },
    }).catch(() => {});
  }
}
