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
