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
import { GeoAlarm, SharedFile } from './modules/geo-alarm';
import MapPicker, { MapSelection } from './src/MapPicker';
import GeoLogMap from './src/GeoLogMap';
import RingtonesScreen from './src/RingtonesScreen';
import { DocChips } from './src/docLinks';
import { scanAndSave, useSaveDocs } from './src/SaveDocs';
import { refreshMorning } from './src/morning';
import SetupScreen, { allAlarmPermissionsOk } from './src/SetupScreen';
import WorkoutsTab, { SharedLink, extractUrl } from './src/WorkoutsTab';
import TasksTab, { countDueToday } from './src/TasksTab';
import { AlarmWhen, NextAlarmLine } from './src/AlarmBits';
import SearchScreen from './src/SearchScreen';
import { openDoc } from './src/docLinks';
import { Pane, WhenOpen, markTabPress } from './src/perf';
import DocsTab from './src/DocsTab';
import { syncGeofences, MIN_RADIUS_M, quietSetup } from './src/geoTask';
import {
  AutoBackupConfig,
  BackupData,
  chooseAutoBackupFolder,
  disableAutoBackup,
  exportBackup,
  loadAutoBackup,
  pickBackup,
  readAutoBackup,
  runAutoBackup,
  buildPayload,
  parseBackup,
} from './src/backup';
import {
  DriveBackupConfig,
  connectDrive,
  disconnectDrive,
  downloadDriveBackup,
  loadDriveBackup,
  runDriveBackup,
  saveDriveBackup,
} from './src/driveBackup';
import { resetDocFilesIndex, syncDocFiles } from './src/driveFiles';
import { purgeTrash } from './src/trash';

/** Everything that goes into a backup, read from storage (safe to call from any listener). */
async function gatherBackup(): Promise<BackupData> {
  return {
    notes: (await loadBoard())?.notes ?? [],
    categories: [],
    groups: (await loadGroups()) ?? [],
    tasks: await loadTasks(),
    areas: await loadAreas(),
    alarms: await loadAlarmClocks(),
    docFolders: await loadDocFolders(),
    docMeta: await loadDocMeta(),
    personalHidden: await loadPersonalHidden(),
    sounds: await loadSounds(),
    themeMode: await loadThemeMode(),
    accent: await loadAccent(),
    bg: await loadBg(),
    journals: await loadJournals(),
    taskLists: await loadTaskLists(),
    taskTemplates: await loadTaskTemplates(),
  };
}
import { useAppStyles } from './src/appStyles';
import { ThemeContext, ThemeMode, paletteFor, useTheme } from './src/theme';
import StopwatchCard from './src/Stopwatch';
import { RichText, htmlToPlain, noteBg, plainToHtml } from './src/richNote';
import NoteScreen from './src/NoteScreen';
import { canLock, ensureUnlocked, relock } from './src/lock';
import { installCrashLog, showLastCrash } from './src/crashLog';

installCrashLog();
import { PopupShell, ReminderEditor, ReminderValue, confirm, emptyReminder } from './src/ui';
import { DAY_LETTERS, daysSummary, displayYMD, endOfDay, hhmm, parseHHMM, parseYMD, pickDate, pickTimeWheels } from './src/pickers';
import {
  TIMER_RING_ID,
  alarmRingId,
  alarmNextAt,
  alarmPlainNext,
  cancelRing,
  nextAlarmTime,
  noteRingId,
  ringDayText,
  weekSunday,
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
  loadPersonalHidden,
  savePersonalHidden,
  loadGroups,
  loadSounds,
  loadTasks,
  loadThemeMode,
  loadBg,
  saveBg,
  loadAccent,
  saveAccent,
  loadJournals,
  saveJournals,
  loadTaskLists,
  saveTaskLists,
  loadTaskTemplates,
  saveTaskTemplates,
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
  type DocLink,
} from './src/storage';

type MainTab = 'notes' | 'tasks' | 'workouts' | 'alarms' | 'docs';

const TABS: [MainTab, string, string][] = [
  ['tasks', 'check-square', 'משימות'],
  ['notes', 'file-text', 'פתקים'],
  ['workouts', 'dumbbell', 'כושר'],
  ['alarms', 'clock', 'שעונים'],
  ['docs', 'folder', 'מסמכים'],
];

