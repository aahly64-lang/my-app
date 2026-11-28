import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

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
  docs?: DocLink[]; // attached documents from the documents tab
  html?: string; // formatted body (body keeps the plain text)
  color?: string; // note color key (see NOTE_COLORS)
  locked?: boolean; // needs fingerprint / phone lock to open
}

/** A file from a connected folder, attached to a task or a note. */
export interface DocLink {
  uri: string;
  name: string;
  mime: string;
}

export interface WorkoutLink {
  id: string;
  title: string;
  url: string;
  platform: 'youtube' | 'facebook' | 'other';
  note?: string; // personal note
  fav?: boolean;
  tags?: string[]; // equipment
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
  /** Precise mode: the app follows the position itself (faster ring, more battery). */
  precise?: boolean;
}

/** Runtime state written by the background task (kept separate from the areas list). */
export interface AreaRuntimeState {
  inside?: 'inside' | 'outside';
  lastRingAt?: number;
  /** Precise areas: inside the large approach zone around the point. */
  approach?: 'inside' | 'outside';
  /** Precise areas: close tracking should run (approaching, not yet inside the point). */
  armed?: boolean;
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

// ---------- location log (last events, for troubleshooting) ----------

export const GEO_LOG_KEY = '@avi_geo_log_v1';
const GEO_LOG_MAX = 50;

export interface GeoLogEntry {
  at: number;
  label: string;
  /** What happened: enter / exit / start (position checked when saving) / problem. */
  kind: 'enter' | 'exit' | 'start' | 'problem';
  /** Short Hebrew explanation of the outcome. */
  text: string;
  ok?: boolean;
  /** Where the phone was (last known position), for the map. */
  lat?: number;
  lon?: number;
}

export const loadGeoLog = async () => (await readJson<GeoLogEntry[]>(GEO_LOG_KEY)) ?? [];
export const clearGeoLog = () => writeJson(GEO_LOG_KEY, []);
export async function addGeoLog(e: Omit<GeoLogEntry, 'at'>) {
  const list = await loadGeoLog();
  const last = list[0];
  if (last && last.text === e.text && last.label === e.label && Date.now() - last.at < 60 * 60 * 1000) return;
  let pos: { lat: number; lon: number } | null = null;
  try {
    const p = await Promise.race([
      Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
    if (p) pos = { lat: p.coords.latitude, lon: p.coords.longitude };
  } catch {
    // no position - the entry is still logged
  }
  list.unshift({ ...e, at: Date.now(), ...(pos ?? {}) });
  await writeJson(GEO_LOG_KEY, list.slice(0, GEO_LOG_MAX));
}

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
  repeatMonthDay?: number; // recurring: this day of every month (1–31)
  repeatEvery?: number; // recurring: every N days
  areaId?: string; // remind when entering this location area
  subtasks?: SubTask[];
  docs?: DocLink[]; // attached documents
  list?: string; // TaskList id
  contact?: { name: string; phone: string };
  photos?: string[]; // file uris in the app's own folder
}

export interface TaskList {
  id: string;
  name: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  items: string[];
}

export const TASK_LISTS_KEY = '@avi_task_lists_v1';
export const TASK_TEMPLATES_KEY = '@avi_task_templates_v1';
export const TASK_MORNING_KEY = '@avi_task_morning_v1';
export const loadTaskLists = async () => (await readJson<TaskList[]>(TASK_LISTS_KEY)) ?? [];
export const saveTaskLists = (l: TaskList[]) => writeJson(TASK_LISTS_KEY, l);
export const loadTaskTemplates = async () => (await readJson<TaskTemplate[]>(TASK_TEMPLATES_KEY)) ?? [];
export const saveTaskTemplates = (t: TaskTemplate[]) => writeJson(TASK_TEMPLATES_KEY, t);
export const loadMorning = async () => (await readJson<{ enabled: boolean; time: string }>(TASK_MORNING_KEY)) ?? { enabled: false, time: '07:30' };
export const saveMorning = (m: { enabled: boolean; time: string }) => writeJson(TASK_MORNING_KEY, m);

export interface DocFolder {
  uri: string;
  name: string;
  /** copy this folder's files to Google Drive too (with the documents backup). undefined = yes (older folders) */
  drive?: boolean;
}

/** A folder picked through Google Drive's own provider: the phone lets apps only read there. */
export const isDriveUri = (uri: string) => /^content:\/\/com\.google\.android\.apps\.docs/.test(uri);

export const loadThemeMode = async () => ((await readJson<string>(THEME_KEY)) as 'auto' | 'light' | 'dark' | null) ?? 'auto';
export const saveThemeMode = (m: string) => writeJson(THEME_KEY, m);
export const ACCENT_KEY = '@avi_accent_v1';
export const loadAccent = async () => (await readJson<string>(ACCENT_KEY)) ?? 'yellow';
export const saveAccent = (k: string) => writeJson(ACCENT_KEY, k);
export const BG_KEY = '@avi_bg_v1';
/** 'default' (white / black in dark mode) or a hex color. */
export const loadBg = async () => (await readJson<string>(BG_KEY)) ?? 'default';
export const saveBg = (k: string) => writeJson(BG_KEY, k);
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

// ---------- my ringtones ----------

export const RINGTONES_KEY = '@avi_ringtones_v1';

export interface MyRingtone {
  id: string;
  name: string;
  /** file:// copy inside the app */
  path: string;
  /** content:// in the phone's Ringtones (used for alarms and by the phone) */
  mediaUri: string | null;
  durationMs: number;
  createdAt: number;
}

export const loadRingtones = async () => (await readJson<MyRingtone[]>(RINGTONES_KEY)) ?? [];
export const saveRingtones = (list: MyRingtone[]) => writeJson(RINGTONES_KEY, list);

// ---------- documents tab: favorites, recent, expiry ----------

export const DOC_META_KEY = '@avi_doc_meta_v1';
export const DOC_RECENT_KEY = '@avi_doc_recent_v1';
export const DOC_VIEW_KEY = '@avi_doc_view_v1';

export interface DocMeta {
  name: string;
  mime: string;
  fav?: boolean;
  expiry?: string; // YYYY-MM-DD
  remindDays?: number; // remind this many days before the expiry (0 = no reminder)
  locked?: boolean; // needs fingerprint / phone lock to open or share
  note?: string; // free text the user wrote about the document
  tags?: string[]; // e.g. רכב, בריאות, ביטוח
  archived?: boolean; // hidden from the ordinary lists, no expiry reminders
  personal?: string; // slot in the "personal file" (id, license, passport…)
  renewYearly?: boolean; // the document is renewed every year (car license, insurance…)
  size?: number; // last known file size (for lists built from meta)
}

/** True when nothing worth keeping is left in a document's meta. */
export const metaEmpty = (m: DocMeta | undefined) =>
  !m ||
  (!m.fav && !m.expiry && !m.locked && !m.note && !(m.tags && m.tags.length) && !m.archived && !m.personal && !m.renewYearly);

export interface RecentDoc extends DocLink {
  at: number;
}

export const DOC_PERSONAL_HIDDEN_KEY = '@avi_doc_personal_hidden_v1';
/** Personal-file slots the user marked as not relevant. */
export const loadPersonalHidden = async () => (await readJson<string[]>(DOC_PERSONAL_HIDDEN_KEY)) ?? [];
export const savePersonalHidden = (h: string[]) => writeJson(DOC_PERSONAL_HIDDEN_KEY, h);

export const loadDocMeta = async () => (await readJson<Record<string, DocMeta>>(DOC_META_KEY)) ?? {};
export const saveDocMeta = (m: Record<string, DocMeta>) => writeJson(DOC_META_KEY, m);
export const loadDocRecent = async () => (await readJson<RecentDoc[]>(DOC_RECENT_KEY)) ?? [];
export const saveDocRecent = (r: RecentDoc[]) => writeJson(DOC_RECENT_KEY, r);
export const loadDocView = async () => ((await readJson<string>(DOC_VIEW_KEY)) as 'list' | 'grid' | null) ?? 'list';
export const saveDocView = (v: 'list' | 'grid') => writeJson(DOC_VIEW_KEY, v);
export const DOC_SAVE_FOLDER_KEY = '@avi_doc_save_folder_v1'; // last folder a scan / shared file was saved to
export const loadDocSaveFolder = () => readJson<string>(DOC_SAVE_FOLDER_KEY);
export const saveDocSaveFolder = (uri: string) => writeJson(DOC_SAVE_FOLDER_KEY, uri);

// ---------- stopwatch & journals ----------

export const STOPWATCH_KEY = '@avi_stopwatch_v1';
export const JOURNALS_KEY = '@avi_journals_v1';

export interface StopwatchState {
  startAt: number | null; // running since (ms epoch)
  accumulated: number; // ms counted before the current run
}

export interface JournalEntry {
  id: string;
  ms: number;
  at?: number; // date/time of the entry (optional)
  note?: string;
  savedAt: number;
}

export interface Journal {
  id: string;
  name: string;
  locked?: boolean; // ask for fingerprint / screen lock before opening
  entries: JournalEntry[];
  createdAt: number;
}

export const loadStopwatch = async () =>
  (await readJson<StopwatchState>(STOPWATCH_KEY)) ?? { startAt: null, accumulated: 0 };
export const saveStopwatch = (s: StopwatchState) => writeJson(STOPWATCH_KEY, s);
export const loadJournals = async () => (await readJson<Journal[]>(JOURNALS_KEY)) ?? [];
export const saveJournals = (j: Journal[]) => writeJson(JOURNALS_KEY, j);

export const SCAN_QUALITY_KEY = '@avi_scan_quality_v1';
export type ScanQuality = 'small' | 'normal' | 'high' | 'original';
export const loadScanQuality = async () => ((await readJson<string>(SCAN_QUALITY_KEY)) as ScanQuality | null) ?? 'normal';
export const saveScanQuality = (q: ScanQuality) => writeJson(SCAN_QUALITY_KEY, q);

export const DOC_BASE_KEY = '@avi_doc_base_v1';
/** The phone folder (picked once, normally "Documents") in which "📁 צור תיקייה" creates folders. */
export const loadDocBase = () => readJson<string>(DOC_BASE_KEY);
export const saveDocBase = (uri: string) => writeJson(DOC_BASE_KEY, uri);
export const DOC_DRIVE_ASKED_KEY = '@avi_doc_drive_asked_v1';
/** Drive-provider folders the user was already told about (read-only there). */
export const loadDriveAsked = async () => (await readJson<string[]>(DOC_DRIVE_ASKED_KEY)) ?? [];
export const saveDriveAsked = (u: string[]) => writeJson(DOC_DRIVE_ASKED_KEY, u);

export const DOC_ORDER_KEY = '@avi_doc_order_v1';
/** Manual order of files per folder uri (file names). */
export const loadDocOrder = async () => (await readJson<Record<string, string[]>>(DOC_ORDER_KEY)) ?? {};
export const saveDocOrder = (o: Record<string, string[]>) => writeJson(DOC_ORDER_KEY, o);
