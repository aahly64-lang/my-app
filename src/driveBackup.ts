import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDateString } from './storage';

/**
 * Daily backup straight to the user's Google Drive (REST API, scope drive.file:
 * the app only sees the folder and files it created itself).
 * Sign-in works through the Android OAuth client (package + SHA-1) in the
 * "My Maps Project" Google Cloud project – no client id is needed in the app.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'גיבוי יומן ושולחן עבודה';
const PREFIX = 'board-backup-';
const KEEP = 7;
const KEY = '@avi_drive_backup_v1';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveBackupConfig {
  enabled: boolean;
  email?: string;
  folderId?: string;
  lastAt?: number;
  lastError?: string;
}

let configured = false;
function configure() {
  if (configured) return;
  GoogleSignin.configure({ scopes: [SCOPE] });
  configured = true;
}

export async function loadDriveBackup(): Promise<DriveBackupConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : { enabled: false };
  } catch {
    return { enabled: false };
  }
}
const save = (c: DriveBackupConfig) => AsyncStorage.setItem(KEY, JSON.stringify(c)).catch(() => {});

/** Interactive sign-in. Returns the new config, or throws with a Hebrew message. */
export async function connectDrive(): Promise<DriveBackupConfig> {
  configure();
  try {
    await GoogleSignin.hasPlayServices();
  } catch {
    throw new Error('שירותי Google Play לא זמינים בטלפון.');
  }
  let res;
  try {
    res = await GoogleSignin.signIn();
  } catch (e: any) {
    throw new Error(signInError(e));
  }
  if (!isSuccessResponse(res)) throw new Error('ההתחברות בוטלה.');
  const cfg: DriveBackupConfig = { enabled: true, email: res.data.user.email };
  await save(cfg);
  return cfg;
}

function signInError(e: any): string {
  const code = String(e?.code ?? '');
  // DEVELOPER_ERROR (10): the Android OAuth client (package + SHA-1) is missing in Google Cloud.
  if (code === '10' || /DEVELOPER_ERROR/i.test(String(e?.message))) {
    return 'החיבור לגוגל עדיין לא הוגדר בצד של גוגל (Google Cloud). צריך להשלים את ההגדרה ולנסות שוב.';
  }
  if (code === '12501' || code === 'SIGN_IN_CANCELLED' || code === '-5') return 'ההתחברות בוטלה.';
  if (code === '7') return 'אין חיבור לאינטרנט.';
  return 'ההתחברות לגוגל נכשלה (' + (e?.message ?? code) + ').';
}

export async function disconnectDrive() {
  configure();
  try {
    await GoogleSignin.signOut();
  } catch {
    // already signed out
  }
  await save({ enabled: false });
}

async function token(): Promise<string> {
  configure();
  if (!GoogleSignin.hasPreviousSignIn()) throw new Error('צריך להתחבר שוב לחשבון גוגל.');
  await GoogleSignin.signInSilently();
  return (await GoogleSignin.getTokens()).accessToken;
}

async function api(path: string, t: string, init: RequestInit = {}, base = API) {
  const r = await fetch(base + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + t, ...(init.headers ?? {}) },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    if (r.status === 403 && /accessNotConfigured|has not been used|disabled/i.test(body)) {
      throw new Error('Google Drive API לא מופעל בפרויקט ב-Google Cloud.');
    }
    if (r.status === 401) throw new Error('צריך להתחבר שוב לחשבון גוגל.');
    throw new Error('שגיאה מגוגל דרייב (' + r.status + ').');
  }
  return r;
}

const q = (s: string) => encodeURIComponent(s);

async function folderId(t: string, cfg: DriveBackupConfig): Promise<string> {
  if (cfg.folderId) {
    try {
      const r = await api(`/files/${cfg.folderId}?fields=id,trashed`, t);
      const f = await r.json();
      if (f.id && !f.trashed) return f.id;
    } catch {
      // look it up / create it again
    }
  }
  const list = await (
    await api(
      `/files?q=${q(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)`,
      t
    )
  ).json();
  if (list.files?.[0]?.id) return list.files[0].id;
  const created = await (
    await api('/files?fields=id', t, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    })
  ).json();
  return created.id;
}

async function listFiles(t: string, folder: string): Promise<{ id: string; name: string }[]> {
  const r = await api(
    `/files?q=${q(`'${folder}' in parents and trashed=false and name contains '${PREFIX}'`)}&orderBy=name desc&pageSize=100&fields=files(id,name)`,
    t
  );
  return ((await r.json()).files ?? []) as { id: string; name: string }[];
}

/** Uploads today's backup (replaces today's file), keeps the newest KEEP. */
export async function runDriveBackup(payload: () => Promise<object>, force = false): Promise<DriveBackupConfig> {
  const cfg = await loadDriveBackup();
  if (!cfg.enabled) return cfg;
  const today = localDateString();
  if (!force && cfg.lastAt && localDateString(new Date(cfg.lastAt)) === today && !cfg.lastError) return cfg;
  try {
    const t = await token();
    const folder = await folderId(t, cfg);
    const name = PREFIX + today + '.json';
    const files = await listFiles(t, folder);
    const existing = files.find((f) => f.name === name);
    const json = JSON.stringify(await payload());
    if (existing) {
      await api(`/files/${existing.id}?uploadType=media`, t, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      }, UPLOAD);
    } else {
      const boundary = 'avi' + Date.now();
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: [folder], mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        json +
        `\r\n--${boundary}--`;
      await api('/files?uploadType=multipart', t, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body,
      }, UPLOAD);
    }
    const all = await listFiles(t, folder);
    for (const old of all.slice(KEEP)) await api(`/files/${old.id}`, t, { method: 'DELETE' }).catch(() => {});
    const next = { ...cfg, folderId: folder, lastAt: Date.now(), lastError: undefined };
    await save(next);
    return next;
  } catch (e: any) {
    const next = { ...cfg, lastError: e?.message ?? 'הגיבוי לגוגל דרייב נכשל.' };
    await save(next);
    return next;
  }
}

/** Backups in Drive, newest first. */
export async function listDriveBackups(): Promise<{ id: string; date: string }[]> {
  const cfg = await loadDriveBackup();
  const t = await token();
  const folder = await folderId(t, cfg);
  return (await listFiles(t, folder)).map((f) => ({ id: f.id, date: f.name.slice(PREFIX.length, PREFIX.length + 10) }));
}

export async function downloadDriveBackup(id: string): Promise<string> {
  const t = await token();
  return (await api(`/files/${id}?alt=media`, t)).text();
}
