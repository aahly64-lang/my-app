import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Keyboard,
  Linking,
  SafeAreaView,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { GeoAlarm } from './modules/geo-alarm';
import MapPicker, { MapSelection } from './src/MapPicker';
import RingtonesScreen from './src/RingtonesScreen';
import { DocChips } from './src/docLinks';
import SetupScreen, { allAlarmPermissionsOk } from './src/SetupScreen';
import WorkoutsTab, { SharedLink, extractUrl } from './src/WorkoutsTab';
import TasksTab, { countDueToday } from './src/TasksTab';
import DocsTab from './src/DocsTab';
import { syncGeofences, MIN_RADIUS_M } from './src/geoTask';
import { exportBackup, pickBackup } from './src/backup';
import { useAppStyles } from './src/appStyles';
import { ThemeContext, ThemeMode, paletteFor, useTheme } from './src/theme';
import StopwatchCard from './src/Stopwatch';
import { NoteColorPicker, NoteEditor, RichText, htmlToPlain, noteBg, plainToHtml } from './src/richNote';
import { PopupShell, ReminderEditor, ReminderValue, confirm, emptyReminder } from './src/ui';
import { DAY_LETTERS, daysSummary, displayYMD, endOfDay, hhmm, parseHHMM, parseYMD, pickTimeWheels } from './src/pickers';
import {
  TIMER_RING_ID,
  alarmRingId,
  cancelRing,
  nextAlarmTime,
  noteRingId,
  scheduleAlarmClock,
  scheduleReminder,
  scheduleSimpleRing,
  scheduledRingIds,
  untilText,
} from './src/rings';
import {
  GeoLogEntry,
  clearGeoLog,
  loadGeoLog,
  AlarmArea,
  AlarmClock,
  AreaMode,
  StickyNote,
  Task,
  TimerState,
  WELCOME_NOTE,
  formatHebrewDate,
  loadAlarmClocks,
  loadAreas,
  migrateCategories,
  loadBoard,
  loadDocFolders,
  loadDocMeta,
  saveDocMeta,
  loadGroups,
  loadSounds,
  loadTasks,
  loadThemeMode,
  loadAccent,
  saveAccent,
  loadJournals,
  saveJournals,
  loadTimer,
  localDateString,
  markSetupSeen,
  newId,
  saveAlarmClocks,
  saveAreas,
  saveBoard,
  saveDocFolders,
  saveGroups,
  saveSounds,
  saveTasks,
  saveThemeMode,
  saveTimer,
  wasSetupSeen,
} from './src/storage';

type MainTab = 'notes' | 'tasks' | 'workouts' | 'alarms' | 'docs';

const TABS: [MainTab, string, string][] = [
  ['tasks', 'check-square', 'משימות'],
  ['notes', 'file-text', 'פתקים'],
  ['workouts', 'dumbbell', 'כושר'],
  ['alarms', 'clock', 'שעונים'],
  ['docs', 'folder', 'מסמכים'],
];

function TabIcon({ name, color }: { name: string; color: string }) {
  if (name === 'dumbbell') return <MaterialCommunityIcons name="dumbbell" size={21} color={color} />;
  return <Feather name={name as any} size={19} color={color} />;
}

const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function todayLabel(): string {
  const d = new Date();
  const day = d.getDay() === 6 ? 'שבת' : `יום ${HEB_DAYS[d.getDay()]}`;
  return `${day}, ${d.getDate()} ב${HEB_MONTHS[d.getMonth()]}`;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function formatRadius(r: number): string {
  return r >= 1000 ? `${Math.round(r / 10) / 100} ק"מ` : `${r} מ'`;
}

// ---------- note reminders ----------

function reminderFromNote(n: StickyNote): ReminderValue {
  const base = emptyReminder();
  return {
    ...base,
    enabled: !!n.scheduleEnabled,
    type: n.reminderType ?? 'once',
    date: n.scheduleDate ?? base.date,
    time: n.scheduleTime ?? base.time,
    days: n.repeatDays ?? [],
    endDate: n.repeatEnd ?? base.endDate,
    mode: n.reminderMode ?? 'ring',
  };
}

function noteReminderFields(r: ReminderValue): Partial<StickyNote> {
  return {
    scheduleEnabled: r.enabled,
    reminderType: r.type,
    reminderMode: r.mode,
    scheduleDate: r.enabled && r.type === 'once' ? r.date : undefined,
    scheduleTime: r.enabled ? r.time : undefined,
    repeatDays: r.enabled && r.type === 'repeat' ? r.days : undefined,
    repeatEnd: r.enabled && r.type === 'repeat' ? r.endDate : undefined,
    notificationId: null,
  };
}

/**
 * (Re)schedules the reminder of a note. Cancels any previous one first.
 * Returns false when the date/time is invalid (and tells the user unless silent).
 */
async function scheduleNoteReminder(
  noteId: string,
  title: string,
  body: string,
  r: ReminderValue,
  previousNotificationId?: string | null,
  quiet = false
): Promise<boolean> {
  cancelRing(noteRingId(noteId));
  if (previousNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(previousNotificationId).catch(() => {});
  }
  if (!r.enabled) return true;
  const [h, m] = parseHHMM(r.time);
  const t = title || 'תזכורת';
  const b = body || 'הגיע הזמן לבצע את המטלה.';
  if (r.type === 'repeat') {
    if (r.days.length === 0) {
      if (!quiet) Alert.alert('חסרים ימים', 'בחר לפחות יום אחד בשבוע.');
      return false;
    }
    const ok = await scheduleReminder({
      id: noteRingId(noteId),
      title: t,
      body: b,
      silent: r.mode === 'silent',
      repeat: { days: r.days, hour: h, minute: m, endAt: endOfDay(r.endDate) },
    });
    if (!ok && !quiet) Alert.alert('אין מועד עתידי', 'אין אף מועד לפני תאריך הסיום. בדוק את הימים ותאריך הסיום.');
    return ok;
  }
  const d = parseYMD(r.date);
  if (!d) {
    if (!quiet) Alert.alert('תזמון לא תקין', 'בחר תאריך ושעה.');
    return false;
  }
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) {
    if (!quiet) Alert.alert('הזמן כבר עבר', 'בחר תאריך ושעה עתידיים כדי לתזמן תזכורת.');
    return false;
  }
  await scheduleReminder({ id: noteRingId(noteId), title: t, body: b, silent: r.mode === 'silent', once: { at: d.getTime() } });
  return true;
}

async function cancelNoteReminder(note: StickyNote) {
  cancelRing(noteRingId(note.id));
  if (note.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(note.notificationId).catch(() => {});
  }
}

function reminderTag(n: StickyNote): string | null {
  if (!n.scheduleEnabled || !n.scheduleTime) return null;
  const icon = n.reminderMode === 'silent' ? '🔕' : '🔔';
  if (n.reminderType === 'repeat') return `${icon} ${daysSummary(n.repeatDays ?? [])} ${n.scheduleTime}`;
  return n.scheduleDate ? `${icon} ${displayYMD(n.scheduleDate)} ${n.scheduleTime}` : null;
}

