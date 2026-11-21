import { requireOptionalNativeModule } from 'expo';

type SharedTextEvent = { text: string };

export type RingKind = 'alarm' | 'timer' | 'reminder' | 'geo';

export interface RingSpec {
  id: string;
  at: number;
  title: string;
  body: string;
  kind: RingKind;
  sound: string;
  durationMs: number;
  snoozeMin: number; // 0 = no snooze
  snoozeLeft: number; // -1 = unlimited
  daysMask: number; // bit0 = Sunday ... bit6 = Saturday; 0 = one-time
  hour: number;
  minute: number;
  endAt?: number; // repeating rings stop after this time (0/undefined = never)
  silent?: boolean; // ordinary notification instead of a full-screen ring
}

export interface DocEntry {
  uri: string;
  name: string;
  mime: string;
  isDir: boolean;
  size: number;
  modified: number;
}

type GeoAlarmNative = {
  triggerAlarm(title: string, body: string, kind: string, sound: string | null, durationMs: number): void;
  scheduleRing(json: string): void;
  cancelRing(id: string): void;
  getScheduledRingIds(): string[];
  getSoundTitle(uri: string | null): string;
  listDocuments(uri: string): Promise<DocEntry[]>;
  documentFolderName(uri: string): string;
  openDocument(uri: string, mime: string): boolean;
  shareDocument(uri: string, mime: string): boolean;
  releaseFolder(uri: string): void;
  pickSound(current: string | null, title: string): Promise<{ uri: string; title: string } | null>;
  stopAlarm(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  openAutoStartSettings(): boolean;
  openAppSettings(): void;
  getInitialSharedText(): string | null;
  addListener(event: 'onSharedText', cb: (e: SharedTextEvent) => void): { remove(): void };
};

const native = requireOptionalNativeModule<GeoAlarmNative>('GeoAlarm');

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return native ? fn() : fallback;
  } catch {
    return fallback;
  }
}

export const GeoAlarm = {
  available: !!native,
  triggerAlarm: (title: string, body: string, kind: RingKind, sound: string | null, durationMs: number) =>
    safe(() => native!.triggerAlarm(title, body, kind, sound, durationMs), undefined),
  scheduleRing: (spec: RingSpec) => safe(() => native!.scheduleRing(JSON.stringify(spec)), undefined),
  cancelRing: (id: string) => safe(() => native!.cancelRing(id), undefined),
  getScheduledRingIds: () => safe(() => native!.getScheduledRingIds(), [] as string[]),
  listDocuments: async (uri: string): Promise<DocEntry[] | null> => {
    try {
      return native ? await native.listDocuments(uri) : [];
    } catch {
      return null; // permission lost or folder moved
    }
  },
  documentFolderName: (uri: string) => safe(() => native!.documentFolderName(uri), 'תיקייה'),
  openDocument: (uri: string, mime: string) => safe(() => native!.openDocument(uri, mime), false),
  shareDocument: (uri: string, mime: string) => safe(() => native!.shareDocument(uri, mime), false),
  releaseFolder: (uri: string) => safe(() => native!.releaseFolder(uri), undefined),
  getSoundTitle: (uri: string | null) => safe(() => native!.getSoundTitle(uri), 'ברירת מחדל'),
  pickSound: async (current: string | null, title: string) => {
    try {
      return native ? await native.pickSound(current, title) : null;
    } catch {
      return null;
    }
  },
  stopAlarm: () => safe(() => native!.stopAlarm(), undefined),
  canUseFullScreenIntent: () => safe(() => native!.canUseFullScreenIntent(), false),
  openFullScreenIntentSettings: () => safe(() => native!.openFullScreenIntentSettings(), undefined),
  isIgnoringBatteryOptimizations: () => safe(() => native!.isIgnoringBatteryOptimizations(), false),
  requestIgnoreBatteryOptimizations: () => safe(() => native!.requestIgnoreBatteryOptimizations(), undefined),
  openAutoStartSettings: () => safe(() => native!.openAutoStartSettings(), false),
  openAppSettings: () => safe(() => native!.openAppSettings(), undefined),
  getInitialSharedText: () => safe(() => native!.getInitialSharedText(), null),
  addSharedTextListener: (cb: (text: string) => void) =>
    safe(() => native!.addListener('onSharedText', (e) => cb(e.text)), { remove() {} }),
};
