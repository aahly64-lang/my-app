import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { GeoAlarm } from './modules/geo-alarm';
import MapPicker, { MapSelection } from './src/MapPicker';
import SetupScreen, { allAlarmPermissionsOk } from './src/SetupScreen';
import { syncGeofences, MIN_RADIUS_M } from './src/geoTask';
import { exportBackup, pickBackup } from './src/backup';
import {
  AlarmArea,
  AreaMode,
  DEFAULT_CATEGORIES,
  MuscleCategory,
  StickyNote,
  TimerState,
  WELCOME_NOTE,
  WorkoutLink,
  formatHebrewDate,
  loadAreas,
  loadBoard,
  loadTimer,
  localDateString,
  markSetupSeen,
  newId,
  saveAreas,
  saveBoard,
  saveTimer,
  wasSetupSeen,
} from './src/storage';

type MainTab = 'tasks' | 'workouts' | 'alarms';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ---------- helpers ----------

function detectPlatform(url: string): WorkoutLink['platform'] {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  return 'other';
}

function youtubeId(url: string): string | null {
  const m =
    url.match(/youtu\.be\/([\w-]{6,})/) ||
    url.match(/[?&]v=([\w-]{6,})/) ||
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

function parseDateTimeToDate(dateStr?: string, timeStr?: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const dm = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const target = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  return Number.isNaN(target.getTime()) ? null : target;
}

function displayDate(dateStr: string): string {
  const d = parseDateTimeToDate(dateStr, '00:00');
  return d ? d.toLocaleDateString('he-IL') : dateStr;
}

function pickDate(current: string, onPick: (v: string) => void) {
  const base = parseDateTimeToDate(current, '12:00') ?? new Date();
  DateTimePickerAndroid.open({
    value: base,
    mode: 'date',
    minimumDate: new Date(),
    onChange: (e, d) => {
      if (e.type === 'set' && d) onPick(localDateString(d));
    },
  });
}

function pickTime(currentDate: string, currentTime: string, onPick: (v: string) => void) {
  const base = parseDateTimeToDate(currentDate, currentTime) ?? new Date();
  DateTimePickerAndroid.open({
    value: base,
    mode: 'time',
    is24Hour: true,
    onChange: (e, d) => {
      if (e.type === 'set' && d) {
        onPick(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      }
    },
  });
}

function confirm(title: string, message: string, confirmText: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'ביטול', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}

function formatRadius(r: number): string {
  return r >= 1000 ? `${Math.round(r / 10) / 100} ק"מ` : `${r} מ'`;
}

async function scheduleNoteNotification(
  title: string,
  body: string,
  enabled: boolean,
  dateStr?: string,
  timeStr?: string,
  previousNotificationId?: string | null,
  silent = false
): Promise<string | null> {
  if (previousNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(previousNotificationId).catch(() => {});
  }
  if (!enabled) return null;
  const target = parseDateTimeToDate(dateStr, timeStr);
  if (!target) {
    if (!silent) Alert.alert('תזמון לא תקין', 'בחר תאריך ושעה.');
    return null;
  }
  if (target.getTime() <= Date.now()) {
    if (!silent) Alert.alert('הזמן כבר עבר', 'בחר תאריך ושעה עתידיים כדי לתזמן תזכורת.');
    return null;
  }
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title: `תזכורת: ${title || 'מטלה'}`, body: body || 'הגיע הזמן לבצע את המטלה.', sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target },
    });
  } catch {
    return null;
  }
}

// ---------- small UI pieces ----------

function ScheduleEditor(props: {
  open: boolean;
  setOpen: (v: boolean) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  date: string;
  setDate: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
}) {
  const { open, setOpen, enabled, setEnabled, date, setDate, time, setTime } = props;
  return (
    <>
      <TouchableOpacity style={styles.advancedToggle} onPress={() => setOpen(!open)}>
        <Text style={styles.advancedToggleText}>
          {open ? '▾ הסתר תזכורת' : '◂ תזכורת בתאריך ושעה (לא חובה)'}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.advancedBox}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>הפעל תזכורת למטלה</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>
          {enabled && (
            <View style={styles.row}>
              <TouchableOpacity style={[styles.pickerBtn, styles.flex1]} onPress={() => pickDate(date, setDate)}>
                <Text style={styles.pickerBtnText}>📅 {displayDate(date)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pickerBtn, styles.flex1]} onPress={() => pickTime(date, time, setTime)}>
                <Text style={styles.pickerBtnText}>🕘 {time}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </>
  );
}

