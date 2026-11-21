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
  audioDuration(src: string): number;
  makeRingtone(
    src: string,
    startMs: number,
    endMs: number,
    fadeMs: number,
    id: string,
    name: string
  ): Promise<{ path: string; mediaUri: string | null }>;
  renameRingtone(mediaUri: string | null, name: string): void;
  deleteRingtone(path: string | null, mediaUri: string | null): void;
  previewAudio(src: string, startMs: number, endMs: number, fadeMs: number): void;
  previewPosition(): number;
  stopPreview(): void;
  canWriteSettings(): boolean;
  openWriteSettings(): void;
  openSoundSettings(): void;
  setPhoneRingtone(mediaUri: string, type: 'call' | 'notification' | 'alarm'): boolean;
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
  audioDuration: (src: string) => safe(() => native!.audioDuration(src), 0),
  /** Cuts [startMs,endMs] with optional fade-in; throws a Hebrew message on failure. */
  makeRingtone: (src: string, startMs: number, endMs: number, fadeMs: number, id: string, name: string) => {
    if (!native) return Promise.reject(new Error('לא זמין במכשיר הזה'));
    return native.makeRingtone(src, startMs, endMs, fadeMs, id, name);
  },
  renameRingtone: (mediaUri: string | null, name: string) => safe(() => native!.renameRingtone(mediaUri, name), undefined),
  deleteRingtone: (path: string | null, mediaUri: string | null) =>
    safe(() => native!.deleteRingtone(path, mediaUri), undefined),
  previewAudio: (src: string, startMs: number, endMs: number, fadeMs: number) =>
    safe(() => {
      native!.previewAudio(src, startMs, endMs, fadeMs);
      return true;
    }, false),
  previewPosition: () => safe(() => native!.previewPosition(), -1),
  stopPreview: () => safe(() => native!.stopPreview(), undefined),
  canWriteSettings: () => safe(() => native!.canWriteSettings(), false),
  openWriteSettings: () => safe(() => native!.openWriteSettings(), undefined),
  openSoundSettings: () => safe(() => native!.openSoundSettings(), undefined),
  setPhoneRingtone: (mediaUri: string, type: 'call' | 'notification' | 'alarm') =>
    safe(() => native!.setPhoneRingtone(mediaUri, type), false),
  addSharedTextListener: (cb: (text: string) => void) =>
    safe(() => native!.addListener('onSharedText', (e) => cb(e.text)), { remove() {} }),
};
