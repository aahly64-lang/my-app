import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  AlarmArea,
  AlarmClock,
  DocFolder,
  MuscleCategory,
  SoundSettings,
  StickyNote,
  Task,
  WorkoutGroup,
  localDateString,
  DocMeta,
  Journal,
  TaskList,
  TaskTemplate,
} from './storage';

export interface BackupData {
  notes: StickyNote[];
  categories: MuscleCategory[];
  areas: AlarmArea[];
  alarms: AlarmClock[];
  groups: WorkoutGroup[];
  tasks: Task[];
  docFolders: DocFolder[];
  docMeta?: Record<string, DocMeta>;
  sounds: SoundSettings;
  themeMode?: string;
  accent?: string;
  journals?: Journal[];
  taskLists?: TaskList[];
  taskTemplates?: TaskTemplate[];
}

const BACKUP_APP_ID = 'avi-personal-board';

export const buildPayload = (data: BackupData) => ({
  app: BACKUP_APP_ID,
  version: 1,
  exportedAt: new Date().toISOString(),
  ...data,
});

export async function exportBackup(data: BackupData): Promise<void> {
  const payload = buildPayload(data);
  const fileUri = `${FileSystem.cacheDirectory}board-backup-${localDateString()}.json`;
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2));
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('שיתוף לא זמין', 'לא ניתן לשתף קבצים במכשיר הזה.');
    return;
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'שמור או שלח את קובץ הגיבוי',
  });
}

export async function pickBackup(): Promise<BackupData | null> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.length) return null;
    return parseBackup(await FileSystem.readAsStringAsync(res.assets[0].uri));
  } catch {
    Alert.alert('השחזור נכשל', 'לא הצלחתי לקרוא את קובץ הגיבוי.');
    return null;
  }
}

export function parseBackup(raw: string): BackupData | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.app !== BACKUP_APP_ID) {
      Alert.alert('קובץ לא מתאים', 'זה לא קובץ גיבוי של האפליקציה הזו.');
      return null;
    }
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      areas: Array.isArray(parsed.areas) ? parsed.areas : [],
      alarms: Array.isArray(parsed.alarms) ? parsed.alarms : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      docFolders: Array.isArray(parsed.docFolders) ? parsed.docFolders : [],
      docMeta: parsed.docMeta && typeof parsed.docMeta === 'object' ? parsed.docMeta : undefined,
      sounds: parsed.sounds && typeof parsed.sounds === 'object' ? parsed.sounds : {},
      themeMode: typeof parsed.themeMode === 'string' ? parsed.themeMode : undefined,
      accent: typeof parsed.accent === 'string' ? parsed.accent : undefined,
      journals: Array.isArray(parsed.journals) ? parsed.journals : undefined,
      taskLists: Array.isArray(parsed.taskLists) ? parsed.taskLists : undefined,
      taskTemplates: Array.isArray(parsed.taskTemplates) ? parsed.taskTemplates : undefined,
    };
  } catch {
    Alert.alert('השחזור נכשל', 'לא הצלחתי לקרוא את קובץ הגיבוי.');
    return null;
  }
}

// ---------------------------------------------------------------- automatic backup

/**
 * Daily automatic backup into a folder the user picked (Android SAF). One file per day,
 * the last KEEP files are kept. Runs when the app goes to the background.
 */
const AUTO_KEY = '@avi_auto_backup_v1';
const KEEP = 7;
const PREFIX = 'board-backup-';

export interface AutoBackupConfig {
  folderUri: string | null;
  folderName?: string;
  lastAt?: number;
  lastError?: string;
}

export async function loadAutoBackup(): Promise<AutoBackupConfig> {
  try {
    const raw = await AsyncStorage.getItem(AUTO_KEY);
    return raw ? JSON.parse(raw) : { folderUri: null };
  } catch {
    return { folderUri: null };
  }
}
const saveAutoBackup = (c: AutoBackupConfig) => AsyncStorage.setItem(AUTO_KEY, JSON.stringify(c)).catch(() => {});

const SAF = FileSystem.StorageAccessFramework;

