import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY = '@avi_board_apk_state_v2';
export const AREAS_KEY = '@avi_geo_areas_v1';
export const AREA_STATE_KEY = '@avi_geo_area_state_v1';
export const TIMER_KEY = '@avi_timer_v1';
export const SETUP_SEEN_KEY = '@avi_setup_seen_v1';

export interface StickyNote {
  id: string;
  title: string;
  body: string;
  updatedAt: string; // ISO timestamp
  done?: boolean;
  scheduleEnabled?: boolean;
  reminderMode?: 'ring' | 'silent'; // default ring
  reminderType?: 'once' | 'repeat';
  repeatDays?: number[]; // 0 = Sunday
  repeatEnd?: string; // YYYY-MM-DD
  scheduleDate?: string; // YYYY-MM-DD
  scheduleTime?: string; // HH:MM
  notificationId?: string | null;
}

export interface WorkoutLink {
  id: string;
  title: string;
  url: string;
  platform: 'youtube' | 'facebook' | 'other';
}

export interface MuscleCategory {
  id: string;
  name: string;
  videos: WorkoutLink[];
}

export type AreaMode = 'once' | 'every';

export interface AlarmArea {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
  mode: AreaMode;
  note?: string;
}

/** Runtime state written by the background task (kept separate from the areas list). */
export interface AreaRuntimeState {
  inside?: 'inside' | 'outside';
  lastRingAt?: number;
}

export interface BoardState {
  notes?: StickyNote[];
  categories?: MuscleCategory[];
}

export interface TimerState {
  durationSec: number;
  endAt: number | null; // epoch ms when running
  pausedRemainingSec: number | null;
  notificationId: string | null;
}

export const DEFAULT_CATEGORIES: MuscleCategory[] = [
  { id: 'chest', name: 'חזה', videos: [] },
  { id: 'back', name: 'גב', videos: [] },
  { id: 'legs', name: 'רגליים', videos: [] },
];

export const WELCOME_NOTE: StickyNote = {
  id: 'welcome-1',
  title: 'פתק דוגמה',
  body: 'לחץ על "הדבק פתק צהוב" להוספת פתק חדש, או לחץ על פתק קיים כדי לפתוח אותו.',
  updatedAt: new Date().toISOString(),
  scheduleEnabled: false,
};

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export const loadBoard = () => readJson<BoardState & { locationAlarms?: unknown }>(STORAGE_KEY);
export const saveBoard = (state: BoardState) => writeJson(STORAGE_KEY, state);

export const loadAreas = async () => (await readJson<AlarmArea[]>(AREAS_KEY)) ?? [];
export const saveAreas = (areas: AlarmArea[]) => writeJson(AREAS_KEY, areas);

export const loadAreaStates = async () =>
  (await readJson<Record<string, AreaRuntimeState>>(AREA_STATE_KEY)) ?? {};
export const saveAreaStates = (s: Record<string, AreaRuntimeState>) => writeJson(AREA_STATE_KEY, s);

export const loadTimer = () => readJson<TimerState>(TIMER_KEY);
export const saveTimer = (t: TimerState) => writeJson(TIMER_KEY, t);

export async function wasSetupSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SETUP_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}
export async function markSetupSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SETUP_SEEN_KEY, '1');
  } catch {
    // ignore
  }
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatHebrewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // older notes stored a formatted string
  return d.toLocaleDateString('he-IL');
}

export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- alarm clocks & sounds ----------

export const ALARMS_KEY = '@avi_alarm_clocks_v1';
export const SOUNDS_KEY = '@avi_sounds_v1';

export interface AlarmClock {
  id: string;
  label: string;
  hour: number;
  minute: number;
  days: number[]; // 0 = Sunday ... 6 = Saturday; empty = one-time
  enabled: boolean;
  snoozeEnabled: boolean;
  snoozeMin: number;
  snoozeCount: number; // -1 = unlimited
}

export type SoundKind = 'alarm' | 'timer' | 'reminder' | 'geo';
export type SoundSettings = Partial<Record<SoundKind, string>>; // uri; missing = phone default alarm sound