// ---------- App ----------

const LIST_PREVIEW = 3;

function ExpandToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const c = useTheme();
  if (count <= LIST_PREVIEW) return null;
  return (
    <TouchableOpacity onPress={onToggle} style={{ paddingVertical: 10, alignItems: 'center' }} hitSlop={6}>
      <Text style={{ color: c.link, fontFamily: 'Heebo_600SemiBold', fontSize: 14 }}>
        {open ? '▴ הצג פחות' : `▾ הצג הכל (${count})`}
      </Text>
    </TouchableOpacity>
  );
}

export default function App() {
  const system = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('auto');
  useEffect(() => {
    loadThemeMode().then((m) => setThemeModeState(m as ThemeMode));
  }, []);
  const setThemeMode = (m: ThemeMode) => {
    setThemeModeState(m);
    saveThemeMode(m);
  };
  const [accent, setAccentState] = useState('yellow');
  useEffect(() => {
    loadAccent().then(setAccentState);
  }, []);
  const setAccent = (k: string) => {
    setAccentState(k);
    saveAccent(k);
  };
  const dark = themeMode === 'dark' || (themeMode === 'auto' && system === 'dark');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeContext.Provider value={paletteFor(dark, accent)}>
        <AppInner themeMode={themeMode} setThemeMode={setThemeMode} dark={dark} accent={accent} setAccent={setAccent} />
      </ThemeContext.Provider>
    </GestureHandlerRootView>
  );
}

