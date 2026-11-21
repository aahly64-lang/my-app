import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ringNow } from './rings';
import {
  AlarmArea,
  addGeoLog,
  loadAreas,
  loadTasks,
  loadAreaStates,
  saveAreas,
  saveAreaStates,
} from './storage';

export const GEOFENCE_TASK = 'avi-geofence-alarm-task';

/** Minimum time between two rings of the same area in "every" mode. */
const EVERY_MODE_COOLDOWN_MS = 15 * 60 * 1000;

/** Minimum radius allowed by the map picker. */
export const MIN_RADIUS_M = 150;
export const MAX_RADIUS_M = 5000;

type GeofenceTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

/**
 * Ring rules:
 * - Ring only on a real transition outside -> inside. When an area is created/edited
 *   the app checks the current position and records inside/outside right away, so if
 *   you are already inside it does not ring; it rings the next time you enter.
 * - "every" mode: ring again only after leaving and at least 15 minutes after the last ring.
 * - "once" mode: after ringing, the area is switched off.
 */
TaskManager.defineTask<GeofenceTaskData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    await addGeoLog({ label: 'מערכת', kind: 'problem', text: 'שגיאה מהמערכת: ' + (error.message ?? 'לא ידועה') });
    return;
  }
  if (!data) return;
  const { eventType, region } = data;
  const id = region.identifier;
  if (!id) return;

  const states = await loadAreaStates();
  const prev = states[id] ?? {};
  const areas = await loadAreas();
  const area = areas.find((a) => a.id === id);
  const label = area?.label || 'אזור';

  if (eventType === Location.GeofencingEventType.Exit) {
    states[id] = { ...prev, inside: 'outside' };
    await saveAreaStates(states);
    await addGeoLog({ label, kind: 'exit', text: 'יצאת מהאזור' });
    return;
  }

  if (eventType !== Location.GeofencingEventType.Enter) return;

  states[id] = { ...prev, inside: 'inside' };
  const linkedTasks = (await loadTasks()).filter((t) => !t.done && t.areaId === id);

  let skip: string | null = null;
  if (!area) skip = 'האזור כבר לא קיים';
  else if (!area.enabled && linkedTasks.length === 0) skip = 'האזור כבוי';
  else if (prev.inside === 'inside') skip = 'כבר היית בתוך האזור';
  else if (prev.inside !== 'outside') skip = 'לא היה ידוע שהיית בחוץ';
  else if (
    prev.lastRingAt &&
    Date.now() - prev.lastRingAt < EVERY_MODE_COOLDOWN_MS &&
    (area.mode === 'every' || !area.enabled)
  )
    skip = 'צלצל לפני פחות מ-15 דקות';

  if (skip || !area) {
    await saveAreaStates(states);
    await addGeoLog({ label, kind: 'enter', text: 'נכנסת · לא צלצל: ' + skip, ok: false });
    return;
  }

  states[id] = { ...states[id], lastRingAt: Date.now() };
  await saveAreaStates(states);

  const parts: string[] = [];
  if (area.enabled && area.note?.trim()) parts.push(area.note.trim());
  if (linkedTasks.length) parts.push('משימות: ' + linkedTasks.map((t) => t.title).join(', '));
  try {
    await ringNow('geo', area.label || 'הגעת לאזור', parts.join('\n') || 'נכנסת לאזור שהגדרת');
    await addGeoLog({ label, kind: 'enter', text: 'נכנסת · צלצל', ok: true });
  } catch (e: any) {
    await addGeoLog({ label, kind: 'problem', text: 'נכנסת, אבל הצלצול נכשל: ' + (e?.message ?? '') });
  }

  if (area.enabled && area.mode === 'once') {
    const updated = areas.map((a) => (a.id === id ? { ...a, enabled: false } : a));
    await saveAreas(updated);
    await syncGeofences(updated, { keepStates: true });
  }
});

/** Distance in meters between two points. */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * For areas whose inside/outside state is unknown (new or moved), check the
 * current position right away and record it, so the next real entry rings
 * even if Android's initial event never reaches the app.
 */
async function resolveUnknownStates(active: AlarmArea[]) {
  const states = await loadAreaStates();
  const unknown = active.filter((a) => !states[a.id]?.inside);
  if (unknown.length === 0) return;

  let pos: Location.LocationObject | null = null;
  try {
    pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 15000)),
    ]);
  } catch {
    pos = null;
  }
  if (!pos) {
    try {
      pos = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
    } catch {
      pos = null;
    }
  }
  if (!pos) {
    for (const a of unknown)
      await addGeoLog({ label: a.label || 'אזור', kind: 'problem', text: 'לא הצלחתי לקבל מיקום. בדוק שה-GPS דלוק' });
    return;
  }

  const fresh = await loadAreaStates();
  for (const a of unknown) {
    if (fresh[a.id]?.inside) continue; // an event arrived meanwhile
    const d = distanceM(pos.coords.latitude, pos.coords.longitude, a.latitude, a.longitude);
    const inside = d <= Math.max(MIN_RADIUS_M, a.radiusMeters);
    fresh[a.id] = { ...fresh[a.id], inside: inside ? 'inside' : 'outside' };
    await addGeoLog({
      label: a.label || 'אזור',
      kind: 'start',
      text: inside
        ? 'הופעל · אתה כרגע בתוך האזור (יצלצל בכניסה הבאה)'
        : `הופעל · אתה בחוץ (${d >= 1000 ? (d / 1000).toFixed(1) + ' ק"מ' : Math.round(d) + ' מ\''}) · יצלצל בכניסה`,
      ok: true,
    });
  }
  await saveAreaStates(fresh);
}

/**
 * Registers the enabled areas with Android. Call after any change to the list.
 * Areas whose position/radius changed get their state reset to "unknown".
 */
export async function syncGeofences(
  areas: AlarmArea[],
  opts: { keepStates?: boolean; resetIds?: string[] } = {}
): Promise<'ok' | 'no-permission' | 'error'> {
  try {
    if (!opts.keepStates && opts.resetIds?.length) {
      const states = await loadAreaStates();
      for (const id of opts.resetIds) delete states[id];
      await saveAreaStates(states);
    }

    // Areas that are switched on, or that have open tasks linked to them.
    const linked = new Set((await loadTasks()).filter((t) => !t.done && t.areaId).map((t) => t.areaId));
    const active = areas.filter((a) => a.enabled || linked.has(a.id));
    const registered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);

    if (active.length === 0) {
      if (registered) await Location.stopGeofencingAsync(GEOFENCE_TASK);
      return 'ok';
    }

    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!fg.granted || !bg.granted) {
      await addGeoLog({
        label: 'מערכת',
        kind: 'problem',
        text: !bg.granted ? 'הרשאת מיקום אינה "כל הזמן" - האזורים לא פעילים' : 'אין הרשאת מיקום - האזורים לא פעילים',
      });
      return 'no-permission';
    }

    await resolveUnknownStates(active);

    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      active.map((a) => ({
        identifier: a.id,
        latitude: a.latitude,
        longitude: a.longitude,
        radius: Math.max(MIN_RADIUS_M, a.radiusMeters),
        notifyOnEnter: true,
        notifyOnExit: true,
      }))
    );
    return 'ok';
  } catch (e: any) {
    await addGeoLog({ label: 'מערכת', kind: 'problem', text: 'הפעלת מעקב האזורים נכשלה: ' + (e?.message ?? '') });
    return 'error';
  }
}
