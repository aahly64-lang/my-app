import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useAppStyles } from './appStyles';
import { useTheme } from './theme';
import { AlarmClock } from './storage';
import { alarmNextAt, ringDayText, skippedHolidayBefore, untilText } from './rings';

/** Re-renders once a minute (only the component that uses it). */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
}

/** "Rings tomorrow 07:00 · in 9 hours" under an alarm in the list (plus a skipped ring or holiday). */
export function AlarmWhen({ a }: { a: AlarmClock }) {
  useMinuteTick();
  const styles = useAppStyles();
  const c = useTheme();
  if (!a.enabled) return null;
  const at = alarmNextAt(a);
  if (!at) return null;
  const skipped = !!a.skipNext && a.skipNext > Date.now();
  const holiday = skippedHolidayBefore(a, at);
  return (
    <Text style={[styles.itemSub, { color: c.accent, marginTop: 2 }]}>
      {skipped ? '⏭️ מדלג על הקרוב · ' : ''}
      {holiday ? `⏭️ מדלג על ${holiday} · ` : ''}
      {`מצלצל ${ringDayText(at)} · ${untilText(at)}`}
    </Text>
  );
}

/** One line at the top of the alarms card: which alarm rings next. */
export function NextAlarmLine({ alarms }: { alarms: AlarmClock[] }) {
  useMinuteTick();
  const styles = useAppStyles();
  let best: { a: AlarmClock; at: number } | null = null;
  for (const a of alarms) {
    if (!a.enabled) continue;
    const at = alarmNextAt(a);
    if (at && (!best || at < best.at)) best = { a, at };
  }
  if (!best) return null;
  return (
    <Text style={[styles.itemSub, { marginBottom: 8, fontWeight: '600' }]}>
      {`⏰ השעון הבא: ${ringDayText(best.at)}${best.a.label ? ` (${best.a.label})` : ''} · ${untilText(best.at)}`}
    </Text>
  );
}