function PopupShell({
  visible,
  title,
  onClose,
  children,
  yellow = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  yellow?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.popup, yellow ? styles.popupYellow : styles.popupWhite]}>
          <View style={styles.popupHeader}>
            <Text style={styles.popupTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.closeX}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- App ----------

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('tasks');
  const [loaded, setLoaded] = useState(false);
  const [setupVisible, setSetupVisible] = useState(false);
  const [permissionsOk, setPermissionsOk] = useState(true);

  // --- notes ---
  const [notes, setNotes] = useState<StickyNote[]>([WELCOME_NOTE]);
  const [createVisible, setCreateVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newAdvOpen, setNewAdvOpen] = useState(false);
  const [newSchedEnabled, setNewSchedEnabled] = useState(false);
  const [newSchedDate, setNewSchedDate] = useState(localDateString());
  const [newSchedTime, setNewSchedTime] = useState('09:00');

  const [selectedNote, setSelectedNote] = useState<StickyNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editAdvOpen, setEditAdvOpen] = useState(false);
  const [editSchedEnabled, setEditSchedEnabled] = useState(false);
  const [editSchedDate, setEditSchedDate] = useState(localDateString());
  const [editSchedTime, setEditSchedTime] = useState('09:00');

  // --- workouts ---
  const [categories, setCategories] = useState<MuscleCategory[]>(DEFAULT_CATEGORIES);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('chest');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [sharedBanner, setSharedBanner] = useState(false);
  const [editingVideo, setEditingVideo] = useState<{ video: WorkoutLink; categoryId: string } | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evCategory, setEvCategory] = useState('');

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
    moved: boolean;
  } | null>(null);
  const pendingFormRef = useRef<typeof areaForm>(null);

  // ---------- load & persist ----------

  const refreshPermissions = useCallback(async () => {
    setPermissionsOk(await allAlarmPermissionsOk());
  }, []);

  useEffect(() => {
    (async () => {
      const board = await loadBoard();
      if (board) {
        if (Array.isArray(board.notes)) setNotes(board.notes);
        if (Array.isArray(board.categories)) {
          setCategories(board.categories);
          setSelectedCategoryId(board.categories[0]?.id ?? '');
        }
      }

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
  }, [refreshPermissions]);

  useEffect(() => {
    if (loaded) saveBoard({ notes, categories });
  }, [notes, categories, loaded]);

  useEffect(() => {
    if (loaded) saveTimer(timer);
  }, [timer, loaded]);

  // Reload areas when returning to the app (the background task may switch off "once" areas).
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') {
        setAreas(await loadAreas());
        refreshPermissions();
      }
    });
    return () => sub.remove();
  }, [refreshPermissions]);

  // ---------- shared links from YouTube / Facebook ----------

  const handleSharedText = useCallback((text: string) => {
    const url = extractUrl(text) ?? text.trim();
    if (!url) return;
    setActiveTab('workouts');
    setVideoUrl(url);
    const withoutUrl = text.replace(url, '').trim();
    setVideoTitle(withoutUrl.length > 0 && withoutUrl.length < 80 ? withoutUrl : '');
    setSharedBanner(true);
  }, []);

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
    setNewAdvOpen(false);
    setNewSchedEnabled(false);
    setNewSchedDate(localDateString());
    setNewSchedTime('09:00');
    setCreateVisible(true);
  };

  const createNote = async () => {
    if (!newTitle.trim() && !newBody.trim()) {
      Alert.alert('פתק ריק', 'הזן כותרת או תוכן לפתק.');
      return;
    }
    const wantsSchedule = newAdvOpen && newSchedEnabled;
    const notifId = await scheduleNoteNotification(
      newTitle.trim(), newBody.trim(), wantsSchedule, newSchedDate, newSchedTime, null
    );
    if (wantsSchedule && !notifId) return;
    const item: StickyNote = {
      id: newId(),
      title: newTitle.trim() || 'פתק צהוב',
      body: newBody.trim(),
      updatedAt: new Date().toISOString(),
      scheduleEnabled: Boolean(notifId),
      scheduleDate: notifId ? newSchedDate : undefined,
      scheduleTime: notifId ? newSchedTime : undefined,
      notificationId: notifId,
    };
    setNotes((prev) => [item, ...prev]);
    setCreateVisible(false);
  };

  const openNote = (note: StickyNote) => {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditBody(note.body);
    setEditAdvOpen(Boolean(note.scheduleEnabled));
    setEditSchedEnabled(Boolean(note.scheduleEnabled));
    setEditSchedDate(note.scheduleDate || localDateString());
    setEditSchedTime(note.scheduleTime || '09:00');
  };

  const saveNote = async () => {
    if (!selectedNote) return;
    const wantsSchedule = editAdvOpen && editSchedEnabled;
    const unchangedSchedule =
      wantsSchedule &&
      selectedNote.scheduleEnabled &&
      selectedNote.notificationId &&
      selectedNote.scheduleDate === editSchedDate &&
      selectedNote.scheduleTime === editSchedTime;
    let notifId: string | null | undefined = selectedNote.notificationId;
    if (!unchangedSchedule) {
      notifId = await scheduleNoteNotification(
        editTitle.trim(), editBody.trim(), wantsSchedule, editSchedDate, editSchedTime, selectedNote.notificationId
      );
      if (wantsSchedule && !notifId) return;
    }
    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedNote.id
          ? {
              ...n,
              title: editTitle.trim() || 'פתק צהוב',
              body: editBody.trim(),
              updatedAt: new Date().toISOString(),
              scheduleEnabled: Boolean(notifId),
              scheduleDate: notifId ? editSchedDate : undefined,
              scheduleTime: notifId ? editSchedTime : undefined,
              notificationId: notifId ?? null,
            }
          : n
      )
    );
    setSelectedNote(null);
  };

  const toggleDone = async (note: StickyNote) => {
    const done = !note.done;
    if (done && note.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(note.notificationId).catch(() => {});
    }
    setNotes((prev) =>
      prev.map((n) =>
        n.id === note.id
          ? {
              ...n,
              done,
              ...(done && n.notificationId
                ? { notificationId: null, scheduleEnabled: false, scheduleDate: undefined, scheduleTime: undefined }
                : {}),
            }
          : n
      )
    );
  };

  const deleteNote = (note: StickyNote) => {
    confirm('מחיקת פתק', `למחוק את "${note.title}"?`, 'מחק', async () => {
      if (note.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(note.notificationId).catch(() => {});
      }
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setSelectedNote(null);
    });
  };

  const shareNote = async (note: StickyNote) => {
    const info =
      note.scheduleEnabled && note.scheduleDate && note.scheduleTime
        ? `\nתזכורת: ${displayDate(note.scheduleDate)} ${note.scheduleTime}`
        : '';
    await Share.share({ message: `${editTitle || note.title}\n\n${editBody || note.body}${info}` });
  };

  // ---------- workouts ----------

  const addCategory = () => {
    const clean = newCategoryName.trim();
    if (!clean) return;
    const cat: MuscleCategory = { id: newId(), name: clean, videos: [] };
    setCategories((prev) => [...prev, cat]);
    setSelectedCategoryId(cat.id);
    setNewCategoryName('');
  };

  const removeCategory = (cat: MuscleCategory) => {
    const extra = cat.videos.length ? ` ואת ${cat.videos.length} הסרטונים שבה` : '';
    confirm('מחיקת קבוצה', `למחוק את "${cat.name}"${extra}?`, 'מחק', () => {
      setCategories((prev) => {
        const next = prev.filter((c) => c.id !== cat.id);
        if (selectedCategoryId === cat.id) setSelectedCategoryId(next[0]?.id ?? '');
        return next;
      });
    });
  };

  const activeCategory = categories.find((c) => c.id === selectedCategoryId);

  const addVideo = () => {
    const url = (extractUrl(videoUrl) ?? videoUrl).trim();
    if (!activeCategory) {
      Alert.alert('אין קבוצת שריר', 'הוסף קודם קבוצת שריר.');
      return;
    }
    if (!url) {
      Alert.alert('חסר קישור', 'הדבק קישור לסרטון.');
      return;
    }
    const item: WorkoutLink = {
      id: newId(),
      title: videoTitle.trim() || 'סרטון כושר',
      url,
      platform: detectPlatform(url),
    };
    setCategories((prev) =>
      prev.map((c) => (c.id === activeCategory.id ? { ...c, videos: [item, ...c.videos] } : c))
    );
    setVideoTitle('');
    setVideoUrl('');
    setSharedBanner(false);
  };

  const openVideo = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('קישור לא תקין', 'לא ניתן לפתוח את הקישור.');
    }
  };

  const openEditVideo = (video: WorkoutLink, categoryId: string) => {
    setEditingVideo({ video, categoryId });
    setEvTitle(video.title);
    setEvUrl(video.url);
    setEvCategory(categoryId);
  };

  const saveVideo = () => {
    if (!editingVideo) return;
    const url = evUrl.trim();
    if (!url) {
      Alert.alert('חסר קישור', 'הדבק קישור לסרטון.');
      return;
    }
    const updated: WorkoutLink = {
      ...editingVideo.video,
      title: evTitle.trim() || 'סרטון כושר',
      url,
      platform: detectPlatform(url),
    };
    setCategories((prev) =>
      prev.map((c) => {
        let videos = c.videos.filter((v) => v.id !== updated.id);
        if (c.id === evCategory) {
          videos =
            c.id === editingVideo.categoryId
              ? c.videos.map((v) => (v.id === updated.id ? updated : v))
              : [updated, ...videos];
        }
        return { ...c, videos };
      })
    );
    setEditingVideo(null);
  };

  const deleteVideo = () => {
    if (!editingVideo) return;
    confirm('מחיקת סרטון', `למחוק את "${editingVideo.video.title}"?`, 'מחק', () => {
      setCategories((prev) =>
        prev.map((c) => ({ ...c, videos: c.videos.filter((v) => v.id !== editingVideo.video.id) }))
      );
      setEditingVideo(null);
    });
  };

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
    let notificationId: string | null = null;
    try {
      notificationId = await Notifications.scheduleNotificationAsync({
        content: { title: 'הטיימר הסתיים', body: 'זמן הספירה לאחור הגיע לאפס.', sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: secs },
      });
    } catch {
      // ignore
    }
    setNow(Date.now());
    setTimer((t) => ({ ...t, endAt: Date.now() + secs * 1000, pausedRemainingSec: null, notificationId }));
  };

  const pauseTimer = async () => {
    if (timer.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(timer.notificationId).catch(() => {});
    }
    setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: remainingSec, notificationId: null }));
  };

  const resetTimer = async () => {
    if (timer.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(timer.notificationId).catch(() => {});
    }
    setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: null, notificationId: null }));
  };

  const applyTimer = async () => {
    const m = Math.max(0, parseInt(timerMinutes || '0', 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(timerSeconds || '0', 10) || 0));
    if (timer.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(timer.notificationId).catch(() => {});
    }
    setTimer({ durationSec: m * 60 + s, endAt: null, pausedRemainingSec: null, notificationId: null });
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
      setAreaForm({ id: null, sel, label: '', mode: 'every', note: '', moved: true });
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
      await exportBackup({ notes, categories, areas: await loadAreas() });
    } catch {
      Alert.alert('הגיבוי נכשל', 'לא הצלחתי ליצור את קובץ הגיבוי.');
    }
  };

  const doImport = async () => {
    const data = await pickBackup();
    if (!data) return;
    confirm(
      'שחזור מגיבוי',
      `הגיבוי כולל ${data.notes.length} פתקים, ${data.categories.length} קבוצות שרירים ו-${data.areas.length} אזורים.\nהשחזור יחליף את כל המידע הנוכחי באפליקציה.`,
      'שחזר',
      async () => {
        await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
        const restoredNotes: StickyNote[] = [];
        for (const n of data.notes) {
          let notificationId: string | null = null;
          if (n.scheduleEnabled && !n.done) {
            notificationId = await scheduleNoteNotification(
              n.title, n.body, true, n.scheduleDate, n.scheduleTime, null, true
            );
          }
          restoredNotes.push({
            ...n,
            notificationId,
            scheduleEnabled: Boolean(notificationId),
            scheduleDate: notificationId ? n.scheduleDate : undefined,
            scheduleTime: notificationId ? n.scheduleTime : undefined,
          });
        }
        setNotes(restoredNotes);
        setCategories(data.categories);
        setSelectedCategoryId(data.categories[0]?.id ?? '');
        setTimer((t) => ({ ...t, endAt: null, pausedRemainingSec: null, notificationId: null }));
        await persistAreas(data.areas, data.areas.map((a) => a.id));
        setSetupVisible(false);
        Alert.alert('השחזור הושלם', 'כל המידע שוחזר מהגיבוי.');
      }
    );
  };

  // ---------- render ----------

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.appHeader}>
        <Text style={styles.appTitle}>יומן ושולחן עבודה</Text>
        <TouchableOpacity onPress={() => setSetupVisible(true)} hitSlop={10} style={styles.gearBtn}>
          <Text style={styles.gearText}>⚙️</Text>
          {!permissionsOk ? <View style={styles.gearDot} /> : null}
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {(
          [
            ['tasks', 'פתקים ומטלות'],
            ['workouts', 'סרטוני כושר'],
            ['alarms', 'טיימר ומיקום'],
          ] as [MainTab, string][]
        ).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabBtn, activeTab === key && styles.tabBtnActive]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={[styles.tabText, activeTab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent} keyboardShouldPersistTaps="handled">
        {/* ---------- Tab 1: notes ---------- */}
        {activeTab === 'tasks' && (
          <View>
            <View style={styles.topActionBar}>
              <Text style={styles.sectionTitle}>שולחן עבודה</Text>
              <TouchableOpacity style={styles.stickNoteBtn} onPress={openCreateNote}>
                <Text style={styles.stickNoteBtnText}>+ הדבק פתק צהוב</Text>
              </TouchableOpacity>
            </View>

            {sortedNotes.length === 0 ? (
              <Text style={styles.emptyText}>אין פתקים. לחץ על "הדבק פתק צהוב" כדי להוסיף.</Text>
            ) : null}

            <View style={styles.notesGrid}>
              {sortedNotes.map((note) => (
                <TouchableOpacity
                  key={note.id}
                  style={[styles.yellowNote, note.done && styles.noteDone]}
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
                      {note.done ? <Text style={styles.checkMark}>✓</Text> : null}
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.noteBody, note.done && styles.mutedText]} numberOfLines={4}>
                    {note.body}
                  </Text>
                  {note.scheduleEnabled && note.scheduleDate && note.scheduleTime ? (
                    <Text style={styles.scheduleTag}>
                      ⏰ {displayDate(note.scheduleDate)} {note.scheduleTime}
                    </Text>
                  ) : null}
                  <Text style={styles.noteDate}>
                    {note.done ? 'בוצע · ' : ''}
                    {formatHebrewDate(note.updatedAt)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ---------- Tab 2: workouts ---------- */}
        {activeTab === 'workouts' && (
          <View>
            <Text style={styles.sectionTitle}>קבוצות שרירים וסרטונים</Text>

            {sharedBanner ? (
              <View style={styles.sharedBanner}>
                <Text style={styles.sharedBannerText}>
                  התקבל קישור ששיתפת. בחר קבוצת שריר, תן שם ולחץ "שמור קישור".
                </Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1, styles.noMargin]}
                  placeholder="קבוצת שריר חדשה"
                  value={newCategoryName}
                  onChangeText={setNewCategoryName}
                />
                <TouchableOpacity style={styles.darkBtn} onPress={addCategory}>
                  <Text style={styles.whiteBtnText}>הוסף</Text>
                </TouchableOpacity>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {categories.map((cat) => (
                  <View key={cat.id} style={styles.chipWrap}>
                    <TouchableOpacity
                      style={[styles.chip, cat.id === selectedCategoryId && styles.chipActive]}
                      onPress={() => setSelectedCategoryId(cat.id)}
                      onLongPress={() => removeCategory(cat)}
                    >
                      <Text style={[styles.chipText, cat.id === selectedCategoryId && styles.chipTextActive]}>
                        {cat.name} ({cat.videos.length})
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeCategory(cat)} hitSlop={8}>
                      <Text style={styles.removeX}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>

            {activeCategory ? (
              <View style={styles.card}>
                <Text style={styles.subTitle}>סרטונים עבור: {activeCategory.name}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="שם התרגיל / הסרטון"
                  value={videoTitle}
                  onChangeText={setVideoTitle}
                />
                <TextInput
                  style={styles.input}
                  placeholder="קישור ליוטיוב או פייסבוק"
                  value={videoUrl}
                  onChangeText={setVideoUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <TouchableOpacity style={styles.darkBtn} onPress={addVideo}>
                  <Text style={styles.whiteBtnText}>שמור קישור</Text>
                </TouchableOpacity>
                <Text style={styles.hintText}>
                  טיפ: ביוטיוב או בפייסבוק לחץ "שיתוף" ובחר באפליקציה הזו, והקישור יגיע לכאן לבד.
                </Text>

                {activeCategory.videos.length === 0 ? (
                  <Text style={styles.emptyText}>עדיין אין סרטונים בקבוצה הזו.</Text>
                ) : null}

                {activeCategory.videos.map((v) => {
                  const yt = v.platform === 'youtube' ? youtubeId(v.url) : null;
                  return (
                    <View key={v.id} style={styles.videoItem}>
                      <TouchableOpacity style={styles.videoMain} onPress={() => openVideo(v.url)}>
                        {yt ? (
                          <Image
                            source={{ uri: `https://img.youtube.com/vi/${yt}/mqdefault.jpg` }}
                            style={styles.thumb}
                          />
                        ) : (
                          <View style={[styles.thumb, styles.thumbPlaceholder]}>
                            <Text style={styles.thumbIcon}>{v.platform === 'facebook' ? 'f' : '▶'}</Text>
                          </View>
                        )}
                        <View style={styles.flex1}>
                          <Text style={styles.itemTitle} numberOfLines={2}>
                            {v.title}
                          </Text>
                          <Text style={styles.itemSub}>
                            {v.platform === 'youtube' ? 'YouTube' : v.platform === 'facebook' ? 'Facebook' : 'קישור'} · לחץ לצפייה
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => openEditVideo(v, activeCategory.id)}
                        hitSlop={8}
                      >
                        <Text style={styles.iconBtnText}>✏️</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}

        {/* ---------- Tab 3: timer + location areas ---------- */}
        {activeTab === 'alarms' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.subTitle}>📍 שעון מעורר לפי מיקום</Text>
              <Text style={styles.itemSub}>
                בחר אזור על המפה, והטלפון יצלצל כשתיכנס אליו, גם כשהאפליקציה סגורה.
              </Text>

              {!permissionsOk ? (
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

              {areas.map((a) => (
                <View key={a.id} style={styles.areaItem}>
                  <TouchableOpacity style={styles.flex1} onPress={() => editArea(a)}>
                    <Text style={[styles.itemTitle, !a.enabled && styles.mutedText]}>{a.label}</Text>
                    <Text style={styles.itemSub}>
                      {a.mode === 'once' ? 'חד-פעמי' : 'בכל כניסה'} · רדיוס {formatRadius(a.radiusMeters)}
                      {a.mode === 'once' && !a.enabled ? ' · צלצל וכבה' : ''}
                    </Text>
                    {a.note ? (
                      <Text style={styles.areaNote} numberOfLines={1}>
                        📝 {a.note}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                  <Switch value={a.enabled} onValueChange={() => toggleArea(a)} />
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.subTitle}>⏱️ טיימר ספירה לאחור</Text>
              <Text style={styles.timerText}>{formattedTime}</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1, styles.noMargin, styles.centerText]}
                  keyboardType="number-pad"
                  placeholder="דקות"
                  value={timerMinutes}
                  onChangeText={setTimerMinutes}
                />
                <Text style={styles.colon}>:</Text>
                <TextInput
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
              <Text style={styles.hintText}>ההתראה תגיע בזמן גם אם תסגור את האפליקציה.</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ---------- popup: new note ---------- */}
      <PopupShell visible={createVisible} title="פתק צהוב חדש" onClose={() => setCreateVisible(false)}>
        <TextInput style={styles.popupInput} placeholder="כותרת הפתק..." value={newTitle} onChangeText={setNewTitle} />
        <TextInput
          style={[styles.popupInput, styles.popupTextarea]}
          placeholder="כתוב את המטלה או ההערה..."
          multiline
          value={newBody}
          onChangeText={setNewBody}
        />
        <ScheduleEditor
          open={newAdvOpen}
          setOpen={setNewAdvOpen}
          enabled={newSchedEnabled}
          setEnabled={setNewSchedEnabled}
          date={newSchedDate}
          setDate={setNewSchedDate}
          time={newSchedTime}
          setTime={setNewSchedTime}
        />
        <TouchableOpacity style={styles.darkBtn} onPress={createNote}>
          <Text style={styles.whiteBtnText}>הדבק לשולחן העבודה</Text>
        </TouchableOpacity>
      </PopupShell>

      {/* ---------- popup: existing note ---------- */}
      <PopupShell visible={!!selectedNote} title="פרטי פתק" onClose={() => setSelectedNote(null)}>
        <TextInput style={styles.popupInput} value={editTitle} onChangeText={setEditTitle} placeholder="כותרת" />
        <TextInput
          style={[styles.popupInput, styles.popupTextarea]}
          value={editBody}
          onChangeText={setEditBody}
          multiline
          placeholder="תוכן הפתק"
        />
        <ScheduleEditor
          open={editAdvOpen}
          setOpen={setEditAdvOpen}
          enabled={editSchedEnabled}
          setEnabled={setEditSchedEnabled}
          date={editSchedDate}
          setDate={setEditSchedDate}
          time={editSchedTime}
          setTime={setEditSchedTime}
        />
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
            <Text style={styles.whiteBtnText}>שתף</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.redBtn} onPress={() => selectedNote && deleteNote(selectedNote)}>
            <Text style={styles.whiteBtnText}>מחק</Text>
          </TouchableOpacity>
        </View>
      </PopupShell>

      {/* ---------- popup: edit video ---------- */}
      <PopupShell visible={!!editingVideo} title="עריכת סרטון" onClose={() => setEditingVideo(null)} yellow={false}>
        <TextInput style={styles.input} value={evTitle} onChangeText={setEvTitle} placeholder="שם הסרטון" />
        <TextInput
          style={styles.input}
          value={evUrl}
          onChangeText={setEvUrl}
          placeholder="קישור"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Text style={styles.label}>קבוצת שריר:</Text>
        <View style={styles.chipsWrapRow}>
          {categories.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, styles.chipSpaced, c.id === evCategory && styles.chipActive]}
              onPress={() => setEvCategory(c.id)}
            >
              <Text style={[styles.chipText, c.id === evCategory && styles.chipTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.greenBtn} onPress={saveVideo}>
            <Text style={styles.whiteBtnText}>שמור</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.blueBtnFlex} onPress={() => editingVideo && openVideo(editingVideo.video.url)}>
            <Text style={styles.whiteBtnText}>צפה</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.redBtn} onPress={deleteVideo}>
            <Text style={styles.whiteBtnText}>מחק</Text>
          </TouchableOpacity>
        </View>
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
            <TextInput
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
                ? 'יצלצל בכל כניסה לאזור (לכל היותר פעם ב-15 דקות).'
                : 'יצלצל בכניסה הבאה, ואז האזור ייכבה. אפשר להדליק אותו שוב במתג.'}
            </Text>
            <Text style={styles.label}>הערה (לא חובה)</Text>
            <TextInput
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
                  <Text style={styles.whiteBtnText}>מחק</Text>
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

      <SetupScreen
        visible={setupVisible}
        onClose={() => {
          setSetupVisible(false);
          refreshPermissions();
          syncGeofences(areas);
        }}
        onExport={doExport}
        onImport={doImport}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EFECE4' },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  appTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  gearBtn: { padding: 4 },
  gearText: { fontSize: 22 },
  gearDot: { position: 'absolute', top: 2, end: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC2626' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  tabBtn: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 3, borderBottomColor: '#0F172A' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  tabTextActive: { color: '#0F172A', fontWeight: '800' },
  desk: { flex: 1 },
  deskContent: { padding: 14, paddingBottom: 48 },
  topActionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: '#1E293B', marginBottom: 8 },
  stickNoteBtn: {
    backgroundColor: '#FACC15',
    borderWidth: 1,
    borderColor: '#CA8A04',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  stickNoteBtnText: { color: '#422006', fontWeight: '800', fontSize: 14 },
  emptyText: { color: '#64748B', fontSize: 14, marginVertical: 10 },
  notesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  yellowNote: {
    width: '48.5%',
    backgroundColor: '#FEF08A',
    borderRadius: 6,
    padding: 12,
    minHeight: 140,
    justifyContent: 'space-between',
    elevation: 3,
  },
  noteDone: { backgroundColor: '#E7E5E4', elevation: 1 },
  noteTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  noteTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#422006' },
  strike: { textDecorationLine: 'line-through', color: '#78716C' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#A16207',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFBEB',
  },
  checkboxOn: { backgroundColor: '#15803D', borderColor: '#15803D' },
  checkMark: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  noteBody: { fontSize: 13, color: '#713F12', flex: 1 },
  mutedText: { color: '#78716C' },
  scheduleTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    backgroundColor: '#FDE047',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  noteDate: { fontSize: 11, color: '#854D0E', marginTop: 6 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 14, elevation: 2 },
  subTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  flex1: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 4, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
  },
  noMargin: { marginBottom: 0 },
  centerText: { textAlign: 'center' },
  colon: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  darkBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  bigBtn: { paddingVertical: 14, marginVertical: 10 },
  whiteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  whiteBtnTextBig: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  grayBtn: { backgroundColor: '#E2E8F0', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  grayBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 13 },
  greenBtn: { flex: 1, backgroundColor: '#15803D', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  blueBtnFlex: { flex: 1, backgroundColor: '#0284C7', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  redBtn: { flex: 1, backgroundColor: '#B91C1C', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  hintText: { fontSize: 12, color: '#64748B', marginTop: 6, marginBottom: 4, lineHeight: 17 },
  sharedBanner: { backgroundColor: '#DBEAFE', borderRadius: 10, padding: 10, marginBottom: 10 },
  sharedBannerText: { color: '#1E3A8A', fontWeight: '700', fontSize: 13 },
  chipWrap: { flexDirection: 'row', alignItems: 'center', marginEnd: 10, marginTop: 4 },
  chipsWrapRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  chip: { backgroundColor: '#F1F5F9', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20 },
  chipSpaced: { marginEnd: 6, marginBottom: 6 },
  chipActive: { backgroundColor: '#0F172A' },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  removeX: { fontSize: 14, color: '#DC2626', fontWeight: '800', marginStart: 4 },
  videoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  videoMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 96, height: 54, borderRadius: 6, backgroundColor: '#E2E8F0' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: 22, fontWeight: '800', color: '#475569' },
  iconBtn: { padding: 6 },
  iconBtnText: { fontSize: 18 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  itemSub: { fontSize: 12, color: '#64748B' },
  warnBox: { backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginTop: 10 },
  warnText: { color: '#92400E', fontWeight: '700', fontSize: 13 },
  areaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  areaNote: { fontSize: 12, color: '#92400E', marginTop: 2 },
  areaSummary: { backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginVertical: 8, gap: 6 },
  linkText: { color: '#0284C7', fontWeight: '800', fontSize: 14 },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  segmentOn: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  segmentText: { fontWeight: '700', color: '#334155' },
  segmentTextOn: { color: '#FFFFFF' },
  timerText: { fontSize: 46, fontWeight: '800', textAlign: 'center', color: '#0F172A', marginVertical: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 16 },
  popup: { borderRadius: 12, padding: 16, elevation: 8, maxHeight: '90%' },
  popupYellow: { backgroundColor: '#FEF9C3' },
  popupWhite: { backgroundColor: '#FFFFFF' },
  popupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  popupTitle: { fontSize: 17, fontWeight: '800', color: '#422006' },
  closeX: { fontSize: 20, fontWeight: '800', color: '#422006', padding: 4 },
  popupInput: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#EAB308',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    color: '#1E293B',
  },
  popupTextarea: { minHeight: 100, textAlignVertical: 'top' },
  advancedToggle: { paddingVertical: 6, marginBottom: 6 },
  advancedToggleText: { fontSize: 13, fontWeight: '700', color: '#78350F' },
  advancedBox: { backgroundColor: '#FEF08A', borderRadius: 8, padding: 10, marginBottom: 10 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  switchLabel: { fontSize: 13, fontWeight: '700', color: '#422006' },
  pickerBtn: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#EAB308',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pickerBtnText: { fontSize: 15, fontWeight: '700', color: '#422006' },
  doneBtn: { backgroundColor: '#DCFCE7', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  doneBtnOn: { backgroundColor: '#E7E5E4' },
  doneBtnText: { color: '#166534', fontWeight: '800', fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