/** The tab bar lights up the pressed tab at once; the page itself follows right after. */
function TabBar({ active, onSelect, tasksBadge }: { active: MainTab; onSelect: (t: MainTab) => void; tasksBadge: number }) {
  const styles = useAppStyles();
  const c = useTheme();
  const [sel, setSel] = useState<MainTab>(active);
  useEffect(() => setSel(active), [active]);
  const press = (key: MainTab) => {
    if (key === active) return;
    setSel(key);
    markTabPress(key);
    // let the phone draw the lit tab first, then build/show the page
    requestAnimationFrame(() => setTimeout(() => onSelect(key), 0));
  };
  return (
    <View style={styles.tabBar}>
      {TABS.map(([key, icon, label]) => (
        <TouchableOpacity key={key} style={[styles.tabBtn, sel === key && styles.tabBtnActive]} onPress={() => press(key)}>
          <View>
            <TabIcon name={icon} color={sel === key ? c.onAccent : c.muted} />
            {key === 'tasks' && tasksBadge > 0 ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{tasksBadge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.tabText, sel === key && styles.tabTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

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
  useEffect(() => {
    setTimeout(showLastCrash, 1500);
    // Only task reminders and alarms notify; no tracking icon or number on the app icon (1.10.3).
    quietSetup().catch(() => {});
    Notifications.setBadgeCountAsync(0).catch(() => {});
  }, []);
  const setAccent = (k: string) => {
    setAccentState(k);
    saveAccent(k);
  };
  const [bg, setBgState] = useState('default');
  useEffect(() => {
    loadBg().then(setBgState);
  }, []);
  const setBg = (k: string) => {
    setBgState(k);
    saveBg(k);
  };
  const modeDark = themeMode === 'dark' || (themeMode === 'auto' && system === 'dark');
  const palette = paletteFor(modeDark, accent, bg);
  const dark = palette.dark; // a custom background decides light/dark by itself
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeContext.Provider value={palette}>
        <AppInner
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          dark={dark}
          accent={accent}
          setAccent={setAccent}
          bg={bg}
          setBg={setBg}
        />
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
  bg,
  setBg,
}: {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  dark: boolean;
  accent: string;
  setAccent: (k: string) => void;
  bg: string;
  setBg: (k: string) => void;
}) {
  const styles = useAppStyles();
  const c = useTheme();
  const [activeTab, setActiveTab] = useState<MainTab>('tasks');
  const [searchVisible, setSearchVisible] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [tasksBadge, setTasksBadge] = useState(0);
  const [shared, setShared] = useState<SharedLink | null>(null);
  const [incomingFiles, setIncomingFiles] = useState<SharedFile[] | null>(null);
  const noteSaver = useSaveDocs();
  const [loaded, setLoaded] = useState(false);
  const [setupVisible, setSetupVisible] = useState(false);
  const [permissionsOk, setPermissionsOk] = useState(true);
  const [bgLocationOk, setBgLocationOk] = useState(true);
  const [geoLog, setGeoLog] = useState<GeoLogEntry[] | null>(null);
  const [logMapVisible, setLogMapVisible] = useState(false);
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
    const rang = (a: AlarmClock) =>
      a.enabled && a.days.length === 0 && !ids.has(alarmRingId(a.id)) && !ids.has(`${alarmRingId(a.id)}:snooze`);
    // Quick nap alarms are removed once they rang.
    const kept = list.filter((a) => !(a.nap && (rang(a) || !a.enabled)));
    if (kept.length !== list.length) changed = true;
    const next = kept.map((a) => {
      let b = a;
      if (rang(b)) b = { ...b, enabled: false };
      // A skipped ring that already passed is forgotten.
      if (b.skipNext && b.skipNext < Date.now()) b = { ...b, skipNext: undefined };
      if (b !== a) changed = true;
      return b;
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
      if (s === 'background') {
        relock();
        // Daily automatic backup (only when a folder was chosen; at most once a day).
        runAutoBackup(gatherBackup).then(setAutoBackup).catch(() => {});
        runDriveBackup(async () => buildPayload(await gatherBackup()))
          .then(setDriveBackup)
          .then(() => syncDocFiles())
          .then(setDriveBackup)
          .catch(() => {});
      }
      if (s === 'active') {
        setAreas(await loadAreas());
        setAlarms(await reconcileAlarms(await loadAlarmClocks()));
        setTasksBadge(countDueToday(await loadTasks()));
        refreshPermissions();
        refreshMorning();
        purgeTrash().catch(() => {});
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

  // ---------- files shared into the app (WhatsApp, mail, gallery…) → documents tab ----------

  useEffect(() => {
    const take = (files: SharedFile[]) => {
      if (!files.length) return;
      setActiveTab('docs');
      setIncomingFiles(files);
    };
    GeoAlarm.getInitialSharedFiles().then(take);
    const sub = GeoAlarm.addSharedFilesListener(take);
    return () => sub.remove();
  }, []);

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

  const openNote = async (note: StickyNote) => {
    if (note.locked && !(await ensureUnlocked('פתיחת פתק נעול'))) return;
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
  // Tabs visited so far – they stay mounted (hidden) so switching back is instant.
  const visitedRef = useRef(new Set<MainTab>());
  visitedRef.current.add(activeTab);
  const visited = visitedRef.current;
  // Stable props, so the hidden tabs don't re-draw on every change here (e.g. the timer ticking).
  const onOpenedTask = useCallback(() => setOpenTaskId(null), []);
  const onIncomingDone = useCallback(() => setIncomingFiles(null), []);
  const onAttachToNote = useCallback(
    (noteId: string, link: DocLink) =>
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, docs: [...(n.docs ?? []).filter((d) => d.uri !== link.uri), link] } : n
        )
      ),
    []
  );
  const notesKey = notes.map((n) => n.id + '\u0001' + n.title).join('\u0002');
  const docNotes = useMemo(() => notes.map((n) => ({ id: n.id, title: n.title })), [notesKey]);

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

  const sortAlarms = (list: AlarmClock[]) =>
    [...list].sort((x, y) => x.hour * 60 + x.minute - (y.hour * 60 + y.minute));

  /** Cleans fields that don't fit the alarm's kind (one-time / repeating). */
  const normalizeAlarm = (f: AlarmClock): AlarmClock => {
    let a: AlarmClock = { ...f, enabled: true };
    if (a.days.length) {
      a.date = undefined;
      if (a.everyOtherWeek && !a.weekAnchor) a.weekAnchor = weekSunday(Date.now());
    } else {
      a = { ...a, everyOtherWeek: false, skipHolidays: false, skipNext: undefined };
    }
    // A skip chosen for another time/day (the alarm was changed) no longer applies.
    if (a.skipNext && a.skipNext !== alarmPlainNext({ ...a, skipNext: undefined })) a.skipNext = undefined;
    return a;
  };

  const saveAlarmForm = async () => {
    if (!alarmForm) return;
    const a = normalizeAlarm(alarmForm);
    const at = await scheduleAlarmClock(a);
    if (!at) {
      Alert.alert('השעה כבר עברה', 'התאריך והשעה שבחרת כבר עברו. בחר מועד עתידי.');
      return;
    }
    const next = sortAlarms(alarmFormIsNew ? [...alarms, a] : alarms.map((x) => (x.id === a.id ? a : x)));
    await persistAlarms(next);
    setAlarmForm(null);
    Alert.alert('השעון נקבע', `השעון יצלצל ${ringDayText(at)}, ${untilText(at)}.`);
  };

  const toggleAlarm = async (a: AlarmClock) => {
    const updated = { ...a, enabled: !a.enabled };
    if (updated.enabled && !(await scheduleAlarmClock(updated))) {
      Alert.alert('השעה כבר עברה', 'התאריך של השעון הזה עבר. פתח אותו ובחר תאריך חדש.');
      return;
    }
    if (!updated.enabled) await scheduleAlarmClock(updated);
    await persistAlarms(alarms.map((x) => (x.id === a.id ? updated : x)));
  };

  /** Skip only the next ring of a repeating alarm (or undo the skip). Takes effect at once. */
  const toggleSkipNext = async (a: AlarmClock) => {
    const skipping = !!a.skipNext && a.skipNext > Date.now();
    const updated: AlarmClock = { ...a, enabled: true, skipNext: skipping ? undefined : alarmPlainNext({ ...a, skipNext: undefined }) };
    const at = await scheduleAlarmClock(updated);
    await persistAlarms(alarms.map((x) => (x.id === a.id ? updated : x)));
    setAlarmForm(null);
    Alert.alert(skipping ? 'הדילוג בוטל' : 'מדלג פעם אחת', `השעון יצלצל ${ringDayText(at)}, ${untilText(at)}.`);
  };

  const duplicateAlarm = (a: AlarmClock) => {
    setAlarmForm({ ...a, id: newId(), skipNext: undefined, nap: undefined, label: a.label ? `${a.label} (עותק)` : '' });
    setAlarmFormIsNew(true);
  };

  /** Quick nap: a one-time alarm in N minutes; replaces an earlier nap and is removed after it rings. */
  const startNap = async (minutes: number) => {
    const t = new Date(Date.now() + minutes * 60_000);
    const a: AlarmClock = {
      id: newId(),
      label: `נמנום ${minutes} דק'`,
      hour: t.getHours(),
      minute: t.getMinutes(),
      days: [],
      date: localDateString(t),
      enabled: true,
      snoozeEnabled: true,
      snoozeMin: 5,
      snoozeCount: 3,
      nap: true,
    };
    for (const old of alarms.filter((x) => x.nap)) cancelRing(alarmRingId(old.id));
    const at = await scheduleAlarmClock(a);
    await persistAlarms(sortAlarms([...alarms.filter((x) => !x.nap), a]));
    Alert.alert('😴 נמנום', `השעון יצלצל ב-${hhmm(a.hour, a.minute)}, ${untilText(at)}.`);
  };

  const pickChallenge = (ch: 'none' | 'math' | 'shake') => {
    if (!alarmForm) return;
    if (ch === 'none') {
      setAlarmForm({ ...alarmForm, challenge: 'none' });
      return;
    }
    const what = ch === 'math' ? 'לפתור תרגיל חשבון קצר (חיבור)' : 'לנער את הטלפון חזק 15 פעמים';
    confirm(
      ch === 'math' ? 'תרגיל חשבון לכיבוי' : 'ניעור לכיבוי',
      `כדי לעצור את השעון יהיה צריך ${what}. אי אפשר יהיה לעצור אותו מההתראה, רק מהמסך שלו.\nהנודניק נשאר זמין כרגיל. אם לא עושים כלום, השעון נעצר לבד אחרי 10 דקות.`,
      'הפעל',
      () => setAlarmForm((f) => (f ? { ...f, challenge: ch } : f))
    );
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
      await exportBackup(await gatherBackup());
    } catch {
      Alert.alert('הגיבוי נכשל', 'לא הצלחתי ליצור את קובץ הגיבוי.');
    }
  };

  // ---------- automatic backup ----------
  const [autoBackup, setAutoBackup] = useState<AutoBackupConfig>({ folderUri: null });
  useEffect(() => {
    loadAutoBackup().then(setAutoBackup);
  }, []);
  const chooseBackupFolder = async () => {
    const cfg = await chooseAutoBackupFolder();
    if (!cfg) return;
    const done = await runAutoBackup(gatherBackup, true);
    setAutoBackup(done);
    if (done.lastError) Alert.alert('גיבוי אוטומטי', done.lastError);
    else Alert.alert('גיבוי אוטומטי פעיל ✓', `נוצר גיבוי ראשון בתיקייה "${done.folderName}". מעכשיו יישמר גיבוי פעם ביום (7 האחרונים נשמרים).`);
  };
  const backupNow = async () => {
    const done = await runAutoBackup(gatherBackup, true);
    setAutoBackup(done);
    Alert.alert('גיבוי', done.lastError ?? 'הגיבוי נשמר ✓');
  };
  const stopAutoBackup = () =>
    confirm('גיבוי אוטומטי', 'לכבות את הגיבוי האוטומטי? הקבצים שכבר נשמרו נשארים בתיקייה.', 'כבה', async () => {
      await disableAutoBackup();
      setAutoBackup({ folderUri: null });
    });
  // ---------- Google Drive backup ----------
  const [driveBackup, setDriveBackup] = useState<DriveBackupConfig>({ enabled: false });
  useEffect(() => {
    loadDriveBackup().then(setDriveBackup);
  }, []);
  const drivePayload = async () => buildPayload(await gatherBackup());
  const connectGoogleDrive = async () => {
    try {
      await connectDrive();
    } catch (e: any) {
      Alert.alert('גוגל דרייב', e?.message ?? 'ההתחברות נכשלה.');
      return;
    }
    const done = await runDriveBackup(drivePayload, true);
    setDriveBackup(done);
    if (done.lastError) Alert.alert('גוגל דרייב', done.lastError);
    else {
      Alert.alert(
        'גיבוי לגוגל דרייב פעיל ✓',
        'נוצר גיבוי ראשון בתיקייה "גיבוי יומן ושולחן עבודה" בדרייב שלך. מעכשיו יישמר גיבוי פעם ביום.\n\nגם קבצי המסמכים עולים עכשיו לדרייב (בפעם הראשונה זה יכול לקחת זמן). אפשר לראות את ההתקדמות בהגדרות.'
      );
      syncFilesNow(false);
    }
  };
  const [driveFilesProgress, setDriveFilesProgress] = useState<{ done: number; total: number } | null>(null);
  const syncFilesNow = async (report: boolean) => {
    setDriveFilesProgress({ done: 0, total: 0 });
    const done = await syncDocFiles(true, setDriveFilesProgress).catch(() => null);
    setDriveFilesProgress(null);
    if (!done) return;
    setDriveBackup(done);
    if (report && done.filesError) Alert.alert('גיבוי קבצי המסמכים', done.filesError);
  };
  const driveBackupNow = async () => {
    const done = await runDriveBackup(drivePayload, true);
    setDriveBackup(done);
    Alert.alert('גוגל דרייב', done.lastError ?? 'הגיבוי נשמר בדרייב ✓' + (done.files !== false ? '\nקבצי המסמכים מתעדכנים עכשיו ברקע.' : ''));
    if (!done.lastError) syncFilesNow(true);
  };
  const setDriveOption = async (patch: { files?: boolean; wifiOnly?: boolean }) => {
    const next = { ...(await loadDriveBackup()), ...patch, filesError: undefined };
    await saveDriveBackup(next);
    setDriveBackup(next);
    if (patch.files || patch.wifiOnly === false) syncFilesNow(false);
  };
  const disconnectGoogleDrive = () =>
    confirm('גוגל דרייב', 'להפסיק לגבות לגוגל דרייב? הגיבויים שכבר נשמרו נשארים בדרייב.', 'הפסק', async () => {
      await disconnectDrive();
      await resetDocFilesIndex();
      setDriveBackup({ enabled: false });
    });
  const restoreFromDrive = async (id: string) => {
    try {
      const data = parseBackup(await downloadDriveBackup(id));
      if (data) restoreData(data);
    } catch (e: any) {
      Alert.alert('שחזור', e?.message ?? 'ההורדה מגוגל דרייב נכשלה.');
    }
  };

  const restoreFromAuto = async (uri: string) => {
    const data = await readAutoBackup(uri);
    if (data) restoreData(data);
  };

  const doImport = async () => {
    const data = await pickBackup();
    if (data) restoreData(data);
  };

  const restoreData = (data: BackupData) => {
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
        if (data.personalHidden) await savePersonalHidden(data.personalHidden);
        await saveSounds(data.sounds);
        if (data.themeMode) setThemeMode(data.themeMode as ThemeMode);
        if (data.accent) setAccent(data.accent);
        if (data.bg) setBg(data.bg);
        if (data.journals) await saveJournals(data.journals);
        if (data.taskLists) await saveTaskLists(data.taskLists);
        if (data.taskTemplates) await saveTaskTemplates(data.taskTemplates);
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
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setSearchVisible(true)}
            hitSlop={10}
            style={styles.gearBtn}
            accessibilityLabel="חיפוש"
          >
            <Feather name="search" size={20} color={c.text} />
          </TouchableOpacity>
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
      </View>
      <WhenOpen open={searchVisible}>
      <SearchScreen
        visible={searchVisible}
        notes={notes}
        onClose={() => setSearchVisible(false)}
        targets={{
          onTask: (t) => {
            setSearchVisible(false);
            setActiveTab('tasks');
            setOpenTaskId(t.id);
          },
          onNote: (n) => {
            setSearchVisible(false);
            setActiveTab('notes');
            openNote(n);
          },
          onDoc: (d) => openDoc({ uri: d.uri, name: d.name, mime: d.mime }),
          onAlarm: (a) => {
            setSearchVisible(false);
            setActiveTab('alarms');
            setAlarmForm(a);
            setAlarmFormIsNew(false);
          },
          onArea: () => {
            setSearchVisible(false);
            setActiveTab('alarms');
          },
        }}
      />
      </WhenOpen>

      <TabBar active={activeTab} onSelect={setActiveTab} tasksBadge={tasksBadge} />

      {/* A tab is built on its first visit and then stays ready in the background (hidden), so switching back is instant. */}
      {visited.has('tasks') ? (
        <Pane name="tasks" active={activeTab === 'tasks'}>
          <TasksTab
            dataVersion={dataVersion}
            onCountChange={setTasksBadge}
            onConvertToNote={taskToNote}
            openTaskId={openTaskId}
            onOpenedTask={onOpenedTask}
            active={activeTab === 'tasks'}
          />
        </Pane>
      ) : null}
      {visited.has('workouts') ? (
        <Pane name="workouts" active={activeTab === 'workouts'}>
          <WorkoutsTab
            dataVersion={dataVersion}
            shared={shared}
            onSharedUsed={onSharedUsed}
            active={activeTab === 'workouts'}
          />
        </Pane>
      ) : null}
      {visited.has('docs') ? (
        <Pane name="docs" active={activeTab === 'docs'}>
          <DocsTab
            dataVersion={dataVersion}
            notes={docNotes}
            incoming={incomingFiles}
            onIncomingDone={onIncomingDone}
            onAttachToNote={onAttachToNote}
            active={activeTab === 'docs'}
          />
        </Pane>
      ) : null}

      {visited.has('notes') ? (
      <Pane name="notes" active={activeTab === 'notes'}>
      <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent} keyboardShouldPersistTaps="handled">
        {/* ---------- notes ---------- */}
        {(
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
                  {note.locked ? (
                    <Text style={[styles.noteBody, styles.mutedText]}>🔒 פתק נעול</Text>
                  ) : note.html ? (
                    <RichText html={note.html} style={[styles.noteBody, note.done ? styles.mutedText : {}]} numberOfLines={6} />
                  ) : (
                    <Text style={[styles.noteBody, note.done && styles.mutedText]} numberOfLines={4}>
                      {note.body}
                    </Text>
                  )}
                  {reminderTag(note) ? <Text style={styles.scheduleTag}>{reminderTag(note)}</Text> : null}
                  <DocChips
                    docs={note.locked ? undefined : note.docs}
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
      </ScrollView>
      </Pane>
      ) : null}

      {visited.has('alarms') ? (
      <Pane name="alarms" active={activeTab === 'alarms'}>
      <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent} keyboardShouldPersistTaps="handled">
        {(
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
              <NextAlarmLine alarms={alarms} />
              <View style={styles.chipsWrapRow}>
                <Text style={[styles.itemSub, { alignSelf: 'center', marginEnd: 8 }]}>😴 נמנום:</Text>
                {[20, 30, 45, 60].map((m) => (
                  <TouchableOpacity key={m} style={[styles.chip, styles.chipSpaced]} onPress={() => startNap(m)}>
                    <Text style={styles.chipText}>{m} דק'</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {alarms.length === 0 ? <Text style={styles.emptyText}>עדיין אין שעונים מעוררים.</Text> : null}
              {(showAllAlarms ? alarms : alarms.slice(0, LIST_PREVIEW)).map((a) => (
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
                      {a.days.length === 0 && a.date ? displayYMD(a.date) : daysSummary(a.days)}
                      {a.days.length && a.everyOtherWeek ? ' · כל שבועיים' : ''}
                      {a.snoozeEnabled
                        ? ` · נודניק ${a.snoozeMin} דק' ${a.snoozeCount < 0 ? '(ללא הגבלה)' : `×${a.snoozeCount}`}`
                        : ' · בלי נודניק'}
                      {a.days.length && a.skipHolidays ? ' · 🕎 בלי חגים' : ''}
                      {a.challenge === 'math' ? ' · 🧮' : a.challenge === 'shake' ? ' · 📳' : ''}
                      {a.speak ? ' · 🔊' : ''}
                    </Text>
                    <AlarmWhen a={a} />
                  </TouchableOpacity>
                  <Switch
                trackColor={{ false: c.switchOff, true: c.accent }}
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
                trackColor={{ false: c.switchOff, true: c.accent }}
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
      </Pane>
      ) : null}

      {/* ---------- note screens (full screen) ---------- */}
      <WhenOpen open={createVisible}>
      <NoteScreen
        visible={createVisible}
        isNew
        editorKey={`new-${editorKey}`}
        title={newTitle}
        onTitle={setNewTitle}
        initialHtml=""
        onHtml={(h) => {
          setNewHtml(h);
          setNewBody(htmlToPlain(h));
        }}
        color={newColor}
        onColor={setNewColor}
        reminder={newReminder}
        onReminder={setNewReminder}
        onSave={createNote}
        onClose={closeCreate}
      />
      </WhenOpen>

      <WhenOpen open={!!selectedNote}>
      <NoteScreen
        visible={!!selectedNote}
        isNew={false}
        editorKey={`edit-${editorKey}`}
        title={editTitle}
        onTitle={setEditTitle}
        initialHtml={editHtml}
        onHtml={(h) => {
          setEditHtml(h);
          setEditBody(htmlToPlain(h));
        }}
        color={editColor}
        onColor={setEditColor}
        reminder={editReminder}
        onReminder={setEditReminder}
        onSave={saveNote}
        onClose={closeEdit}
        onShare={() => selectedNote && shareNote(selectedNote)}
        extra={
          selectedNote ? (
            <>
              <DocChips
                docs={selectedNote.locked ? undefined : notes.find((n) => n.id === selectedNote.id)?.docs}
                onRemove={(d) =>
                  setNotes((prev) =>
                    prev.map((n) => (n.id === selectedNote.id ? { ...n, docs: (n.docs ?? []).filter((x) => x.uri !== d.uri) } : n))
                  )
                }
              />
              <TouchableOpacity
                style={styles.doneBtn}
                onPress={async () => {
                  const id = selectedNote.id;
                  const r = await scanAndSave(noteSaver);
                  const d = r ? { uri: r.uri, name: r.name, mime: r.mime } : null;
                  if (d)
                    setNotes((prev) =>
                      prev.map((n) => (n.id === id ? { ...n, docs: [...(n.docs ?? []).filter((x) => x.uri !== d.uri), d] } : n))
                    );
                }}
              >
                <Text style={styles.doneBtnText}>📄 סרוק מסמך וצרף לפתק</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.doneBtn}
                onPress={async () => {
                  const n = selectedNote;
                  if (n.locked) {
                    if (!(await ensureUnlocked('ביטול נעילת פתק'))) return;
                  } else if (!(await canLock())) return;
                  const next = { ...n, locked: !n.locked };
                  setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, locked: next.locked } : x)));
                  setSelectedNote(next);
                }}
              >
                <Text style={styles.doneBtnText}>{selectedNote.locked ? '🔓 בטל נעילה' : '🔒 נעל פתק (טביעת אצבע)'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.doneBtn, selectedNote.done && styles.doneBtnOn]}
                onPress={() => {
                  toggleDone(selectedNote);
                  setSelectedNote(null);
                }}
              >
                <Text style={styles.doneBtnText}>{selectedNote.done ? '↩ החזר למטלות פתוחות' : '✓ סמן כבוצע'}</Text>
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.blueBtnFlex} onPress={() => noteToTask(selectedNote)}>
                  <Text style={styles.softBtnText}>✅ הפוך למשימה</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.redBtn} onPress={() => deleteNote(selectedNote)}>
                  <Text style={styles.dangerBtnText}>🗑️ מחק</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null
        }
      />
      </WhenOpen>

      {noteSaver.element}

      {/* ---------- popup: area details ---------- */}
      <WhenOpen open={!!areaForm}>
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
      </WhenOpen>

      {/* ---------- popup: alarm clock ---------- */}
      <WhenOpen open={!!alarmForm}>
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
            <View style={styles.chipsWrapRow}>
              {(
                [
                  ['כל יום', [0, 1, 2, 3, 4, 5, 6]],
                  ['ימי חול', [0, 1, 2, 3, 4]],
                  ['סוף שבוע', [5, 6]],
                  ['פעם אחת', []],
                ] as [string, number[]][]
              ).map(([name, days]) => {
                const on = alarmForm.days.join() === days.join();
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.chip, styles.chipSpaced, on && styles.chipActive]}
                    onPress={() => setAlarmForm({ ...alarmForm, days })}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {alarmForm.days.length === 0 ? (
              <>
                <View style={styles.chipsWrapRow}>
                  <TouchableOpacity
                    style={[styles.chip, styles.chipSpaced, !!alarmForm.date && styles.chipActive]}
                    onPress={() => pickDate(alarmForm.date, (d) => setAlarmForm((f) => (f ? { ...f, date: d } : f)))}
                  >
                    <Text style={[styles.chipText, !!alarmForm.date && styles.chipTextActive]}>
                      📅 {alarmForm.date ? displayYMD(alarmForm.date) : 'בחר תאריך'}
                    </Text>
                  </TouchableOpacity>
                  {alarmForm.date ? (
                    <TouchableOpacity
                      style={[styles.chip, styles.chipSpaced]}
                      onPress={() => setAlarmForm({ ...alarmForm, date: undefined })}
                    >
                      <Text style={styles.chipText}>✕ בלי תאריך</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.hintText}>
                  {alarmForm.date ? 'השעון יצלצל פעם אחת בתאריך הזה.' : 'בלי תאריך: השעון יצלצל בפעם הקרובה שהשעה מגיעה.'}
                </Text>
              </>
            ) : (
              <>
                <View style={styles.switchRowPlain}>
                  <Text style={styles.label}>כל שבועיים</Text>
                  <Switch
                    trackColor={{ false: c.switchOff, true: c.accent }}
                    thumbColor="#FFFFFF"
                    value={!!alarmForm.everyOtherWeek}
                    onValueChange={(v) =>
                      setAlarmForm({ ...alarmForm, everyOtherWeek: v, weekAnchor: v ? alarmForm.weekAnchor ?? weekSunday(Date.now()) : undefined })
                    }
                  />
                </View>
                {alarmForm.everyOtherWeek ? (
                  <View style={styles.chipsWrapRow}>
                    {([0, 1] as const).map((w) => {
                      const anchor = weekSunday(Date.now(), w);
                      const on =
                        alarmForm.weekAnchor !== undefined && (((alarmForm.weekAnchor - anchor) / 7) % 2 + 2) % 2 === 0;
                      return (
                        <TouchableOpacity
                          key={w}
                          style={[styles.chip, styles.chipSpaced, on && styles.chipActive]}
                          onPress={() => setAlarmForm({ ...alarmForm, weekAnchor: anchor })}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextActive]}>{w === 0 ? 'מהשבוע' : 'משבוע הבא'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}

                <View style={styles.switchRowPlain}>
                  <Text style={styles.label}>לא לצלצל בחגים</Text>
                  <Switch
                    trackColor={{ false: c.switchOff, true: c.accent }}
                    thumbColor="#FFFFFF"
                    value={!!alarmForm.skipHolidays}
                    onValueChange={(v) => setAlarmForm({ ...alarmForm, skipHolidays: v })}
                  />
                </View>
                {alarmForm.skipHolidays ? (
                  <Text style={styles.hintText}>
                    לפי לוח השנה העברי: ראש השנה, יום כיפור, סוכות, שמחת תורה, פסח, שביעי של פסח, שבועות ויום העצמאות.
                  </Text>
                ) : null}
              </>
            )}

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
                trackColor={{ false: c.switchOff, true: c.accent }}
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
            <Text style={styles.label}>איך עוצרים</Text>
            <View style={styles.chipsWrapRow}>
              {(
                [
                  ['none', 'לחיצה על עצור'],
                  ['math', '🧮 תרגיל חשבון'],
                  ['shake', '📳 ניעור'],
                ] as ['none' | 'math' | 'shake', string][]
              ).map(([ch, name]) => {
                const on = (alarmForm.challenge ?? 'none') === ch;
                return (
                  <TouchableOpacity
                    key={ch}
                    style={[styles.chip, styles.chipSpaced, on && styles.chipActive]}
                    onPress={() => pickChallenge(ch)}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {alarmForm.challenge && alarmForm.challenge !== 'none' ? (
              <Text style={styles.hintText}>
                {alarmForm.challenge === 'math'
                  ? 'כדי לעצור צריך לפתור תרגיל חיבור. הנודניק זמין בלי תרגיל.'
                  : 'כדי לעצור צריך לנער את הטלפון 15 פעמים. הנודניק זמין בלי ניעור.'}
              </Text>
            ) : null}

            <View style={styles.switchRowPlain}>
              <Text style={styles.label}>🔊 הקראה אחרי העצירה</Text>
              <Switch
                trackColor={{ false: c.switchOff, true: c.accent }}
                thumbColor="#FFFFFF"
                value={!!alarmForm.speak}
                onValueChange={(v) => setAlarmForm({ ...alarmForm, speak: v })}
              />
            </View>
            {alarmForm.speak ? (
              <Text style={styles.hintText}>
                אחרי שעוצרים, הטלפון אומר את היום, השעה והמשימות של היום. צריך קול בעברית בטלפון (בדרך כלל של גוגל).
              </Text>
            ) : null}

            <Text style={styles.hintText}>אם לא לוחצים כלום, השעון נעצר אחרי 10 דקות.</Text>

            {!alarmFormIsNew && alarmForm.days.length > 0 && alarmForm.enabled ? (
              <TouchableOpacity style={[styles.grayBtn, { marginTop: 10 }]} onPress={() => toggleSkipNext(alarmForm)}>
                <Text style={styles.grayBtnText}>
                  {alarmForm.skipNext && alarmForm.skipNext > Date.now()
                    ? '↩️ בטל את הדילוג'
                    : `⏭️ דלג על הצלצול הקרוב (${ringDayText(alarmPlainNext({ ...alarmForm, skipNext: undefined }))})`}
                </Text>
              </TouchableOpacity>
            ) : null}
            {!alarmFormIsNew ? (
              <TouchableOpacity style={[styles.grayBtn, { marginTop: 10 }]} onPress={() => duplicateAlarm(alarmForm)}>
                <Text style={styles.grayBtnText}>📄 שכפל שעון</Text>
              </TouchableOpacity>
            ) : null}

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
      </WhenOpen>

      <WhenOpen open={logMapVisible}>
      <GeoLogMap visible={logMapVisible} entries={geoLog ?? []} areas={areas} onClose={() => setLogMapVisible(false)} />
      </WhenOpen>

      <WhenOpen open={mapVisible}>
      <MapPicker
        visible={mapVisible}
        initial={mapInitial}
        fallbackCenter={mapFallback}
        onClose={onMapClosed}
        onSave={onMapSaved}
      />
      </WhenOpen>

      <WhenOpen open={geoLog !== null}>
      <PopupShell visible={geoLog !== null} title="📋 יומן מיקום" onClose={() => setGeoLog(null)} yellow={false}>
        <Text style={styles.itemSub}>
          כאן רואים מתי הטלפון זיהה כניסה או יציאה מאזור, והאם צלצל. 50 האירועים האחרונים, החדש למעלה.
        </Text>
        {geoLog && geoLog.length === 0 ? (
          <Text style={styles.emptyText}>עדיין אין אירועים.</Text>
        ) : null}
        <TouchableOpacity style={[styles.grayBtn, { marginVertical: 8, alignItems: 'center' }]} onPress={() => setLogMapVisible(true)}>
          <Text style={styles.grayBtnText}>🗺️ הצג על המפה</Text>
        </TouchableOpacity>
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
      </WhenOpen>

      <WhenOpen open={ringtonesVisible}>
      <RingtonesScreen visible={ringtonesVisible} onClose={() => setRingtonesVisible(false)} />
      </WhenOpen>

      <WhenOpen open={setupVisible}>
      <SetupScreen
        visible={setupVisible}
        onClose={() => {
          setSetupVisible(false);
          refreshPermissions();
          syncGeofences(areas);
        }}
        onExport={doExport}
        onImport={doImport}
        autoBackup={autoBackup}
        onChooseBackupFolder={chooseBackupFolder}
        onBackupNow={backupNow}
        onStopAutoBackup={stopAutoBackup}
        onRestoreAuto={restoreFromAuto}
        driveBackup={driveBackup}
        onConnectDrive={connectGoogleDrive}
        onDriveBackupNow={driveBackupNow}
        driveFilesProgress={driveFilesProgress}
        onDriveOption={setDriveOption}
        onDisconnectDrive={disconnectGoogleDrive}
        onRestoreDrive={restoreFromDrive}
        themeMode={themeMode}
        onThemeMode={setThemeMode}
        accent={accent}
        onAccent={setAccent}
        bg={bg}
        onBg={setBg}
      />
      </WhenOpen>
    </SafeAreaView>
  );
}