export const loadAlarmClocks = async () => (await readJson<AlarmClock[]>(ALARMS_KEY)) ?? [];
export const saveAlarmClocks = (a: AlarmClock[]) => writeJson(ALARMS_KEY, a);
export const loadSounds = async () => (await readJson<SoundSettings>(SOUNDS_KEY)) ?? {};
export const saveSounds = (s: SoundSettings) => writeJson(SOUNDS_KEY, s);

// ---------- v4: settings, workout groups, tasks, document folders ----------

export const THEME_KEY = '@avi_theme_v1';
export const GROUPS_KEY = '@avi_workout_groups_v1';
export const TASKS_KEY = '@avi_tasks_v1';
export const DOC_FOLDERS_KEY = '@avi_doc_folders_v1';

export interface WorkoutSub {
  id: string;
  name: string;
  videos: WorkoutLink[];
}
export interface WorkoutGroup {
  id: string;
  name: string;
  subs: WorkoutSub[];
}

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  done: boolean;
  doneAt?: number;
  createdAt: number;
  order: number;
  star?: boolean;
  due?: string; // YYYY-MM-DD
  reminder?: boolean;
  reminderTime?: string; // HH:MM
  reminderMode?: 'ring' | 'silent';
  repeatDays?: number[]; // recurring task: next due date after completion
  areaId?: string; // remind when entering this location area
  subtasks?: SubTask[];
}

export interface DocFolder {
  uri: string;
  name: string;
}

export const loadThemeMode = async () => ((await readJson<string>(THEME_KEY)) as 'auto' | 'light' | 'dark' | null) ?? 'auto';
export const saveThemeMode = (m: string) => writeJson(THEME_KEY, m);
export const loadGroups = () => readJson<WorkoutGroup[]>(GROUPS_KEY);
export const saveGroups = (g: WorkoutGroup[]) => writeJson(GROUPS_KEY, g);
export const loadTasks = async () => (await readJson<Task[]>(TASKS_KEY)) ?? [];
export const saveTasks = (t: Task[]) => writeJson(TASKS_KEY, t);
export const loadDocFolders = async () => (await readJson<DocFolder[]>(DOC_FOLDERS_KEY)) ?? [];
export const saveDocFolders = (f: DocFolder[]) => writeJson(DOC_FOLDERS_KEY, f);

const sub = (name: string): WorkoutSub => ({ id: newId(), name, videos: [] });
const group = (name: string, subs: string[]): WorkoutGroup => ({ id: newId(), name, subs: subs.map(sub) });

export function defaultGroups(): WorkoutGroup[] {
  return [
    group('חזה', ['עליון', 'אמצעי', 'תחתון']),
    group('גב', ['רחב גבי', 'גב עליון וטרפזים', 'גב תחתון']),
    group('כתפיים', ['קדמית', 'צדדית', 'אחורית']),
    group('יד קדמית', ['ראש ארוך', 'ראש קצר', 'פטישים']),
    group('יד אחורית', ['ראש ארוך', 'ראש צדי', 'ראש פנימי']),
    group('אמות', ['כפיפה', 'פשיטה', 'כוח אחיזה']),
    group('רגליים', ['ארבע ראשי', 'ירך אחורית', 'ישבן', 'תאומים']),
    group('בטן', ['עליונה', 'תחתונה', 'אלכסונים', 'ליבה']),
    group('כושר כללי', ['חימום', 'מתיחות', 'אירובי ו-HIIT']),
  ];
}

/** Moves videos from the old flat categories into the new groups (sub-group "כללי"). */
export function migrateCategories(old: MuscleCategory[] | undefined): WorkoutGroup[] {
  const groups = defaultGroups();
  for (const cat of old ?? []) {
    if (!cat.videos?.length) continue;
    let g = groups.find((x) => x.name === cat.name);
    if (!g) {
      g = { id: newId(), name: cat.name, subs: [] };
      groups.push(g);
    }
    let general = g.subs.find((s) => s.name === 'כללי');
    if (!general) {
      general = sub('כללי');
      g.subs.unshift(general);
    }
    general.videos.push(...cat.videos);
  }
  return groups;
}
