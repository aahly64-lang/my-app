import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { GeoAlarm } from '../modules/geo-alarm';
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
const EVERY_MODE_COOLDOWN_MS = 8 * 60 * 1000;

/** Minimum radius allowed by the map picker. */
export const MIN_RADIUS_M = 150;
export const MAX_RADIUS_M = 5000;

type GeofenceTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

/**
 * Precise areas
 * -------------
 * Around every precise area there is a second, large "approach" geofence (~4 km).
 * - Entering the approach zone turns on close tracking (location every ~10 s,
 *   with the "📍 מעקב אזורים פעיל" notification).
 * - Entering the point itself (rang or not) turns close tracking off.
 * - Leaving the point (still inside the approach zone) turns it on again,
 *   ready for a return.
 * - Leaving the approach zone turns everything off.
 * Android allows starting the tracking service from the background only right
 * after a geofence event, which is exactly when we start it.
 */
// Renamed in 1.10.3 so its notification channel is created fresh as silent and badge-less.
export const PRECISE_TASK = 'avi-precise-location-task-v2';
const OLD_PRECISE_TASK = 'avi-precise-location-task';
const APPROACH_PREFIX = 'approach:';
const APPROACH_M = 4000;

const approachRadius = (a: AlarmArea) => Math.max(APPROACH_M, Math.max(MIN_RADIUS_M, a.radiusMeters) + 1500);

const CLOSE_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 10 * 1000,
  distanceInterval: 10,
  pausesUpdatesAutomatically: false,
  foregroundService: {
    notificationTitle: '📍 מעקב אזורים פעיל',
    notificationBody: 'אתה מתקרב לאזור במצב מדויק – בודק מיקום כדי לצלצל בזמן',
    notificationColor: '#FFD60A',
    killServiceOnDestroy: false,
  },
};

/** Serialises enter/exit handling so the geofence and precise tasks can't ring twice. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** Areas that should be watched: switched on, or with open tasks linked to them. */
async function activeAreas(areas: AlarmArea[]) {
  const linked = new Set((await loadTasks()).filter((t) => !t.done && t.areaId).map((t) => t.areaId));
  return areas.filter((a) => a.enabled || linked.has(a.id));
}

/** Stops the pre-1.10.3 tracking task if it is still running, and prepares the quiet channel. */
let quietDone = false;
export async function quietSetup() {
  if (quietDone) return;
  quietDone = true;
  let oldWasRunning = false;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(OLD_PRECISE_TASK)) {
      oldWasRunning = true;
      await Location.stopLocationUpdatesAsync(OLD_PRECISE_TASK);
    }
  } catch {
    // never started
  }
  GeoAlarm.quietNotifications(PRECISE_TASK);
  // If close tracking was on under the old name, start it again under the new (quiet) one.
  if (oldWasRunning) await updateClose();
}

async function isCloseRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(PRECISE_TASK);
  } catch {
    return false;
  }
}

/** Turns close tracking on or off according to the current states. */
async function updateClose(reasonLabel?: string) {
  const states = await loadAreaStates();
  const precise = (await activeAreas(await loadAreas())).filter((a) => a.precise);
  const want = precise.filter((a) => states[a.id]?.approach === 'inside' && states[a.id]?.armed);
  await quietSetup();
  const running = await isCloseRunning();
  const label = reasonLabel || want[0]?.label || 'מעקב צמוד';

  if (want.length > 0 && !running) {
    try {
      await Location.startLocationUpdatesAsync(PRECISE_TASK, CLOSE_OPTIONS);
      await addGeoLog({ label, kind: 'start', text: 'מעקב צמוד הופעל', ok: true });
    } catch (e: any) {
      await addGeoLog({
        label,
        kind: 'problem',
        text: 'מעקב צמוד לא הופעל (המנגנון הרגיל ימשיך לעבוד): ' + (e?.message ?? ''),
      });
    }
  } else if (want.length === 0 && running) {
    try {
      await Location.stopLocationUpdatesAsync(PRECISE_TASK);
    } catch {
      // already stopped
    }
    await addGeoLog({ label, kind: 'start', text: 'מעקב צמוד כובה' });
  }
}