function AppInner({
  themeMode,
  setThemeMode,
  dark,
  accent,
  setAccent,
}: {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  dark: boolean;
  accent: string;
  setAccent: (k: string) => void;
}) {
  const styles = useAppStyles();
  const c = useTheme();
  const [activeTab, setActiveTab] = useState<MainTab>('tasks');
  const [dataVersion, setDataVersion] = useState(0);
  const [tasksBadge, setTasksBadge] = useState(0);
  const [shared, setShared] = useState<SharedLink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [setupVisible, setSetupVisible] = useState(false);
  const [permissionsOk, setPermissionsOk] = useState(true);
  const [bgLocationOk, setBgLocationOk] = useState(true);
  const [geoLog, setGeoLog] = useState<GeoLogEntry[] | null>(null);
  const [ringtonesVisible, setRingtonesVisible] = useState(false);
  const [showAllAlarms, setShowAllAlarms] = useState(false);
  const [showAllAreas, setShowAllAreas] = useState(false);

  // --- notes ---
  const [notes, setNotes] = useState<StickyNote[]>([WELCOME_NOTE]);
  const [createVisible, setCreateVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newHtml, setNewHtml] = useState('');
  const [newColor, setNewColor] = useState('default');
  const [editorKey, setEditorKey] = useState(0);
  const [newReminder, setNewReminder] = useState<ReminderValue>(emptyReminder());

  const [selectedNote, setSelectedNote] = useState<StickyNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editHtml, setEditHtml] = useState('');
  const [editColor, setEditColor] = useState('default');
  const [editReminder, setEditReminder] = useState<ReminderValue>(emptyReminder());

  // --- alarm clocks ---
  const [alarms, setAlarms] = useState<AlarmClock[]>([]);
  const [alarmForm, setAlarmForm] = useState<AlarmClock | null>(null);
  const [alarmFormIsNew, setAlarmFormIsNew] = useState(false);

  // --- timer ---
  const [timerMinutes, setTimerMinutes] = useState('3');
  const [timerSeconds, setTimerSeconds] = useState('00');
  const [timer, setTimer] = useState<TimerState>({
    durationSec: 180,
    endAt: null,
    pausedRemainingSec: null,
    notificationId: null,
  });
  const [now, setNow] = useState(Date.now());

  // --- location areas ---
  const [areas, setAreas] = useState<AlarmArea[]>([]);
  const [mapVisible, setMapVisible] = useState(false);
  const [mapInitial, setMapInitial] = useState<MapSelection | null>(null);
  const [mapFallback, setMapFallback] = useState<{ lat: number; lon: number } | null>(null);
  const [areaForm, setAreaForm] = useState<{
    id: string | null;
    sel: MapSelection;
    label: string;
    mode: AreaMode;
    note: string;
    precise: boolean;
    moved: boolean;
  } | null>(null);
  const pendingFormRef = useRef<typeof areaForm>(null);

  // ---------- load & persist ----------

  const reconcileAlarms = useCallback(async (list: AlarmClock[]) => {
    // One-time alarms that already rang are switched off.
    const ids = scheduledRingIds();
    let changed = false;
    const next = list.map((a) => {
      if (a.enabled && a.days.length === 0 && !ids.has(alarmRingId(a.id)) && !ids.has(`${alarmRingId(a.id)}:snooze`)) {
        changed = true;
        return { ...a, enabled: false };
      }
      return a;
    });
    if (changed) await saveAlarmClocks(next);
    return next;
  }, []);

  const refreshPermissions = useCallback(async () => {
    setPermissionsOk(await allAlarmPermissionsOk());
    try {
      setBgLocationOk((await Location.getBackgroundPermissionsAsync()).granted);
    } catch {
      setBgLocationOk(false);
    }
  }, []);

  const openGeoLog = async () => setGeoLog(await loadGeoLog());

  useEffect(() => {
    (async () => {
      const board = await loadBoard();
      if (board) {
        if (Array.isArray(board.notes)) setNotes(board.notes);
      }
      // One-time move of the old flat workout categories into groups/sub-groups.
      if (!(await loadGroups())) await saveGroups(migrateCategories(board?.categories));
      setTasksBadge(countDueToday(await loadTasks()));

      let storedAreas = await loadAreas();
      // Migrate coordinate-based alarms from the first version.
      const legacy = (board as { locationAlarms?: Array<Record<string, unknown>> } | null)?.locationAlarms;
      if (storedAreas.length === 0 && Array.isArray(legacy) && legacy.length) {
        storedAreas = legacy.map((a) => ({
          id: String(a.id ?? newId()),
          label: String(a.label ?? 'אזור'),
          latitude: Number(a.latitude),
          longitude: Number(a.longitude),
          radiusMeters: Math.max(MIN_RADIUS_M, Number(a.radiusMeters) || MIN_RADIUS_M),
          enabled: Boolean(a.enabled),
          mode: 'every' as AreaMode,
        }));
        await saveAreas(storedAreas);
      }
      setAreas(storedAreas);
      // Re-register areas on every launch (Android drops them after a restart)
      // and resolve any unknown inside/outside state.
      syncGeofences(storedAreas);

      const storedAlarms = await reconcileAlarms(await loadAlarmClocks());
      setAlarms(storedAlarms);
      for (const a of storedAlarms) if (a.enabled) await scheduleAlarmClock(a);

      const t = await loadTimer();
      if (t) {
        if (t.endAt && t.endAt <= Date.now()) {
          setTimer({ ...t, endAt: null, pausedRemainingSec: null, notificationId: null });
        } else {
          setTimer(t);
        }
        setTimerMinutes(String(Math.floor(t.durationSec / 60)));
        setTimerSeconds(String(t.durationSec % 60).padStart(2, '0'));
      }

      setLoaded(true);

      if (!(await wasSetupSeen())) {
        setSetupVisible(true);
        markSetupSeen();
      }
      refreshPermissions();
    })();
  }, [refreshPermissions, reconcileAlarms]);

  useEffect(() => {
    if (loaded) saveBoard({ notes });
  }, [notes, loaded]);

  useEffect(() => {
    if (loaded) saveTimer(timer);
  }, [timer, loaded]);

  // Reload areas when returning to the app (the background task may switch off "once" areas).
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') {
        setAreas(await loadAreas());
        setAlarms(await reconcileAlarms(await loadAlarmClocks()));
        setTasksBadge(countDueToday(await loadTasks()));
        refreshPermissions();
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, reconcileAlarms]);

  // ---------- shared links from YouTube / Facebook ----------

  const handleSharedText = useCallback((text: string) => {
    const url = extractUrl(text) ?? text.trim();
    if (!url) return;
    setActiveTab('workouts');
    const withoutUrl = text.replace(url, '').trim();
    setShared({ url, title: withoutUrl.length > 0 && withoutUrl.length < 80 ? withoutUrl : '' });
  }, []);
  const onSharedUsed = useCallback(() => setShared(null), []);

  useEffect(() => {
    const initial = GeoAlarm.getInitialSharedText();
    if (initial) handleSharedText(initial);
    const sub = GeoAlarm.addSharedTextListener(handleSharedText);
    return () => sub.remove();
  }, [handleSharedText]);

  // ---------- notes ----------

  const sortedNotes = useMemo(
    () => [...notes.filter((n) => !n.done), ...notes.filter((n) => n.done)],
    [notes]
  );

  const openCreateNote = () => {
    setNewTitle('');
    setNewBody('');
    setNewHtml('');
    setNewColor('default');
    setEditorKey((k) => k + 1);
    setNewReminder(emptyReminder());
    setCreateVisible(true);
  };

  const createNote = async () => {
    if (!newTitle.trim() && !newBody.trim()) {
      Alert.alert('פתק ריק', 'הזן כותרת או תוכן לפתק.');
      return;
    }
    const id = newId();
    Keyboard.dismiss();
    if (!newReminder.enabled) setCreateVisible(false); // close right away; saving continues behind
    const ok = await scheduleNoteReminder(id, newTitle.trim(), newBody.trim(), newReminder, null);
    if (!ok) return;
    const item: StickyNote = {
      id,
      title: newTitle.trim() || 'פתק צהוב',
      body: newBody.trim(),
      html: newBody.trim() ? newHtml : undefined,
      color: newColor === 'default' ? undefined : newColor,
      updatedAt: new Date().toISOString(),
      ...noteReminderFields(newReminder),
    };
    setNotes((prev) => [item, ...prev]);
    setCreateVisible(false);
  };

  const openNote = (note: StickyNote) => {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditBody(note.body);
    setEditHtml(note.html ?? plainToHtml(note.body));
    setEditColor(note.color ?? 'default');
    setEditorKey((k) => k + 1);
    setEditReminder(reminderFromNote(note));
  };

  const saveNote = async () => {
    if (!selectedNote) return;
    Keyboard.dismiss();
    const ok = await scheduleNoteReminder(
      selectedNote.id,
      editTitle.trim(),
      editBody.trim(),
      editReminder,
      selectedNote.notificationId
    );
    if (!ok) return;
    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedNote.id
          ? {
              ...n,
              title: editTitle.trim() || 'פתק צהוב',
              body: editBody.trim(),
              html: editBody.trim() ? editHtml : undefined,
              color: editColor === 'default' ? undefined : editColor,
              updatedAt: new Date().toISOString(),
              ...noteReminderFields(editReminder),
            }
          : n
      )
    );
    setSelectedNote(null);
  };

  const askSave = (onSave: () => void, onDiscard: () => void) =>
    Alert.alert('לשמור את השינויים?', undefined, [
      { text: 'המשך לערוך', style: 'cancel' },
      { text: 'אל תשמור', style: 'destructive', onPress: onDiscard },
      { text: 'שמור', onPress: onSave },
    ], { cancelable: true });

  const closeCreate = () => {
    if (newTitle.trim() || newBody.trim()) askSave(createNote, () => setCreateVisible(false));
    else setCreateVisible(false);
  };

  const closeEdit = () => {
    const n = selectedNote;
    if (!n) return;
    const dirty =
      editTitle !== n.title ||
      editBody.trim() !== (n.body ?? '').trim() ||
      (editColor === 'default' ? undefined : editColor) !== n.color ||
      JSON.stringify(editReminder) !== JSON.stringify(reminderFromNote(n));
    if (dirty) askSave(saveNote, () => setSelectedNote(null));
    else setSelectedNote(null);
  };

  const toggleDone = async (note: StickyNote) => {
    const done = !note.done;
    if (done) await cancelNoteReminder(note);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === note.id
          ? {
              ...n,
              done,
              ...(done ? { notificationId: null, scheduleEnabled: false } : {}),
            }
          : n
      )
    );
  };

  const deleteNote = (note: StickyNote) => {
    confirm('מחיקת פתק', `למחוק את "${note.title}"?`, 'מחק', async () => {
      await cancelNoteReminder(note);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setSelectedNote(null);
    });
  };

  const shareNote = async (note: StickyNote) => {
    const tag = reminderTag(note);
    await Share.share({
      message: `${editTitle || note.title}\n\n${editBody || note.body}${tag ? `\nתזכורת: ${tag}` : ''}`,
    });
  };

  // Note -> task (the note is removed).
  const noteToTask = (note: StickyNote) => {
    confirm('העברה למשימות', `להפוך את "${note.title}" למשימה? הפתק יוסר.`, 'העבר', async () => {
      await cancelNoteReminder(note);
      const tasks = await loadTasks();
      const task: Task = {
        id: newId(),
        title: note.title,
        notes: note.body || undefined,
        done: false,
        createdAt: Date.now(),
        order: tasks.reduce((m, t) => Math.min(m, t.order), 0) - 1,
        subtasks: [],
        docs: note.docs,
      };
      await saveTasks([task, ...tasks]);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setSelectedNote(null);
      setDataVersion((v) => v + 1);
      setActiveTab('tasks');
    });
  };

  // Task -> note (called by the tasks tab, which removes the task).
  const taskToNote = useCallback((t: Task) => {
    const item: StickyNote = {
      id: newId(),
      title: t.title,
      body: [t.notes ?? '', ...(t.subtasks ?? []).map((s) => `${s.done ? '☑' : '☐'} ${s.title}`)]
        .filter(Boolean)
        .join('\n'),
      updatedAt: new Date().toISOString(),
      docs: t.docs,
    };
    setNotes((prev) => [item, ...prev]);
    setActiveTab('notes');
  }, []);

  // ---------- timer ----------

  const running = timer.endAt !== null;
  const remainingSec = running
    ? Math.max(0, Math.ceil(((timer.endAt as number) - now) / 1000))
    : timer.pausedRemainingSec ?? timer.durationSec;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (running && remainingSec <= 0) {
      // Finished: the scheduled notification rings by itself (also when the app is closed).
      setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: null, notificationId: null }));
    }
  }, [running, remainingSec]);

  const startTimer = async () => {
    const secs = timer.pausedRemainingSec ?? timer.durationSec;
    if (secs <= 0) return;
    const endAt = Date.now() + secs * 1000;
    await scheduleSimpleRing(TIMER_RING_ID, 'timer', endAt, 'הטיימר הסתיים', 'זמן הספירה לאחור הגיע לאפס');
    setNow(Date.now());
    setTimer((t) => ({ ...t, endAt, pausedRemainingSec: null, notificationId: null }));
  };

  const pauseTimer = () => {
    cancelRing(TIMER_RING_ID);
    setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: remainingSec, notificationId: null }));
  };

  const resetTimer = () => {
    cancelRing(TIMER_RING_ID);
    setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: null, notificationId: null }));
  };

  const applyTimer = () => {
    const m = Math.max(0, parseInt(timerMinutes || '0', 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(timerSeconds || '0', 10) || 0));
    cancelRing(TIMER_RING_ID);
    setTimer({ durationSec: m * 60 + s, endAt: null, pausedRemainingSec: null, notificationId: null });
  };

  // ---------- alarm clocks ----------

  const persistAlarms = async (next: AlarmClock[]) => {
    setAlarms(next);
    await saveAlarmClocks(next);
  };

  const openNewAlarm = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    setAlarmForm({
      id: newId(),
      label: '',
      hour: d.getHours(),
      minute: 0,
      days: [],
      enabled: true,
      snoozeEnabled: true,
      snoozeMin: 10,
      snoozeCount: 3,
    });
    setAlarmFormIsNew(true);
  };

  const saveAlarmForm = async () => {
    if (!alarmForm) return;
    const a = { ...alarmForm, enabled: true };
    const next = alarmFormIsNew ? [...alarms, a] : alarms.map((x) => (x.id === a.id ? a : x));
    next.sort((x, y) => x.hour * 60 + x.minute - (y.hour * 60 + y.minute));
    await scheduleAlarmClock(a);
    await persistAlarms(next);
    setAlarmForm(null);
    Alert.alert('השעון נקבע', `השעון יצלצל ${untilText(nextAlarmTime(a.hour, a.minute, a.days))}.`);
  };

  const toggleAlarm = async (a: AlarmClock) => {
    const updated = { ...a, enabled: !a.enabled };
    await scheduleAlarmClock(updated);
    await persistAlarms(alarms.map((x) => (x.id === a.id ? updated : x)));
  };

  const deleteAlarm = (a: AlarmClock) => {
    confirm('מחיקת שעון', `למחוק את השעון ${hhmm(a.hour, a.minute)}?`, 'מחק', async () => {
      cancelRing(alarmRingId(a.id));
      await persistAlarms(alarms.filter((x) => x.id !== a.id));
      setAlarmForm(null);
    });
  };

  const pickAlarmTime = () => {
    if (!alarmForm) return;
    pickTimeWheels(alarmForm.hour, alarmForm.minute, (h, m) =>
      setAlarmForm((f) => (f ? { ...f, hour: h, minute: m } : f))
    );
  };

  const formattedTime = `${String(Math.floor(remainingSec / 60)).padStart(2, '0')}:${String(
    remainingSec % 60
  ).padStart(2, '0')}`;

  // ---------- location areas ----------

  const persistAreas = async (next: AlarmArea[], resetIds: string[] = []) => {
    setAreas(next);
    await saveAreas(next);
    const r = await syncGeofences(next, { resetIds });
    if (r === 'no-permission' && next.some((a) => a.enabled)) {
      Alert.alert(
        'חסרות הרשאות',
        'האזור נשמר, אבל כדי שהשעון יעבוד צריך לאשר הרשאות מיקום והתראות.',
        [
          { text: 'אחר כך', style: 'cancel' },
          { text: 'להגדרות', onPress: () => setSetupVisible(true) },
        ]
      );
    } else if (r === 'error') {
      Alert.alert('שגיאה', 'לא הצלחתי להפעיל את מעקב האזורים. בדוק שה-GPS דלוק ושההרשאות מאושרות.');
    }
  };

  const openMapForNew = async () => {
    setMapInitial(null);
    pendingFormRef.current = null;
    try {
      const last = await Location.getLastKnownPositionAsync();
      setMapFallback(last ? { lat: last.coords.latitude, lon: last.coords.longitude } : null);
    } catch {
      setMapFallback(null);
    }
    setMapVisible(true);
  };

  const startAddArea = async () => {
    const ok = await allAlarmPermissionsOk();
    if (!ok) {
      Alert.alert(
        'כדאי להשלים הרשאות',
        'כדי שהשעון יצלצל גם כשהאפליקציה סגורה, צריך לאשר כמה הרשאות. אפשר לעשות את זה גם אחרי שמוסיפים אזור.',
        [
          { text: 'להגדרות', onPress: () => setSetupVisible(true) },
          { text: 'המשך למפה', onPress: openMapForNew },
        ]
      );
      return;
    }
    openMapForNew();
  };

  const onMapSaved = (sel: MapSelection) => {
    setMapVisible(false);
    const pending = pendingFormRef.current;
    if (pending) {
      setAreaForm({ ...pending, sel, moved: true });
      pendingFormRef.current = null;
    } else {
      setAreaForm({ id: null, sel, label: '', mode: 'every', note: '', precise: false, moved: true });
    }
  };

  const onMapClosed = () => {
    setMapVisible(false);
    if (pendingFormRef.current) {
      setAreaForm(pendingFormRef.current);
      pendingFormRef.current = null;
    }
  };

  const editArea = (a: AlarmArea) => {
    setAreaForm({
      id: a.id,
      sel: { lat: a.latitude, lon: a.longitude, radius: a.radiusMeters },
      label: a.label,
      mode: a.mode,
      note: a.note ?? '',
      precise: !!a.precise,
      moved: false,
    });
  };

  const changeAreaLocation = () => {
    if (!areaForm) return;
    pendingFormRef.current = areaForm;
    setMapInitial(areaForm.sel);
    setAreaForm(null);
    setMapVisible(true);
  };

  const saveAreaForm = async () => {
    if (!areaForm) return;
    const label = areaForm.label.trim();
    if (!label) {
      Alert.alert('חסר שם', 'תן שם לאזור, למשל "בית" או "עבודה".');
      return;
    }
    const base = {
      label,
      latitude: areaForm.sel.lat,
      longitude: areaForm.sel.lon,
      radiusMeters: Math.max(MIN_RADIUS_M, areaForm.sel.radius),
      mode: areaForm.mode,
      note: areaForm.note.trim() || undefined,
      precise: areaForm.precise || undefined,
    };
    let next: AlarmArea[];
    let resetIds: string[] = [];
    if (areaForm.id) {
      next = areas.map((a) => (a.id === areaForm.id ? { ...a, ...base, enabled: true } : a));
      if (areaForm.moved) resetIds = [areaForm.id];
    } else {
      const id = newId();
      next = [{ id, enabled: true, ...base }, ...areas];
      resetIds = [id];
    }
    setAreaForm(null);
    await persistAreas(next, resetIds);
  };

  const toggleArea = async (a: AlarmArea) => {
    const next = areas.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x));
    // Turning an area back on resets it, so it rings on the next real entry.
    await persistAreas(next, !a.enabled ? [a.id] : []);
  };

  const deleteArea = (a: AlarmArea) => {
    confirm('מחיקת אזור', `למחוק את האזור "${a.label}"?`, 'מחק', async () => {
      setAreaForm(null);
      await persistAreas(areas.filter((x) => x.id !== a.id), [a.id]);
    });
  };

  // ---------- backup ----------

  const doExport = async () => {
    try {
      await exportBackup({
        notes,
        categories: [],
        groups: (await loadGroups()) ?? [],
        tasks: await loadTasks(),
        areas: await loadAreas(),
        alarms,
        docFolders: await loadDocFolders(),
        docMeta: await loadDocMeta(),
        sounds: await loadSounds(),
        themeMode,
        accent,
        journals: await loadJournals(),
      });
    } catch {
      Alert.alert('הגיבוי נכשל', 'לא הצלחתי ליצור את קובץ הגיבוי.');
    }
  };

  const doImport = async () => {
    const data = await pickBackup();
    if (!data) return;
    const groups = data.groups.length ? data.groups : migrateCategories(data.categories);
    confirm(
      'שחזור מגיבוי',
      `הגיבוי כולל ${data.notes.length} פתקים, ${data.tasks.length} משימות, ${groups.length} קבוצות שרירים, ${data.alarms.length} שעונים מעוררים ו-${data.areas.length} אזורים.\nהשחזור יחליף את כל המידע הנוכחי באפליקציה.`,
      'שחזר',
      async () => {
        await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
        for (const id of scheduledRingIds()) cancelRing(id);
        const restoredNotes: StickyNote[] = [];
        for (const n of data.notes) {
          let ok = false;
          if (n.scheduleEnabled && !n.done) {
            ok = await scheduleNoteReminder(n.id, n.title, n.body, reminderFromNote(n), null, true);
          }
          restoredNotes.push({ ...n, notificationId: null, scheduleEnabled: ok });
        }
        for (const a of data.alarms) await scheduleAlarmClock(a);
        await persistAlarms(data.alarms);
        setNotes(restoredNotes);
        await saveGroups(groups);
        await saveTasks(data.tasks);
        await saveDocFolders(data.docFolders);
        if (data.docMeta) await saveDocMeta(data.docMeta);
        await saveSounds(data.sounds);
        if (data.themeMode) setThemeMode(data.themeMode as ThemeMode);
        if (data.accent) setAccent(data.accent);
        if (data.journals) await saveJournals(data.journals);
        cancelRing(TIMER_RING_ID);
        setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: null, notificationId: null }));
        await persistAreas(data.areas, data.areas.map((a) => a.id));
        setDataVersion((v) => v + 1);
        setSetupVisible(false);
        Alert.alert('השחזור הושלם', 'כל המידע שוחזר מהגיבוי. תזכורות של משימות יופעלו מחדש כשתשמור אותן.');
      }
    );
  };

  // ---------- render ----------

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.appEyebrow}>{todayLabel()}</Text>
          <Text style={styles.appTitle}>יומן ושולחן עבודה</Text>
        </View>
        <TouchableOpacity
          onPress={() => setSetupVisible(true)}
          hitSlop={10}
          style={styles.gearBtn}
          accessibilityLabel="הגדרות"
        >
          <Feather name="settings" size={20} color={c.text} />
          {!permissionsOk ? <View style={styles.gearDot} /> : null}
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(([key, icon, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabBtn, activeTab === key && styles.tabBtnActive]}
            onPress={() => setActiveTab(key)}
          >
            <View>
              <TabIcon name={icon} color={activeTab === key ? c.onAccent : c.muted} />
              {key === 'tasks' && tasksBadge > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{tasksBadge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.tabText, activeTab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'tasks' ? (
        <TasksTab dataVersion={dataVersion} onCountChange={setTasksBadge} onConvertToNote={taskToNote} />
      ) : null}
      {activeTab === 'workouts' ? (
        <WorkoutsTab dataVersion={dataVersion} shared={shared} onSharedUsed={onSharedUsed} />
      ) : null}
      {activeTab === 'docs' ? (
        <DocsTab
          dataVersion={dataVersion}
          notes={notes.map((n) => ({ id: n.id, title: n.title }))}
          onAttachToNote={(noteId, link) =>
            setNotes((prev) =>
              prev.map((n) =>
                n.id === noteId ? { ...n, docs: [...(n.docs ?? []).filter((d) => d.uri !== link.uri), link] } : n
              )
            )
          }
        />
      ) : null}

      {activeTab === 'notes' || activeTab === 'alarms' ? (
      <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent} keyboardShouldPersistTaps="handled">
        {/* ---------- notes ---------- */}
        {activeTab === 'notes' && (
          <View>
            <View style={styles.topActionBar}>
              <Text style={styles.sectionTitle}>שולחן עבודה</Text>
              <TouchableOpacity style={styles.stickNoteBtn} onPress={openCreateNote}>
                <Feather name="plus" size={18} color={c.onAccent} />
                <Text style={styles.stickNoteBtnText}>פתק חדש</Text>
              </TouchableOpacity>
            </View>

            {sortedNotes.length === 0 ? (
              <Text style={styles.emptyText}>אין פתקים. לחץ על "פתק חדש" כדי להוסיף.</Text>
            ) : null}

            <View style={styles.notesGrid}>
              {sortedNotes.map((note) => (
                <TouchableOpacity
                  key={note.id}
                  style={[
                    styles.yellowNote,
                    noteBg(note.color, c) ? { backgroundColor: noteBg(note.color, c) } : null,
                    note.done && styles.noteDone,
                  ]}
                  onPress={() => openNote(note)}
                  activeOpacity={0.8}
                >
                  <View style={styles.noteTop}>
                    <Text style={[styles.noteTitle, note.done && styles.strike]} numberOfLines={1}>
                      {note.title}
                    </Text>
                    <TouchableOpacity
                      onPress={() => toggleDone(note)}
                      hitSlop={10}
                      style={[styles.checkbox, note.done && styles.checkboxOn]}
                    >
                      {note.done ? <Feather name="check" size={16} color="#FFFFFF" /> : null}
                    </TouchableOpacity>
                  </View>
                  {note.html ? (
                    <RichText html={note.html} style={[styles.noteBody, note.done ? styles.mutedText : {}]} numberOfLines={6} />
                  ) : (
                    <Text style={[styles.noteBody, note.done && styles.mutedText]} numberOfLines={4}>
                      {note.body}
                    </Text>
                  )}
                  {reminderTag(note) ? <Text style={styles.scheduleTag}>{reminderTag(note)}</Text> : null}
                  <DocChips
                    docs={note.docs}
                    onRemove={(d) =>
                      setNotes((prev) =>
                        prev.map((n) => (n.id === note.id ? { ...n, docs: (n.docs ?? []).filter((x) => x.uri !== d.uri) } : n))
                      )
                    }
                  />
                  <Text style={styles.noteDate}>
                    {note.done ? 'בוצע · ' : ''}
                    {formatHebrewDate(note.updatedAt)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ---------- Tab 3: timer + location areas ---------- */}
        {activeTab === 'alarms' && (
          <View>
            <TouchableOpacity style={styles.ringtoneCta} onPress={() => setRingtonesVisible(true)}>
              <Text style={styles.ringtoneCtaIcon}>🎵</Text>
              <View style={styles.flex1}>
                <Text style={styles.ringtoneCtaTitle}>יצירת צלצול</Text>
                <Text style={styles.ringtoneCtaSub}>חתוך קטע משיר או מהקלטה, לשעונים ולטלפון</Text>
              </View>
              <Text style={styles.ringtoneCtaChev}>‹</Text>
            </TouchableOpacity>
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.subTitle}>⏰ שעון מעורר</Text>
                <TouchableOpacity style={styles.smallDarkBtn} onPress={openNewAlarm}>
                  <Text style={styles.whiteBtnText}>+ הוסף</Text>
                </TouchableOpacity>
              </View>
              {alarms.length === 0 ? <Text style={styles.emptyText}>עדיין אין שעונים מעוררים.</Text> : null}
              {(showAllAlarms ? alarms : alarms.slice(-LIST_PREVIEW)).map((a) => (
                <View key={a.id} style={styles.alarmItem}>
                  <TouchableOpacity
                    style={styles.flex1}
                    onPress={() => {
                      setAlarmForm(a);
                      setAlarmFormIsNew(false);
                    }}
                  >
                    <Text style={[styles.alarmTime, !a.enabled && styles.mutedText]}>{hhmm(a.hour, a.minute)}</Text>
                    <Text style={styles.itemSub}>
                      {a.label ? `${a.label} · ` : ''}
                      {daysSummary(a.days)}
                      {a.snoozeEnabled
                        ? ` · נודניק ${a.snoozeMin} דק' ${a.snoozeCount < 0 ? '(ללא הגבלה)' : `×${a.snoozeCount}`}`
                        : ' · בלי נודניק'}
                    </Text>
                  </TouchableOpacity>
                  <Switch
                trackColor={{ false: c.dark ? "#3A3A3C" : "#D1D1D6", true: c.accent }}
                thumbColor="#FFFFFF" value={a.enabled} onValueChange={() => toggleAlarm(a)} />
                </View>
              ))}
              <ExpandToggle count={alarms.length} open={showAllAlarms} onToggle={() => setShowAllAlarms((v) => !v)} />
            </View>

            <View style={styles.card}>
              <Text style={styles.subTitle}>📍 שעון מעורר לפי מיקום</Text>
              <Text style={styles.itemSub}>
                בחר אזור על המפה, והטלפון יצלצל כשתיכנס אליו, גם כשהאפליקציה סגורה.
              </Text>

              {!bgLocationOk ? (
                <TouchableOpacity style={styles.dangerBox} onPress={() => Linking.openSettings()}>
                  <Text style={styles.dangerText}>
                    ⛔ הרשאת המיקום אינה "אפשר כל הזמן", ולכן השעון לפי מיקום לא יעבוד כשהאפליקציה סגורה.
                  </Text>
                  <Text style={styles.dangerSub}>
                    לחץ כאן ← הרשאות ← מיקום ← בחר "אפשר כל הזמן"
                  </Text>
                </TouchableOpacity>
              ) : !permissionsOk ? (
                <TouchableOpacity style={styles.warnBox} onPress={() => setSetupVisible(true)}>
                  <Text style={styles.warnText}>
                    ⚠️ חסרות הרשאות, והשעון עלול לא לצלצל ברקע. לחץ כאן להשלמה.
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={[styles.darkBtn, styles.bigBtn]} onPress={startAddArea}>
                <Text style={styles.whiteBtnTextBig}>🗺️ הוסף אזור במפה</Text>
              </TouchableOpacity>

              {areas.length === 0 ? (
                <Text style={styles.emptyText}>עדיין לא הוגדרו אזורים.</Text>
              ) : null}

              <TouchableOpacity style={[styles.grayBtn, styles.geoLogBtn]} onPress={openGeoLog}>
                <Text style={styles.grayBtnText}>📋 יומן מיקום</Text>
              </TouchableOpacity>

              {(showAllAreas ? areas : areas.slice(-LIST_PREVIEW)).map((a) => (
                <View key={a.id} style={styles.areaItem}>
                  <TouchableOpacity style={styles.flex1} onPress={() => editArea(a)}>
                    <Text style={[styles.itemTitle, !a.enabled && styles.mutedText]}>{a.label}</Text>
                    <Text style={styles.itemSub}>
                      {a.mode === 'once' ? 'חד-פעמי' : 'בכל כניסה'} · רדיוס {formatRadius(a.radiusMeters)}
                      {a.precise ? ' · 🎯 מדויק' : ''}
                      {a.mode === 'once' && !a.enabled ? ' · צלצל וכבה' : ''}
                    </Text>
                    {a.note ? (
                      <Text style={styles.areaNote} numberOfLines={1}>
                        📝 {a.note}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                  <Switch
                trackColor={{ false: c.dark ? "#3A3A3C" : "#D1D1D6", true: c.accent }}
                thumbColor="#FFFFFF" value={a.enabled} onValueChange={() => toggleArea(a)} />
                </View>
              ))}
              <ExpandToggle count={areas.length} open={showAllAreas} onToggle={() => setShowAllAreas((v) => !v)} />
            </View>

            <View style={styles.card}>
              <Text style={styles.subTitle}>⏱️ טיימר ספירה לאחור</Text>
              <Text style={styles.timerText}>{formattedTime}</Text>
              <View style={styles.row}>
                <TextInput placeholderTextColor={c.muted}
                  style={[styles.input, styles.flex1, styles.noMargin, styles.centerText]}
                  keyboardType="number-pad"
                  placeholder="דקות"
                  value={timerMinutes}
                  onChangeText={setTimerMinutes}
                />
                <Text style={styles.colon}>:</Text>
                <TextInput placeholderTextColor={c.muted}
                  style={[styles.input, styles.flex1, styles.noMargin, styles.centerText]}
                  keyboardType="number-pad"
                  placeholder="שניות"
                  value={timerSeconds}
                  onChangeText={setTimerSeconds}
                />
                <TouchableOpacity style={styles.grayBtn} onPress={applyTimer}>
                  <Text style={styles.grayBtnText}>קבע</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.darkBtn, styles.flex1]}
                  onPress={running ? pauseTimer : startTimer}
                >
                  <Text style={styles.whiteBtnText}>{running ? 'השהה' : 'התחל'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.grayBtn} onPress={resetTimer}>
                  <Text style={styles.grayBtnText}>איפוס</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hintText}>בסיום הטיימר יצלצל צלצול מלא, גם אם האפליקציה סגורה.</Text>
            </View>

            <StopwatchCard key={`sw-${dataVersion}`} />
          </View>
        )}
      </ScrollView>
      ) : null}

      {/* ---------- popup: new note ---------- */}
      <PopupShell
        visible={createVisible}
        title="פתק חדש"
        onClose={closeCreate}
        actions={
          <TouchableOpacity style={styles.headerSaveBtn} onPress={createNote} hitSlop={8}>
            <Text style={styles.headerSaveText}>✓ שמור</Text>
          </TouchableOpacity>
        }
      >
        <TextInput placeholderTextColor={c.muted} style={styles.popupInput} placeholder="כותרת הפתק..." value={newTitle} onChangeText={setNewTitle} />
        <NoteEditor
          key={`new-${editorKey}`}
          initialHtml=""
          onChange={(h) => {
            setNewHtml(h);
            setNewBody(htmlToPlain(h));
          }}
        />
        <Text style={styles.hintText}>צבע הפתק</Text>
        <NoteColorPicker value={newColor} onChange={setNewColor} />
        <ReminderEditor value={newReminder} onChange={setNewReminder} />
        <TouchableOpacity style={styles.darkBtn} onPress={createNote}>
          <Text style={styles.whiteBtnText}>הדבק לשולחן העבודה</Text>
        </TouchableOpacity>
      </PopupShell>

      {/* ---------- popup: existing note ---------- */}
      <PopupShell
        visible={!!selectedNote}
        title="פרטי פתק"
        onClose={closeEdit}
        actions={
          <>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => selectedNote && shareNote(selectedNote)} hitSlop={8}>
              <Text style={styles.headerIconText}>⤴</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerSaveBtn} onPress={saveNote} hitSlop={8}>
              <Text style={styles.headerSaveText}>✓ שמור</Text>
            </TouchableOpacity>
          </>
        }
      >
        <TextInput placeholderTextColor={c.muted} style={styles.popupInput} value={editTitle} onChangeText={setEditTitle} placeholder="כותרת" />
        {selectedNote ? (
          <NoteEditor
            key={`edit-${editorKey}`}
            initialHtml={editHtml}
            onChange={(h) => {
              setEditHtml(h);
              setEditBody(htmlToPlain(h));
            }}
          />
        ) : null}
        <Text style={styles.hintText}>צבע הפתק</Text>
        <NoteColorPicker value={editColor} onChange={setEditColor} />
        <ReminderEditor value={editReminder} onChange={setEditReminder} />
        {selectedNote ? (
          <TouchableOpacity
            style={[styles.doneBtn, selectedNote.done && styles.doneBtnOn]}
            onPress={() => {
              toggleDone(selectedNote);
              setSelectedNote(null);
            }}
          >
            <Text style={styles.doneBtnText}>{selectedNote.done ? '↩ החזר למטלות פתוחות' : '✓ סמן כבוצע'}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.greenBtn} onPress={saveNote}>
            <Text style={styles.whiteBtnText}>שמור</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.blueBtnFlex} onPress={() => selectedNote && shareNote(selectedNote)}>
            <Text style={styles.softBtnText}>שתף</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.redBtn} onPress={() => selectedNote && deleteNote(selectedNote)}>
            <Text style={styles.dangerBtnText}>מחק</Text>
          </TouchableOpacity>
        </View>
        {selectedNote ? (
          <TouchableOpacity style={styles.toTaskBtn} onPress={() => noteToTask(selectedNote)}>
            <Text style={styles.linkText}>✅ הפוך למשימה</Text>
          </TouchableOpacity>
        ) : null}
      </PopupShell>

      {/* ---------- popup: area details ---------- */}
      <PopupShell
        visible={!!areaForm}
        title={areaForm?.id ? 'עריכת אזור' : 'אזור חדש'}
        onClose={() => setAreaForm(null)}
        yellow={false}
      >
        {areaForm ? (
          <>
            <Text style={styles.label}>שם האזור *</Text>
            <TextInput placeholderTextColor={c.muted}
              style={styles.input}
              placeholder='למשל "בית", "עבודה", "סופר"'
              value={areaForm.label}
              onChangeText={(t) => setAreaForm({ ...areaForm, label: t })}
            />
            <Text style={styles.label}>מתי לצלצל?</Text>
            <View style={styles.row}>
              {(
                [
                  ['every', 'בכל כניסה'],
                  ['once', 'פעם אחת'],
                ] as [AreaMode, string][]
              ).map(([m, label]) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.segment, areaForm.mode === m && styles.segmentOn]}
                  onPress={() => setAreaForm({ ...areaForm, mode: m })}
                >
                  <Text style={[styles.segmentText, areaForm.mode === m && styles.segmentTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hintText}>
              {areaForm.mode === 'every'
                ? 'יצלצל בכל כניסה לאזור (לכל היותר פעם ב-8 דקות).'
                : 'יצלצל בכניסה הבאה, ואז האזור ייכבה. אפשר להדליק אותו שוב במתג.'}
            </Text>
            <View style={styles.preciseRow}>
              <View style={styles.flex1}>
                <Text style={styles.preciseTitle}>🎯 מצב מדויק</Text>
                <Text style={styles.hintText}>
                  {areaForm.precise
                    ? 'יצלצל כמעט מיד בכניסה. כשתתקרב (כ-4 ק"מ) יופעל מעקב צמוד עם ההתראה "📍 מעקב אזורים פעיל", והוא נכבה כשתגיע.'
                    : 'כבוי: חוסך סוללה, אבל הצלצול יכול להתעכב כמה דקות.'}
                </Text>
              </View>
              <Switch value={areaForm.precise} onValueChange={(v) => setAreaForm({ ...areaForm, precise: v })} />
            </View>
            <Text style={styles.label}>הערה (לא חובה)</Text>
            <TextInput placeholderTextColor={c.muted}
              style={styles.input}
              placeholder='למשל "לקנות לחם"'
              value={areaForm.note}
              onChangeText={(t) => setAreaForm({ ...areaForm, note: t })}
            />
            <View style={styles.areaSummary}>
              <Text style={styles.itemSub}>
                רדיוס {formatRadius(areaForm.sel.radius)} · {areaForm.sel.lat.toFixed(4)}, {areaForm.sel.lon.toFixed(4)}
              </Text>
              <TouchableOpacity onPress={changeAreaLocation}>
                <Text style={styles.linkText}>🗺️ שנה מיקום במפה</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.greenBtn} onPress={saveAreaForm}>
                <Text style={styles.whiteBtnText}>שמור אזור</Text>
              </TouchableOpacity>
              {areaForm.id ? (
                <TouchableOpacity
                  style={styles.redBtn}
                  onPress={() => {
                    const a = areas.find((x) => x.id === areaForm.id);
                    if (a) deleteArea(a);
                  }}
                >
                  <Text style={styles.dangerBtnText}>מחק</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}
      </PopupShell>

      {/* ---------- popup: alarm clock ---------- */}
      <PopupShell
        visible={!!alarmForm}
        title={alarmFormIsNew ? 'שעון מעורר חדש' : 'עריכת שעון מעורר'}
        onClose={() => setAlarmForm(null)}
        yellow={false}
      >
        {alarmForm ? (
          <>
            <TouchableOpacity style={styles.bigTimeBtn} onPress={pickAlarmTime}>
              <Text style={styles.bigTimeText}>{hhmm(alarmForm.hour, alarmForm.minute)}</Text>
              <Text style={styles.itemSub}>לחץ לשינוי השעה</Text>
            </TouchableOpacity>

            <Text style={styles.label}>ימים (בלי בחירה = פעם אחת)</Text>
            <View style={styles.daysRow}>
              {DAY_LETTERS.map((letter, d) => {
                const on = alarmForm.days.includes(d);
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dayChip, on && styles.dayChipOn]}
                    onPress={() =>
                      setAlarmForm({
                        ...alarmForm,
                        days: on ? alarmForm.days.filter((x) => x !== d) : [...alarmForm.days, d].sort(),
                      })
                    }
                  >
                    <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{letter}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>שם (לא חובה)</Text>
            <TextInput placeholderTextColor={c.muted}
              style={styles.input}
              placeholder='למשל "עבודה"'
              value={alarmForm.label}
              onChangeText={(t) => setAlarmForm({ ...alarmForm, label: t })}
            />

            <View style={styles.switchRowPlain}>
              <Text style={styles.label}>נודניק</Text>
              <Switch
                trackColor={{ false: c.dark ? "#3A3A3C" : "#D1D1D6", true: c.accent }}
                thumbColor="#FFFFFF"
                value={alarmForm.snoozeEnabled}
                onValueChange={(v) => setAlarmForm({ ...alarmForm, snoozeEnabled: v })}
              />
            </View>
            {alarmForm.snoozeEnabled ? (
              <>
                <Text style={styles.hintText}>כמה זמן כל נודניק:</Text>
                <View style={styles.chipsWrapRow}>
                  {[5, 10, 15, 20].map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.chip, styles.chipSpaced, alarmForm.snoozeMin === m && styles.chipActive]}
                      onPress={() => setAlarmForm({ ...alarmForm, snoozeMin: m })}
                    >
                      <Text style={[styles.chipText, alarmForm.snoozeMin === m && styles.chipTextActive]}>{m} דק'</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hintText}>כמה פעמים:</Text>
                <View style={styles.chipsWrapRow}>
                  {[1, 2, 3, 5, -1].map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, styles.chipSpaced, alarmForm.snoozeCount === c && styles.chipActive]}
                      onPress={() => setAlarmForm({ ...alarmForm, snoozeCount: c })}
                    >
                      <Text style={[styles.chipText, alarmForm.snoozeCount === c && styles.chipTextActive]}>
                        {c < 0 ? 'בלי הגבלה' : `${c}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hintText}>
                  {alarmForm.snoozeCount < 0
                    ? 'הנודניק יחזור עד שתלחץ "עצור".'
                    : `אחרי ${alarmForm.snoozeCount} נודניקים השעון מפסיק ולא חוזר.`}
                </Text>
              </>
            ) : null}
            <Text style={styles.hintText}>אם לא לוחצים כלום, השעון נעצר אחרי 10 דקות.</Text>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.greenBtn} onPress={saveAlarmForm}>
                <Text style={styles.whiteBtnText}>שמור</Text>
              </TouchableOpacity>
              {!alarmFormIsNew ? (
                <TouchableOpacity style={styles.redBtn} onPress={() => deleteAlarm(alarmForm)}>
                  <Text style={styles.dangerBtnText}>מחק</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}
      </PopupShell>

      <MapPicker
        visible={mapVisible}
        initial={mapInitial}
        fallbackCenter={mapFallback}
        onClose={onMapClosed}
        onSave={onMapSaved}
      />

      <PopupShell visible={geoLog !== null} title="📋 יומן מיקום" onClose={() => setGeoLog(null)} yellow={false}>
        <Text style={styles.itemSub}>
          כאן רואים מתי הטלפון זיהה כניסה או יציאה מאזור, והאם צלצל. 50 האירועים האחרונים, החדש למעלה.
        </Text>
        {geoLog && geoLog.length === 0 ? (
          <Text style={styles.emptyText}>עדיין אין אירועים.</Text>
        ) : null}
        {(geoLog ?? []).map((e, i) => {
          const d = new Date(e.at);
          const when = `${d.getDate()}/${d.getMonth() + 1} ${hhmm(d.getHours(), d.getMinutes())}`;
          const icon =
            e.kind === 'problem' ? '⚠️' : e.kind === 'start' ? '▶️' : e.kind === 'exit' ? '⬅️' : e.ok ? '🔔' : '🔕';
          return (
            <View key={i} style={styles.geoLogRow}>
              <Text style={styles.geoLogTime}>{when}</Text>
              <Text style={styles.geoLogText}>
                {icon} <Text style={styles.geoLogLabel}>{e.label}</Text> · {e.text}
              </Text>
            </View>
          );
        })}
        {geoLog && geoLog.length > 0 ? (
          <TouchableOpacity
            style={[styles.grayBtn, styles.geoLogBtn]}
            onPress={() =>
              confirm('ניקוי היומן', 'למחוק את כל האירועים ביומן?', 'נקה', async () => {
                await clearGeoLog();
                setGeoLog([]);
              })
            }
          >
            <Text style={styles.grayBtnText}>🗑️ נקה יומן</Text>
          </TouchableOpacity>
        ) : null}
      </PopupShell>

      <RingtonesScreen visible={ringtonesVisible} onClose={() => setRingtonesVisible(false)} />

      <SetupScreen
        visible={setupVisible}
        onClose={() => {
          setSetupVisible(false);
          refreshPermissions();
          syncGeofences(areas);
        }}
        onExport={doExport}
        onImport={doImport}
        themeMode={themeMode}
        onThemeMode={setThemeMode}
        accent={accent}
        onAccent={setAccent}
      />
    </SafeAreaView>
  );
}
