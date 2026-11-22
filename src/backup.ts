import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
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
}

const BACKUP_APP_ID = 'avi-personal-board';

export async function exportBackup(data: BackupData): Promise<void> {
  const payload = {
    app: BACKUP_APP_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
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
    const raw = await FileSystem.readAsStringAsync(res.assets[0].uri);
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
    };
  } catch {
    Alert.alert('השחזור נכשל', 'לא הצלחתי לקרוא את קובץ הגיבוי.');
    return null;
  }
}
