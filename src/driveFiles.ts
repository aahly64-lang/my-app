import AsyncStorage from '@react-native-async-storage/async-storage';
import { DocEntry, GeoAlarm } from '../modules/geo-alarm';
import { DriveBackupConfig, UPLOAD, api, folderId, loadDriveBackup, saveDriveBackup, token } from './driveBackup';
import { isDriveUri, loadDocFolders } from './storage';

/**
 * Backs up the documents themselves (the files in the connected folders) to Google Drive, into
 * "גיבוי יומן ושולחן עבודה/מסמכים/<folder>/…", keeping the same sub-folders.
 * Only new or changed files are uploaded. A file that was deleted from the phone is moved to Drive's own
 * trash (Google keeps it there for 30 days). No lock / password is involved.
 */
const INDEX_KEY = '@avi_drive_files_v1';
const DOCS_FOLDER = 'מסמכים';
const MAX_FILE = 150 * 1024 * 1024; // bigger files are skipped
const MAX_FILES = 3000;
const EVERY_MS = 3 * 60 * 60 * 1000; // automatic run at most every 3 hours

interface FileRec {
  id: string;
  size: number;
  modified: number;
  root: string; // connected folder uri
}
interface Index {
  base?: string; // Drive id of the backup folder these ids belong to
  folders: Record<string, string>; // "<root>|a/b" -> Drive folder id
  files: Record<string, FileRec>; // document uri -> Drive file
}

async function loadIndex(): Promise<Index> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // start over
  }
  return { folders: {}, files: {} };
}
const saveIndex = (i: Index) => AsyncStorage.setItem(INDEX_KEY, JSON.stringify(i)).catch(() => {});

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const enc = encodeURIComponent;

