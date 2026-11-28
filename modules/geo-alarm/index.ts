import { requireOptionalNativeModule } from 'expo';

type SharedTextEvent = { text: string };

/** A file shared into the app, already copied to the cache. */
export interface SharedFile {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

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

/** A rendered preview picture (cached JPEG). */
export interface UprightResult {
  uri: string | null;
  turned: number;
  /** short report of what the check saw (temporary, shown in the save window) */
  diag: string;
}

export interface PreviewPic {
  uri: string;
  width: number;
  height: number;
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
  pdfPageCount(uri: string): Promise<number>;
  renderPdfPage(uri: string, page: number, width: number, stamp: number): Promise<PreviewPic | null>;
  previewImage(uri: string, maxPx: number, stamp: number): Promise<PreviewPic | null>;
  findDuplicates(roots: string[]): Promise<DocEntry[][]>;
  renameDocument(uri: string, name: string): string | null;
  deleteDocument(uri: string): boolean;
  shareDocuments(uris: string[], mimes: string[]): boolean;
  copyIntoFolder(src: string, treeUri: string, name: string, mime: string): Promise<string | null>;
  createFolder(parentUri: string, name: string): Promise<string | null>;
  copyToFile(src: string, dest: string): Promise<number>;
  documentParent(uri: string): string | null;
  isUnmetered(): boolean;
  uploadToSession(src: string, sessionUrl: string, mime: string): Promise<{ status: number; body: string }>;
  protectPdf(src: string, password: string, name: string): Promise<string | null>;
  scanDocument(quality: string, pageLimit: number): Promise<{ uri: string; pages: number } | null>;
  compressForShare(uri: string, mime: string, name: string): Promise<{ uri: string; size: number; mime: string } | null>;
  cardOnePage(uri: string): Promise<string | null>;
  readText(uri: string, mime: string, maxPages: number): Promise<string | null>;
  signPdf(src: string, page: number, png: string, x: number, y: number, w: number): Promise<string | null>;
  moveDocument(src: string, srcParent: string, destFolder: string): Promise<MoveResult>;
  rotatePdf(uri: string, degrees: number): Promise<boolean>;
  rotatePdfPages(uri: string, degrees: number[]): Promise<string | null>;
  uprightScan(uri: string): Promise<UprightResult>;
  combinePdf(uris: string[], mimes: string[], quality: string, overwrite: string | null): Promise<string | null>;
  getInitialSharedFiles(): Promise<SharedFile[]>;
  pickContact(): Promise<{ name: string; phone: string } | null>;
  listen(prompt: string): Promise<string | null>;
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
  addListener(event: 'onSharedFiles', cb: (e: { files: SharedFile[] }) => void): { remove(): void };
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
  /** -1 = can't open (password protected / broken) */
  pdfPageCount: async (uri: string): Promise<number> => {
    try {
      return native ? await native.pdfPageCount(uri) : -1;
    } catch {
      return -1;
    }
  },
  renderPdfPage: async (uri: string, page: number, width: number, stamp: number): Promise<PreviewPic | null> => {
    try {
      return native ? await native.renderPdfPage(uri, page, Math.round(width), stamp) : null;
    } catch {
      return null;
    }
  },
  previewImage: async (uri: string, maxPx: number, stamp: number): Promise<PreviewPic | null> => {
    try {
      return native ? await native.previewImage(uri, Math.round(maxPx), stamp) : null;
    } catch {
      return null;
    }
  },
  findDuplicates: async (roots: string[]): Promise<DocEntry[][] | null> => {
    try {
      return native ? await native.findDuplicates(roots) : [];
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
  /** Copies a document into a local file (recycle bin). Bytes copied, or -1. */
  copyToFile: async (src: string, dest: string): Promise<number> => {
    try {
      return native ? await native.copyToFile(src, dest) : -1;
    } catch {
      return -1;
    }
  },
  /** The folder a document is in (usable as a folder uri), or null. */
  documentParent: (uri: string) => safe(() => native!.documentParent(uri), null),
  /** True on Wi-Fi / an unmetered network. */
  isUnmetered: () => safe(() => native!.isUnmetered(), false),
  uploadToSession: async (src: string, sessionUrl: string, mime: string): Promise<{ status: number; body: string }> => {
    try {
      return native ? await native.uploadToSession(src, sessionUrl, mime) : { status: 0, body: 'לא זמין' };
    } catch (e: any) {
      return { status: 0, body: String(e?.message ?? e) };
    }
  },
  /** A password-protected copy of a PDF in the cache (file:// uri), or null. */
  protectPdf: async (src: string, password: string, name: string): Promise<string | null> => {
    try {
      return native ? await native.protectPdf(src, password, name) : null;
    } catch {
      return null;
    }
  },
  scanDocument: async (quality = 'normal', pageLimit = 30): Promise<{ uri: string; pages: number } | null> => {
    if (!native) throw new Error('לא זמין במכשיר הזה');
    return native.scanDocument(quality, pageLimit);
  },
  compressForShare: async (uri: string, mime: string, name: string) => {
    try {
      return native ? await native.compressForShare(uri, mime, name) : null;
    } catch {
      return null;
    }
  },
  /** Text of a scan / picture, read on the phone (Hebrew + English). null = couldn't read. */
  readText: async (uri: string, mime: string, maxPages = 1): Promise<string | null> => {
    try {
      return native ? await native.readText(uri, mime, maxPages) : null;
    } catch {
      return null;
    }
  },
  cardOnePage: async (uri: string): Promise<string | null> => {
    try {
      return native ? await native.cardOnePage(uri) : null;
    } catch {
      return null;
    }
  },
  signPdf: async (src: string, page: number, png: string, x: number, y: number, w: number): Promise<string | null> => {
    try {
      return native ? await native.signPdf(src, page, png, x, y, w) : null;
    } catch {
      return null;
    }
  },
  moveDocument: async (src: string, srcParent: string, destFolder: string): Promise<MoveResult> => {
    try {
      return native ? await native.moveDocument(src, srcParent, destFolder) : { status: 'failed', error: 'לא זמין' };
    } catch (e: any) {
      return { status: 'failed', error: String(e?.message ?? e) };
    }
  },
  /** Speech to text (Hebrew): text, "" if cancelled, null if speech input isn't available. */
  listen: async (prompt: string): Promise<string | null> => {
    try {
      return native ? await native.listen(prompt) : null;
    } catch {
      return null;
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
  /** A new PDF (in the cache) with page i turned by degrees[i]; the source is left as it is. */
  rotatePdfPages: async (uri: string, degrees: number[]): Promise<string | null> => {
    try {
      return native ? await native.rotatePdfPages(uri, degrees) : null;
    } catch {
      return null;
    }
  },
  /** Sets upside-down (Hebrew) scan pages right, by reading them both ways. uri = null: nothing turned. */
  uprightScan: async (uri: string): Promise<UprightResult> => {
    try {
      return native ? await native.uprightScan(uri) : { uri: null, turned: 0, diag: 'אין מודול' };
    } catch (e: any) {
      return { uri: null, turned: 0, diag: 'שגיאה: ' + String(e?.message ?? e) };
    }
  },
  /**
   * One PDF from PDFs and images, in order. With overwrite: written over that document (returns it);
   * otherwise a new file in the cache (returns its uri). Null on failure.
   */
  combinePdf: async (uris: string[], mimes: string[], quality: string, overwrite: string | null = null): Promise<string | null> => {
    try {
      return native ? await native.combinePdf(uris, mimes, quality, overwrite) : null;
    } catch {
      return null;
    }
  },
  getInitialSharedFiles: async (): Promise<SharedFile[]> => {
    try {
      return native ? await native.getInitialSharedFiles() : [];
    } catch {
      return [];
    }
  },
  addSharedFilesListener: (cb: (files: SharedFile[]) => void) =>
    safe(() => native!.addListener('onSharedFiles', (e) => cb(e.files ?? [])), { remove() {} }),
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