/** Readable folder name from a SAF tree uri (".../tree/primary%3ADocuments%2FGibui" → "Gibui"). */
function folderLabel(uri: string) {
  try {
    const id = decodeURIComponent(uri.split('/tree/')[1] ?? '');
    const path = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
    return path.split('/').filter(Boolean).pop() || 'תיקייה ראשית';
  } catch {
    return 'תיקייה';
  }
}

const fileName = (uri: string) => decodeURIComponent(uri).split('/').pop() ?? '';

/** Asks the user for a folder; returns the new config, or null when cancelled. */
export async function chooseAutoBackupFolder(): Promise<AutoBackupConfig | null> {
  try {
    const r = await SAF.requestDirectoryPermissionsAsync();
    if (!r.granted) return null;
    if (/com\.google\.android\.apps\.docs|com\.google\.android\.apps\.drive/.test(r.directoryUri)) {
      Alert.alert(
        'גוגל דרייב',
        'גוגל דרייב לא מאפשר לאפליקציות לשמור קבצים דרך בחירת תיקייה. בשביל דרייב השתמש בכפתור "התחבר לגוגל דרייב". כאן בחר תיקייה בזיכרון הטלפון.'
      );
      return null;
    }
    const cfg: AutoBackupConfig = { folderUri: r.directoryUri, folderName: folderLabel(r.directoryUri) };
    await saveAutoBackup(cfg);
    return cfg;
  } catch {
    Alert.alert('גיבוי אוטומטי', 'לא הצלחתי לפתוח את בחירת התיקייה.');
    return null;
  }
}

export async function disableAutoBackup() {
  await saveAutoBackup({ folderUri: null });
}

/**
 * Writes today's backup if there is none yet (or always, with force).
 * Returns the updated config (lastError set when it failed).
 */
export async function runAutoBackup(getData: () => Promise<BackupData>, force = false): Promise<AutoBackupConfig> {
  const cfg = await loadAutoBackup();
  if (!cfg.folderUri) return cfg;
  const today = localDateString();
  if (!force && cfg.lastAt && localDateString(new Date(cfg.lastAt)) === today && !cfg.lastError) return cfg;
  try {
    const files = await SAF.readDirectoryAsync(cfg.folderUri);
    // Replace today's file, if any.
    for (const f of files) {
      if (fileName(f).startsWith(PREFIX + today)) await SAF.deleteAsync(f, { idempotent: true }).catch(() => {});
    }
    const uri = await SAF.createFileAsync(cfg.folderUri, PREFIX + today, 'application/json');
    await SAF.writeAsStringAsync(uri, JSON.stringify(buildPayload(await getData())));
    // Keep only the newest KEEP backups.
    const ours = (await SAF.readDirectoryAsync(cfg.folderUri))
      .filter((f) => fileName(f).startsWith(PREFIX))
      .sort((a, b) => (fileName(a) < fileName(b) ? 1 : -1));
    for (const old of ours.slice(KEEP)) await SAF.deleteAsync(old, { idempotent: true }).catch(() => {});
    const next = { ...cfg, lastAt: Date.now(), lastError: undefined };
    await saveAutoBackup(next);
    return next;
  } catch (e: any) {
    const next = { ...cfg, lastError: 'לא הצלחתי לשמור בתיקייה (אולי היא נמחקה או שהגישה בוטלה). בחר תיקייה מחדש.' };
    await saveAutoBackup(next);
    return next;
  }
}

/** Backups in the auto-backup folder, newest first: [{ uri, date }]. */
export async function listAutoBackups(): Promise<{ uri: string; date: string }[]> {
  const cfg = await loadAutoBackup();
  if (!cfg.folderUri) return [];
  try {
    return (await SAF.readDirectoryAsync(cfg.folderUri))
      .filter((f) => fileName(f).startsWith(PREFIX))
      .map((uri) => ({ uri, date: fileName(uri).slice(PREFIX.length, PREFIX.length + 10) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
}

export async function readAutoBackup(uri: string): Promise<BackupData | null> {
  try {
    return parseBackup(await SAF.readAsStringAsync(uri));
  } catch {
    Alert.alert('השחזור נכשל', 'לא הצלחתי לקרוא את קובץ הגיבוי.');
    return null;
  }
}