/**
 * Ring rules:
 * - Ring only on a real transition outside -> inside. When an area is created/edited
 *   the app checks the current position and records inside/outside right away, so if
 *   you are already inside it does not ring; it rings the next time you enter.
 * - "every" mode: ring again only after leaving and at least 8 minutes after the last ring.
 * - "once" mode: after ringing, the area is switched off.
 * - source 'precise' only acts (and logs) when the state actually changes.
 */
function handleTransition(id: string, kind: 'enter' | 'exit', source: 'geofence' | 'precise') {
  return serial(async () => {
    const states = await loadAreaStates();
    const prev = states[id] ?? {};
    const areas = await loadAreas();
    const area = areas.find((a) => a.id === id);
    const label = area?.label || 'אזור';
    const tag = source === 'precise' ? ' (מדויק)' : '';

    if (kind === 'exit') {
      if (source === 'precise' && prev.inside === 'outside') return;
      states[id] = { ...prev, inside: 'outside', armed: prev.approach === 'inside' };
      await saveAreaStates(states);
      await addGeoLog({ label, kind: 'exit', text: 'יצאת מהאזור' + tag });
      if (area?.precise) await updateClose(label);
      return;
    }

    if (source === 'precise' && prev.inside === 'inside') return;

    states[id] = { ...prev, inside: 'inside', armed: false };
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
      skip = 'צלצל לפני פחות מ-8 דקות';

    if (skip || !area) {
      await saveAreaStates(states);
      await addGeoLog({ label, kind: 'enter', text: 'נכנסת' + tag + ' · לא צלצל: ' + skip, ok: false });
      if (area?.precise) await updateClose(label);
      return;
    }

    states[id] = { ...states[id], lastRingAt: Date.now() };
    await saveAreaStates(states);

    const parts: string[] = [];
    if (area.enabled && area.note?.trim()) parts.push(area.note.trim());
    if (linkedTasks.length) parts.push('משימות: ' + linkedTasks.map((t) => t.title).join(', '));
    try {
      await ringNow('geo', area.label || 'הגעת לאזור', parts.join('\n') || 'נכנסת לאזור שהגדרת');
      await addGeoLog({ label, kind: 'enter', text: 'נכנסת' + tag + ' · צלצל', ok: true });
    } catch (e: any) {
      await addGeoLog({ label, kind: 'problem', text: 'נכנסת, אבל הצלצול נכשל: ' + (e?.message ?? '') });
    }

    if (area.enabled && area.mode === 'once') {
      const updated = areas.map((a) => (a.id === id ? { ...a, enabled: false } : a));
      await saveAreas(updated);
      await syncGeofences(updated, { keepStates: true });
    } else if (area.precise) {
      await updateClose(label);
    }
  });
}

/** Entering / leaving the large approach zone around a precise area. */
function handleApproach(id: string, kind: 'enter' | 'exit') {
  return serial(async () => {
    const states = await loadAreaStates();
    const prev = states[id] ?? {};
    const area = (await loadAreas()).find((a) => a.id === id);
    if (!area) return;
    const label = area.label || 'אזור';
    if (kind === 'enter') {
      if (prev.approach === 'inside' && prev.armed === (prev.inside !== 'inside')) return;
      states[id] = { ...prev, approach: 'inside', armed: prev.inside !== 'inside' };
      await saveAreaStates(states);
      if (prev.approach !== 'inside') await addGeoLog({ label, kind: 'start', text: 'התקרבת לאזור' });
    } else {
      if (prev.approach === 'outside') return;
      states[id] = { ...prev, approach: 'outside', armed: false };
      await saveAreaStates(states);
      await addGeoLog({ label, kind: 'start', text: 'התרחקת מהאזור' });
    }
    await updateClose(label);
  });
}

