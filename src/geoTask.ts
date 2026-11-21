import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ringNow } from './rings';
import {
  AlarmArea,
  loadAreas,
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
 *   its state is "unknown", so if you are already inside it, the first (initial) Enter
 *   event is ignored. It will ring the next time you enter.
 * - "every" mode: ring again only after leaving and at least 15 minutes after the last ring.
 * - "once" mode: after ringing, the area is switched off.
 */
TaskManager.defineTask<GeofenceTaskData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { eventType, region } = data;
  const id = region.identifier;
  if (!id) return;

  const states = await loadAreaStates();
  const prev = states[id] ?? {};

  if (eventType === Location.GeofencingEventType.Exit) {
    states[id] = { ...prev, inside: 'outside' };
    await saveAreaStates(states);
    return;
  }

  if (eventType !== Location.GeofencingEventType.Enter) return;

  const wasOutside = prev.inside === 'outside';
  states[id] = { ...prev, inside: 'inside' };

  const areas = await loadAreas();
  const area = areas.find((a) => a.id === id);
  if (!area || !area.enabled || !wasOutside) {
    await saveAreaStates(states);
    return;
  }

  const now = Date.now();
  if (area.mode === 'every' && prev.lastRingAt && now - prev.lastRingAt < EVERY_MODE_COOLDOWN_MS) {
    await saveAreaStates(states);
    return;
  }

  states[id] = { ...states[id], lastRingAt: now };
  await saveAreaStates(states);

  await ringNow('geo', area.label || 'הגעת לאזור', area.note?.trim() || 'נכנסת לאזור שהגדרת');

  if (area.mode === 'once') {
    const updated = areas.map((a) => (a.id === id ? { ...a, enabled: false } : a));
    await saveAreas(updated);
    await syncGeofences(updated, { keepStates: true });
  }
});

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

    const active = areas.filter((a) => a.enabled);
    const registered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);

    if (active.length === 0) {
      if (registered) await Location.stopGeofencingAsync(GEOFENCE_TASK);
      return 'ok';
    }

    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!fg.granted || !bg.granted) return 'no-permission';

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
  } catch {
    return 'error';
  }
}
