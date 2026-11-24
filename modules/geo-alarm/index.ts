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

export interface MoveResult {
  status: 'moved' | 'copied' | 'failed';
  uri?: string;
  error?: string;
}

export interface DocEntry {
  uri: string;
  name: string;
  mime: string;
  isDir: boolean;
  size: number;
  modified: number;
  /** search results only: where the file is, and which connected folder it belongs to */
  folder?: string;
  treeUri?: string;
}

type GeoAlarmNative = {
  triggerAlarm(title: string, body: string, kind: string, sound: string | null, durationMs: number): void;
  scheduleRing(json: string): void;
  quietNotifications(taskName: string): void;
  cancelRing(id: string): void;
  getScheduledRingIds(): string[];
  getSoundTitle(uri: string | null): string;
  listDocuments(uri: string): Promise<DocEntry[]>;
  documentFolderName(uri: string): string;
  openDocument(uri: string, mime: string): boolean;
  shareDocument(uri: string, mime: string): boolean;
  releaseFolder(uri: string): void;
  searchDocuments(roots: string[], query: string, limit: number): Promise<DocEntry[]>;
  documentThumbnail(uri: string, mime: string, size: number, stamp: number): Promise<string | null>;
  renameDocument(uri: string, name: string): string | null;
  deleteDocument(uri: string): boolean;
  shareDocuments(uris: string[], mimes: string[]): boolean;
  copyIntoFolder(src: string, treeUri: string, name: string, mime: string): Promise<string | null>;
  createFolder(parentUri: string, name: string): Promise<string | null>;
  scanDocument(quality: string): Promise<{ uri: string; pages: number } | null>;
  moveDocument(src: string, srcParent: string, destFolder: string): Promise<MoveResult>;
  rotatePdf(uri: string, degrees: number): Promise<boolean>;
  pickContact(): Promise<{ name: string; phone: string } | null>;
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
  audioWaveform(src: string, buckets: number): Promise<{ peaks: number[]; durationMs: number }>;
  makeRingtone(
    src: string,
    startMs: number,
    endMs: number,
    fadeMs: number,
    fadeOutMs: number,
    id: string,
    name: string
  ): Promise<{ path: string; mediaUri: string | null }>;
  renameRingtone(mediaUri: string | null, name: string): void;
  deleteRingtone(path: string | null, mediaUri: string | null): void;
  previewAudio(src: string, startMs: number, endMs: number, fadeBaseMs: number, fadeMs: number, fadeOutMs: number): void;
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
  /** Removes old badge-showing channels and prepares a silent, badge-less channel for the location service. */
  quietNotifications: (taskName: string) => safe(() => native!.quietNotifications(taskName), undefined),
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
  searchDocuments: async (roots: string[], query: string, limit = 300): Promise<DocEntry[]> => {
    try {
      return native ? await native.searchDocuments(roots, query, limit) : [];
    } catch {
      return [];
    }
  },
  documentThumbnail: async (uri: string, mime: string, size: number, stamp: number): Promise<string | null> => {
    try {
      return native ? await native.documentThumbnail(uri, mime, size, stamp) : null;
    } catch {
      return null;
    }
  },
  renameDocument: (uri: string, name: string) => safe(() => native!.renameDocument(uri, name), null),
  deleteDocument: (uri: string) => safe(() => native!.deleteDocument(uri), false),
  shareDocuments: (uris: string[], mimes: string[]) => safe(() => native!.shareDocuments(uris, mimes), false),
  copyIntoFolder: async (src: string, treeUri: string, name: string, mime: string): Promise<string | null> => {
    try {
      return native ? await native.copyIntoFolder(src, treeUri, name, mime) : null;
    } catch {
      return null;
    }
  },
  /** Opens Google's document scanner. Throws with a Hebrew message if it isn't available. */
  createFolder: async (parentUri: string, name: string): Promise<string | null> => {
    try {
      return native ? await native.createFolder(parentUri, name) : null;
    } catch {
      return null;
    }
  },
  scanDocument: async (quality = 'normal'): Promise<{ uri: string; pages: number } | null> => {
    if (!native) throw new Error('לא זמין במכשיר הזה');
    return native.scanDocument(quality);
  },
  moveDocument: async (src: string, srcParent: string, destFolder: string): Promise<MoveResult> => {
    try {
      return native ? await native.moveDocument(src, srcParent, destFolder) : { status: 'failed', error: 'לא זמין' };
    } catch (e: any) {
      return { status: 'failed', error: String(e?.message ?? e) };
    }
  },
  pickContact: async (): Promise<{ name: string; phone: string } | null> => {
    try {
      return native ? await native.pickContact() : null;
    } catch {
      return null;
    }
  },
  rotatePdf: async (uri: string, degrees: number): Promise<boolean> => {
    try {
      return native ? await native.rotatePdf(uri, degrees) : false;
    } catch {
      return false;
    }
  },
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
  audioWaveform: async (src: string, buckets: number): Promise<{ peaks: number[]; durationMs: number } | null> => {
    try {
      return native ? await native.audioWaveform(src, buckets) : null;
    } catch {
      return null;
    }
  },
  makeRingtone: (
    src: string,
    startMs: number,
    endMs: number,
    fadeMs: number,
    fadeOutMs: number,
    id: string,
    name: string
  ) => {
    if (!native) return Promise.reject(new Error('לא זמין במכשיר הזה'));
    return native.makeRingtone(src, startMs, endMs, fadeMs, fadeOutMs, id, name);
  },
  renameRingtone: (mediaUri: string | null, name: string) => safe(() => native!.renameRingtone(mediaUri, name), undefined),
  deleteRingtone: (path: string | null, mediaUri: string | null) =>
    safe(() => native!.deleteRingtone(path, mediaUri), undefined),
  /** Plays [startMs,endMs]; fades are measured from fadeBaseMs (the selection start) and endMs. */
  previewAudio: (src: string, startMs: number, endMs: number, fadeBaseMs: number, fadeMs = 0, fadeOutMs = 0) =>
    safe(() => {
      native!.previewAudio(src, startMs, endMs, fadeBaseMs, fadeMs, fadeOutMs);
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