async function findOrCreateFolder(t: string, parent: string, name: string): Promise<string> {
  const qs = `name='${esc(name)}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await (await api(`/files?q=${enc(qs)}&fields=files(id)`, t)).json();
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await (
    await api('/files?fields=id', t, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }),
    })
  ).json();
  return created.id;
}

/** Opens a resumable upload session (new file or new version of an existing one) and sends the bytes. */
async function upload(t: string, e: DocEntry, parent: string, existing?: string): Promise<string> {
  const meta = existing ? {} : { name: e.name, parents: [parent] };
  const r = await fetch(
    existing ? `${UPLOAD}/files/${existing}?uploadType=resumable&fields=id` : `${UPLOAD}/files?uploadType=resumable&fields=id`,
    {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        Authorization: 'Bearer ' + t,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': e.mime || 'application/octet-stream',
      },
      body: JSON.stringify(meta),
    }
  );
  if (r.status === 404 && existing) return upload(t, e, parent); // removed in Drive: upload again
  if (!r.ok) throw new Error(r.status === 401 ? 'צריך להתחבר שוב לחשבון גוגל.' : `שגיאה מגוגל דרייב (${r.status}).`);
  const session = r.headers.get('location') || r.headers.get('Location');
  if (!session) throw new Error('גוגל דרייב לא פתח העלאה.');
  const res = await GeoAlarm.uploadToSession(e.uri, session, e.mime);
  if (res.status < 200 || res.status > 299) {
    if (res.status === 0) throw new Error('ההעלאה נקטעה (' + res.body + ').');
    throw new Error(`העלאת "${e.name}" נכשלה (${res.status}).`);
  }
  try {
    return JSON.parse(res.body).id ?? existing ?? '';
  } catch {
    return existing ?? '';
  }
}

/** All the files under a connected folder: [entry, relative folder path]. Null if the folder can't be read. */
async function walk(root: string): Promise<[DocEntry, string][] | null> {
  const out: [DocEntry, string][] = [];
  const top = await GeoAlarm.listDocuments(root);
  if (top === null) return null;
  const queue: [DocEntry[], string, number][] = [[top, '', 0]];
  while (queue.length && out.length < MAX_FILES) {
    const [list, rel, depth] = queue.shift()!;
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      if (e.isDir) {
        if (depth >= 8) continue;
        const sub = await GeoAlarm.listDocuments(e.uri);
        if (sub) queue.push([sub, rel ? `${rel}/${e.name}` : e.name, depth + 1]);
      } else out.push([e, rel]);
    }
  }
  return out;
}

let running = false;

export interface FilesProgress {
  done: number;
  total: number;
}

/**
 * Uploads new / changed document files. Automatic runs (force=false) happen at most every 3 hours and,
 * when "Wi-Fi only" is on, only on Wi-Fi.
 */
export async function syncDocFiles(force = false, onProgress?: (p: FilesProgress) => void): Promise<DriveBackupConfig> {
  let cfg = await loadDriveBackup();
  if (!cfg.enabled || cfg.files === false || running) return cfg;
  if (!force && cfg.filesLastAt && !cfg.filesError && Date.now() - cfg.filesLastAt < EVERY_MS) return cfg;
  if (cfg.wifiOnly !== false && !GeoAlarm.isUnmetered()) {
    if (force) {
      cfg = { ...cfg, filesError: 'ממתין לחיבור Wi-Fi (אפשר לשנות בהגדרות: "רק ב-Wi-Fi").' };
      await saveDriveBackup(cfg);
    }
    return cfg;
  }
  running = true;
  const idx = await loadIndex();
  let uploaded = 0;
  let skipped = 0;
  let error: string | undefined;
  let note: string | undefined;
  try {
    const t = await token();
    const base = await folderId(t, cfg);
    if (idx.base && idx.base !== base) {
      // the backup folder was created again: old ids are no longer valid
      idx.folders = {};
      idx.files = {};
    }
    idx.base = base;
    const docsKey = '|' + DOCS_FOLDER;
    if (!idx.folders[docsKey]) idx.folders[docsKey] = await findOrCreateFolder(t, base, DOCS_FOLDER);
    const docsId = idx.folders[docsKey];

    // folders marked "phone only" and folders that are in Drive already are not copied
    const roots = (await loadDocFolders()).filter((f) => f.drive !== false && !isDriveUri(f.uri));
    const seen = new Set<string>();
    const walked = new Set<string>();
    const all: [DocEntry, string, { uri: string; name: string }][] = [];
    for (const f of roots) {
      const files = await walk(f.uri);
      if (!files) continue;
      walked.add(f.uri);
      files.forEach(([e, rel]) => all.push([e, rel, f]));
    }
    const todo = all.filter(([e]) => {
      seen.add(e.uri);
      const k = idx.files[e.uri];
      return !(k && k.size === e.size && k.modified === e.modified);
    });
    onProgress?.({ done: 0, total: todo.length });

    const folderFor = async (root: { uri: string; name: string }, rel: string) => {
      let parent = docsId;
      let key = root.uri;
      // top: the connected folder's name
      const parts = [root.name, ...(rel ? rel.split('/') : [])];
      for (let i = 0; i < parts.length; i++) {
        key += '|' + parts[i];
        if (!idx.folders[key]) idx.folders[key] = await findOrCreateFolder(t, parent, parts[i]);
        parent = idx.folders[key];
      }
      return parent;
    };

    for (let i = 0; i < todo.length; i++) {
      const [e, rel, root] = todo[i];
      if (e.size > MAX_FILE) {
        skipped++;
        continue;
      }
      const parent = await folderFor(root, rel);
      const known = idx.files[e.uri];
      let id: string;
      try {
        id = await upload(t, e, parent, known?.id);
      } catch (err: any) {
        if (/404/.test(String(err?.message))) {
          // a folder was removed in Drive: forget the folder ids and try once more
          idx.folders = { [docsKey]: docsId };
          id = await upload(t, e, await folderFor(root, rel));
        } else throw err;
      }
      idx.files[e.uri] = { id, size: e.size, modified: e.modified, root: root.uri };
      uploaded++;
      onProgress?.({ done: i + 1, total: todo.length });
      if (uploaded % 5 === 0) await saveIndex(idx);
    }

    // deleted from the phone → Drive's trash (only for folders that were read successfully)
    for (const [uri, rec] of Object.entries(idx.files)) {
      if (seen.has(uri) || !walked.has(rec.root)) continue;
      await api(`/files/${rec.id}`, t, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      }).catch(() => {});
      delete idx.files[uri];
    }
    note = skipped ? `${skipped} קבצים גדולים מ-150MB לא גובו.` : undefined;
  } catch (e: any) {
    error = e?.message ?? 'גיבוי הקבצים לגוגל דרייב נכשל.';
  } finally {
    running = false;
  }
  await saveIndex(idx);
  const fresh = await loadDriveBackup();
  const next: DriveBackupConfig = {
    ...fresh,
    filesLastAt: error ? fresh.filesLastAt : Date.now(),
    filesCount: Object.keys(idx.files).length,
    filesError: error,
    filesNote: error ? fresh.filesNote : note,
  };
  await saveDriveBackup(next);
  return next;
}

/** Forgets what was uploaded (after disconnecting from Drive). */
export const resetDocFilesIndex = () => AsyncStorage.removeItem(INDEX_KEY).catch(() => {});

export const docsDriveFolderName = `גיבוי יומן ושולחן עבודה/${DOCS_FOLDER}`;