TaskManager.defineTask<GeofenceTaskData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    await addGeoLog({ label: 'מערכת', kind: 'problem', text: 'שגיאה מהמערכת: ' + (error.message ?? 'לא ידועה') });
    return;
  }
  if (!data) return;
  const { eventType, region } = data;
  const rid = region.identifier;
  if (!rid) return;
  const kind =
    eventType === Location.GeofencingEventType.Enter
      ? 'enter'
      : eventType === Location.GeofencingEventType.Exit
        ? 'exit'
        : null;
  if (!kind) return;
  if (rid.startsWith(APPROACH_PREFIX)) await handleApproach(rid.slice(APPROACH_PREFIX.length), kind);
  else await handleTransition(rid, kind, 'geofence');
});

// The old task name still has to exist so a leftover registration can be stopped cleanly.
TaskManager.defineTask(OLD_PRECISE_TASK, async () => {
  try {
    await Location.stopLocationUpdatesAsync(OLD_PRECISE_TASK);
  } catch {
    // already stopped
  }
});

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(PRECISE_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const loc = data.locations[data.locations.length - 1];
  const states = await loadAreaStates();
  const precise = (await activeAreas(await loadAreas())).filter(
    (a) => a.precise && states[a.id]?.approach === 'inside' && states[a.id]?.armed
  );
  if (precise.length === 0) {
    await serial(() => updateClose());
    return;
  }
  const acc = loc.coords.accuracy ?? 50;
  for (const a of precise) {
    const r = Math.max(MIN_RADIUS_M, a.radiusMeters);
    const d = distanceM(loc.coords.latitude, loc.coords.longitude, a.latitude, a.longitude);
    if (d <= r && acc <= Math.max(100, r)) await handleTransition(a.id, 'enter', 'precise');
    else if (d > r + Math.max(40, Math.min(acc, 150))) await handleTransition(a.id, 'exit', 'precise');
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
  const unknown = active.filter((a) => !states[a.id]?.inside || (a.precise && !states[a.id]?.approach));
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
    const d = distanceM(pos.coords.latitude, pos.coords.longitude, a.latitude, a.longitude);
    if (a.precise && !fresh[a.id]?.approach) {
      const near = d <= approachRadius(a);
      const pointInside = fresh[a.id]?.inside
        ? fresh[a.id]?.inside === 'inside'
        : d <= Math.max(MIN_RADIUS_M, a.radiusMeters);
      fresh[a.id] = { ...fresh[a.id], approach: near ? 'inside' : 'outside', armed: near && !pointInside };
    }
    if (fresh[a.id]?.inside) continue; // an event arrived meanwhile
    const inside = d <= Math.max(MIN_RADIUS_M, a.radiusMeters);
    fresh[a.id] = { ...fresh[a.id], inside: inside ? 'inside' : 'outside', armed: !inside && fresh[a.id]?.approach === 'inside' };
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

    const active = await activeAreas(areas);
    const registered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);

    if (active.length === 0) {
      if (registered) await Location.stopGeofencingAsync(GEOFENCE_TASK);
      await serial(() => updateClose());
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

    // Precise areas that are no longer precise lose their approach state.
    const st = await loadAreaStates();
    let changed = false;
    for (const a of active)
      if (!a.precise && (st[a.id]?.approach || st[a.id]?.armed)) {
        st[a.id] = { ...st[a.id], approach: undefined, armed: undefined };
        changed = true;
      }
    if (changed) await saveAreaStates(st);

    const regions: Location.LocationRegion[] = [];
    for (const a of active) {
      regions.push({
        identifier: a.id,
        latitude: a.latitude,
        longitude: a.longitude,
        radius: Math.max(MIN_RADIUS_M, a.radiusMeters),
        notifyOnEnter: true,
        notifyOnExit: true,
      });
      if (a.precise)
        regions.push({
          identifier: APPROACH_PREFIX + a.id,
          latitude: a.latitude,
          longitude: a.longitude,
          radius: approachRadius(a),
          notifyOnEnter: true,
          notifyOnExit: true,
        });
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    await serial(() => updateClose());
    return 'ok';
  } catch (e: any) {
    await addGeoLog({ label: 'מערכת', kind: 'problem', text: 'הפעלת מעקב האזורים נכשלה: ' + (e?.message ?? '') });
    return 'error';
  }
}
