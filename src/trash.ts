import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GeoAlarm } from '../modules/geo-alarm';
import { DocMeta, newId } from './storage';

/**
 * Recycle bin for documents. A deleted document is copied into the app's own storage and then removed from
 * its folder. It can be restored (back to the folder it was in) or deleted for good. After TRASH_DAYS it is
 * deleted automatically.
 */
export const TRASH_DAYS = 30;
export const TRASH_WARN_BYTES = 100 * 1024 * 1024;
const KEY = '@avi_doc_trash_v1';
const DIR = (FileSystem.documentDirectory ?? '') + 'trash/';
const DAY = 86_400_000;

export interface TrashItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  deletedAt: number;
  file: string; // local copy (file://)
  parentUri?: string; // folder it was in
  rootUri?: string; // the connected folder (fallback for restoring)
  meta?: DocMeta; // favourite / expiry / lock it had
}

export async function loadTrash(): Promise<TrashItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
const save = (list: TrashItem[]) => AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});

export const trashSize = (list: TrashItem[]) => list.reduce((s, t) => s + (t.size || 0), 0);
export const daysLeft = (t: TrashItem) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - t.deletedAt) / DAY));

const removeFile = (file: string) => FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});

export type TrashResult = 'ok' | 'nocopy' | 'nodelete';

/** Moves a document to the bin. 'nocopy' = couldn't keep a copy (nothing was deleted). */
export async function moveToTrash(
  e: { uri: string; name: string; mime: string },
  parentUri: string | undefined,
  meta: DocMeta | undefined
): Promise<TrashResult> {
  const id = newId();
  const file = DIR + id;
  const bytes = await GeoAlarm.copyToFile(e.uri, file);
  if (bytes < 0) {
    await removeFile(file);
    return 'nocopy';
  }
  if (!GeoAlarm.deleteDocument(e.uri)) {
    await removeFile(file);
    return 'nodelete';
  }
  const item: TrashItem = {
    id,
    name: e.name,
    mime: e.mime,
    size: bytes,
    deletedAt: Date.now(),
    file,
    parentUri: parentUri || GeoAlarm.documentParent(e.uri) || undefined,
    rootUri: e.uri.includes('/document/') ? e.uri.split('/document/')[0] : undefined,
    meta,
  };
  await save([item, ...(await loadTrash())]);
  return 'ok';
}

/** Puts it back in its folder (or the connected folder if that's gone). Returns the new document uri. */
export async function restoreFromTrash(t: TrashItem, extraFolders: string[] = []): Promise<string | null> {
  const targets = [t.parentUri, t.rootUri, ...extraFolders].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  for (const folder of targets) {
    const uri = await GeoAlarm.copyIntoFolder(t.file, folder, t.name, t.mime);
    if (uri) {
      await removeFile(t.file);
      await save((await loadTrash()).filter((x) => x.id !== t.id));
      return uri;
    }
  }
  return null;
}

export async function deleteForever(ids: string[]): Promise<TrashItem[]> {
  const list = await loadTrash();
  for (const t of list) if (ids.includes(t.id)) await removeFile(t.file);
  const next = list.filter((t) => !ids.includes(t.id));
  await save(next);
  return next;
}

export async function emptyTrash(): Promise<void> {
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
  await save([]);
}

/** Deletes what has been in the bin for more than TRASH_DAYS. */
export async function purgeTrash(): Promise<TrashItem[]> {
  const list = await loadTrash();
  const old = list.filter((t) => Date.now() - t.deletedAt > TRASH_DAYS * DAY).map((t) => t.id);
  return old.length ? deleteForever(old) : list;
}
