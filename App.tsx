import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Share,
  Linking,
  Alert,
  StyleSheet,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

type MainTab = 'tasks' | 'workouts' | 'alarms';

interface StickyNote {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  scheduleEnabled?: boolean;
  scheduleDate?: string; // פורמט YYYY-MM-DD
  scheduleTime?: string; // פורמט HH:MM
  notificationId?: string | null;
}

interface WorkoutLink {
  id: string;
  title: string;
  url: string;
  platform: 'youtube' | 'facebook' | 'other';
}

interface MuscleCategory {
  id: string;
  name: string;
  videos: WorkoutLink[];
}

interface LocationAlarm {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
}

const STORAGE_KEY = '@avi_board_apk_state_v2';

const INITIAL_CATEGORIES: MuscleCategory[] = [
  { id: 'chest', name: 'חזה', videos: [] },
  { id: 'back', name: 'גב', videos: [] },
  { id: 'legs', name: 'רגליים', videos: [] },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function detectPlatform(url: string): WorkoutLink['platform'] {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  return 'other';
}

function distanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function parseDateTimeToDate(dateStr?: string, timeStr?: string): Date | null {
  if (!dateStr || !timeStr) return null;
  const dateMatch = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const target = new Date(year, month, day, hour, minute, 0, 0);
  if (Number.isNaN(target.getTime())) return null;
  return target;
}

export default function App() {
  // טאב ראשון קבוע: פתקים ומטלות
  const [activeTab, setActiveTab] = useState<MainTab>('tasks');

  // --- טאב 1: פתקים צהובים ---
  const [notes, setNotes] = useState<StickyNote[]>([
    {
      id: 'welcome-1',
      title: 'פתק דוגמה',
      body: 'לחץ על "הדבק פתק צהוב" להוספת פתק חדש, או לחץ על פתק קיים לפתיחה ב-Pop-up.',
      updatedAt: new Date().toLocaleDateString('he-IL'),
      scheduleEnabled: false,
    },
  ]);

  // חלון יצירת פתק חדש (נפתח רק בלחיצה על "הדבק פתק צהוב")
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newAdvancedOpen, setNewAdvancedOpen] = useState(false);
  const [newScheduleEnabled, setNewScheduleEnabled] = useState(false);
  const [newScheduleDate, setNewScheduleDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [newScheduleTime, setNewScheduleTime] = useState('09:00');

  // חלון צפייה/עריכה/מחיקה/שיתוף לפתק קיים
  const [selectedNote, setSelectedNote] = useState<StickyNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editAdvancedOpen, setEditAdvancedOpen] = useState(false);
  const [editScheduleEnabled, setEditScheduleEnabled] = useState(false);
  const [editScheduleDate, setEditScheduleDate] = useState('');
  const [editScheduleTime, setEditScheduleTime] = useState('');

  // --- טאב 2: סרטוני כושר ---
  const [categories, setCategories] = useState<MuscleCategory[]>(INITIAL_CATEGORIES);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('chest');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  // --- טאב 3: טיימר והתראת מיקום ---
  const [timerMinutes, setTimerMinutes] = useState('3');
  const [timerSeconds, setTimerSeconds] = useState('00');
  const [remainingSec, setRemainingSec] = useState(180);
  const [timerRunning, setTimerRunning] = useState(false);

  const [locationAlarms, setLocationAlarms] = useState<LocationAlarm[]>([]);
  const [alarmLabel, setAlarmLabel] = useState('');
  const [alarmLat, setAlarmLat] = useState('31.928');
  const [alarmLon, setAlarmLon] = useState('35.228');
  const [alarmRadius, setAlarmRadius] = useState('250');
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [triggeredIds, setTriggeredIds] = useState<Record<string, boolean>>({});

  // בקשת הרשאת התראות והעלאת נתונים שמורים
  useEffect(() => {
    (async () => {
      await Notifications.requestPermissionsAsync();
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.notes?.length) setNotes(parsed.notes);
          if (parsed.categories?.length) {
            setCategories(parsed.categories);
            setSelectedCategoryId(parsed.categories[0].id);
          }
          if (parsed.locationAlarms?.length) setLocationAlarms(parsed.locationAlarms);
        }
      } catch {
        // יש לבדוק שגיאות אחסון במכשיר בפועל
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ notes, categories, locationAlarms })
    ).catch(() => {});
  }, [notes, categories, locationAlarms]);

  // ספירה לאחור של הטיימר
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          Notifications.scheduleNotificationAsync({
            content: {
              title: 'הטיימר הסתיים',
              body: 'זמן הספירה לאחור הגיע לאפס.',
              sound: true,
            },
            trigger: null,
          }).catch(() => {});
          Alert.alert('הטיימר הסתיים', 'זמן הספירה לאחור הגיע לאפס.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // ניטור GPS לבדיקת התקרבות לאזור
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 15,
        },
        (loc) => {
          const lat = loc.coords.latitude;
          const lon = loc.coords.longitude;
          setCurrentCoords({ lat, lon });

          setLocationAlarms((prev) =>
            prev.map((alarm) => {
              if (!alarm.enabled) return alarm;
              const dist = distanceInMeters(lat, lon, alarm.latitude, alarm.longitude);
              if (dist <= alarm.radiusMeters && !triggeredIds[alarm.id]) {
                setTriggeredIds((t) => ({ ...t, [alarm.id]: true }));
                Alert.alert(
                  'התראת מיקום',
                  `התקרבת לאזור "${alarm.label}" (מרחק משוער: ${dist} מ').`
                );
              }
              return alarm;
            })
          );
        }
      );
    })();
    return () => {
      sub?.remove();
    };
  }, [triggeredIds]);

  // תזמון התראה מקומית לפתק מטלה (אופציונלי)
  async function scheduleNoteNotification(
    title: string,
    body: string,
    enabled: boolean,
    dateStr?: string,
    timeStr?: string,
    previousNotificationId?: string | null
  ): Promise<string | null> {
    if (previousNotificationId) {
      await Notifications.cancelScheduledNotificationAsync(previousNotificationId).catch(() => {});
    }
    if (!enabled) return null;

    const targetDate = parseDateTimeToDate(dateStr, timeStr);
    if (!targetDate) {
      Alert.alert(
        'תזמון לא תקין',
        'השתמש בפורמט תאריך YYYY-MM-DD ובפורמט שעה HH:MM (לדוגמה 2026-11-20 ו-08:30).'
      );
      return null;
    }

    if (targetDate.getTime() <= Date.now()) {
      Alert.alert('הזמן כבר עבר', 'בחר תאריך ושעה עתידיים כדי לתזמן התראה.');
      return null;
    }

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `מטלה מתוזמנת: ${title || 'פתק מטלה'}`,
          body: body || 'הגיע הזמן לבצע את המטלה.',
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: targetDate },
      });
      return id;
    } catch {
      return null;
    }
  }

  const openCreateNotePopup = () => {
    setNewTitle('');
    setNewBody('');
    setNewAdvancedOpen(false);
    setNewScheduleEnabled(false);
    setNewScheduleDate(new Date().toISOString().slice(0, 10));
    setNewScheduleTime('09:00');
    setCreateModalVisible(true);
  };

  const createStickyNote = async () => {
    if (!newTitle.trim() && !newBody.trim()) {
      Alert.alert('פתק ריק', 'הזן כותרת או תוכן לפתק.');
      return;
    }
    const notifId = await scheduleNoteNotification(
      newTitle.trim(),
      newBody.trim(),
      newAdvancedOpen && newScheduleEnabled,
      newScheduleDate,
      newScheduleTime,
      null
    );

    const item: StickyNote = {
      id: Date.now().toString(),
      title: newTitle.trim() || 'פתק צהוב',
      body: newBody.trim(),
      updatedAt: new Date().toLocaleDateString('he-IL'),
      scheduleEnabled: Boolean(notifId),
      scheduleDate: notifId ? newScheduleDate : undefined,
      scheduleTime: notifId ? newScheduleTime : undefined,
      notificationId: notifId,
    };
    setNotes((prev) => [item, ...prev]);
    setCreateModalVisible(false);
  };

  const openExistingNotePopup = (note: StickyNote) => {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditBody(note.body);
    setEditAdvancedOpen(Boolean(note.scheduleEnabled));
    setEditScheduleEnabled(Boolean(note.scheduleEnabled));
    setEditScheduleDate(note.scheduleDate || new Date().toISOString().slice(0, 10));
    setEditScheduleTime(note.scheduleTime || '09:00');
  };

  const saveEditedNote = async () => {
    if (!selectedNote) return;
    const notifId = await scheduleNoteNotification(
      editTitle.trim(),
      editBody.trim(),
      editAdvancedOpen && editScheduleEnabled,
      editScheduleDate,
      editScheduleTime,
      selectedNote.notificationId
    );

    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedNote.id
          ? {
              ...n,
              title: editTitle.trim() || 'פתק צהוב',
              body: editBody.trim(),
              updatedAt: new Date().toLocaleDateString('he-IL'),
              scheduleEnabled: Boolean(notifId),
              scheduleDate: notifId ? editScheduleDate : undefined,
              scheduleTime: notifId ? editScheduleTime : undefined,
              notificationId: notifId,
            }
          : n
      )
    );
    setSelectedNote(null);
  };

  const deleteNote = async (note: StickyNote) => {
    if (note.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(note.notificationId).catch(() => {});
    }
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    setSelectedNote(null);
  };

  const shareNote = async (note: StickyNote) => {
    const scheduleInfo =
      note.scheduleEnabled && note.scheduleDate && note.scheduleTime
        ? `\nתזמון: ${note.scheduleDate} ${note.scheduleTime}`
        : '';
    await Share.share({
      message: `${note.title}\n\n${note.body}${scheduleInfo}`,
    });
  };

  // פעולות קטגוריות וקישורי כושר
  const addCategory = () => {
    const clean = newCategoryName.trim();
    if (!clean) return;
    const cat: MuscleCategory = { id: Date.now().toString(), name: clean, videos: [] };
    setCategories((prev) => [...prev, cat]);
    setSelectedCategoryId(cat.id);
    setNewCategoryName('');
  };

  const removeCategory = (id: string) => {
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (selectedCategoryId === id) {
        setSelectedCategoryId(next[0]?.id ?? '');
      }
      return next;
    });
  };

  const activeCategory = categories.find((c) => c.id === selectedCategoryId);

  const addVideoLink = () => {
    if (!activeCategory || !videoUrl.trim()) return;
    const item: WorkoutLink = {
      id: Date.now().toString(),
      title: videoTitle.trim() || 'סרטון כושר',
      url: videoUrl.trim(),
      platform: detectPlatform(videoUrl.trim()),
    };
    setCategories((prev) =>
      prev.map((c) =>
        c.id === activeCategory.id ? { ...c, videos: [item, ...c.videos] } : c
      )
    );
    setVideoTitle('');
    setVideoUrl('');
  };

  const openVideo = async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('קישור לא תקין', 'לא ניתן לפתוח את הקישור.');
    }
  };

  const applyTimer = () => {
    const m = Math.max(0, parseInt(timerMinutes || '0', 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(timerSeconds || '0', 10) || 0));
    setRemainingSec(m * 60 + s);
    setTimerRunning(false);
  };

  const formattedTime = `${String(Math.floor(remainingSec / 60)).padStart(2, '0')}:${String(
    remainingSec % 60
  ).padStart(2, '0')}`;

  return (
    <SafeAreaView style={styles.safe}>
      {/* טאבים עליונים - פתקים ומטלות תמיד ראשון */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'tasks' && styles.tabBtnActive]}
          onPress={() => setActiveTab('tasks')}
        >
          <Text style={[styles.tabText, activeTab === 'tasks' && styles.tabTextActive]}>
            פתקים ומטלות
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'workouts' && styles.tabBtnActive]}
          onPress={() => setActiveTab('workouts')}
        >
          <Text style={[styles.tabText, activeTab === 'workouts' && styles.tabTextActive]}>
            סרטוני כושר
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'alarms' && styles.tabBtnActive]}
          onPress={() => setActiveTab('alarms')}
        >
          <Text style={[styles.tabText, activeTab === 'alarms' && styles.tabTextActive]}>
            טיימר ומיקום
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent}>
        {/* --- טאב 1: שולחן עבודה עם כפתור "הדבק פתק צהוב" --- */}
        {activeTab === 'tasks' && (
          <View>
            <View style={styles.topActionBar}>
              <Text style={styles.sectionTitle}>שולחן עבודה</Text>
              <TouchableOpacity style={styles.stickNoteBtn} onPress={openCreateNotePopup}>
                <Text style={styles.stickNoteBtnText}>+ הדבק פתק צהוב</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.notesGrid}>
              {notes.map((note) => (
                <TouchableOpacity
                  key={note.id}
                  style={styles.yellowNote}
                  onPress={() => openExistingNotePopup(note)}
                >
                  <Text style={styles.noteTitle} numberOfLines={1}>
                    {note.title}
                  </Text>
                  <Text style={styles.noteBody} numberOfLines={4}>
                    {note.body}
                  </Text>
                  {note.scheduleEnabled && note.scheduleDate && note.scheduleTime ? (
                    <Text style={styles.scheduleTag}>
                      מתוזמן: {note.scheduleDate} {note.scheduleTime}
                    </Text>
                  ) : null}
                  <Text style={styles.noteDate}>{note.updatedAt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* --- טאב 2: סרטוני כושר לפי קבוצות שרירים --- */}
        {activeTab === 'workouts' && (
          <View>
            <Text style={styles.sectionTitle}>קבוצות שרירים וקישורי סרטונים</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1]}
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
                      style={[
                        styles.chip,
                        cat.id === selectedCategoryId && styles.chipActive,
                      ]}
                      onPress={() => setSelectedCategoryId(cat.id)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          cat.id === selectedCategoryId && styles.chipTextActive,
                        ]}
                      >
                        {cat.name} ({cat.videos.length})
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeCategory(cat.id)}>
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
                  placeholder="שם התרגיל / סרטון"
                  value={videoTitle}
                  onChangeText={setVideoTitle}
                />
                <TextInput
                  style={styles.input}
                  placeholder="קישור ליוטיוב או פייסבוק"
                  value={videoUrl}
                  onChangeText={setVideoUrl}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.darkBtn} onPress={addVideoLink}>
                  <Text style={styles.whiteBtnText}>שמור קישור</Text>
                </TouchableOpacity>

                {activeCategory.videos.map((v) => (
                  <View key={v.id} style={styles.listItem}>
                    <View style={styles.flex1}>
                      <Text style={styles.itemTitle}>{v.title}</Text>
                      <Text style={styles.itemSub}>
                        {v.platform.toUpperCase()} - {v.url}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.blueBtn} onPress={() => openVideo(v.url)}>
                      <Text style={styles.whiteBtnText}>פתח</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}

        {/* --- טאב 3: טיימר ספירה לאחור והתראת מיקום --- */}
        {activeTab === 'alarms' && (
          <View>
            <Text style={styles.sectionTitle}>טיימר ספירה לאחור והתראת מיקום</Text>
            <View style={styles.card}>
              <Text style={styles.subTitle}>טיימר ספירה לאחור</Text>
              <Text style={styles.timerText}>{formattedTime}</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1]}
                  keyboardType="number-pad"
                  placeholder="דקות"
                  value={timerMinutes}
                  onChangeText={setTimerMinutes}
                />
                <TextInput
                  style={[styles.input, styles.flex1]}
                  keyboardType="number-pad"
                  placeholder="שניות"
                  value={timerSeconds}
                  onChangeText={setTimerSeconds}
                />
                <TouchableOpacity style={styles.darkBtn} onPress={applyTimer}>
                  <Text style={styles.whiteBtnText}>קבע</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.darkBtn, styles.flex1]}
                  onPress={() => setTimerRunning((r) => !r)}
                >
                  <Text style={styles.whiteBtnText}>{timerRunning ? 'השהה' : 'התחל'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.grayBtn}
                  onPress={() => {
                    setTimerRunning(false);
                    setRemainingSec(0);
                  }}
                >
                  <Text style={styles.grayBtnText}>איפוס</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.subTitle}>התראה לפי התקרבות לאזור (GPS)</Text>
              <Text style={styles.itemSub}>
                מיקום נוכחי:{' '}
                {currentCoords
                  ? `${currentCoords.lat.toFixed(5)}, ${currentCoords.lon.toFixed(5)}`
                  : 'ממתין ל-GPS...'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="שם האזור"
                value={alarmLabel}
                onChangeText={setAlarmLabel}
              />
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1]}
                  keyboardType="numeric"
                  placeholder="קו רוחב"
                  value={alarmLat}
                  onChangeText={setAlarmLat}
                />
                <TextInput
                  style={[styles.input, styles.flex1]}
                  keyboardType="numeric"
                  placeholder="קו אורך"
                  value={alarmLon}
                  onChangeText={setAlarmLon}
                />
              </View>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1]}
                  keyboardType="number-pad"
                  placeholder="רדיוס במטרים"
                  value={alarmRadius}
                  onChangeText={setAlarmRadius}
                />
                <TouchableOpacity
                  style={styles.grayBtn}
                  onPress={() => {
                    if (!currentCoords) {
                      Alert.alert('אין מיקום עדיין', 'המתן לאות GPS.');
                      return;
                    }
                    setAlarmLat(currentCoords.lat.toFixed(6));
                    setAlarmLon(currentCoords.lon.toFixed(6));
                  }}
                >
                  <Text style={styles.grayBtnText}>מיקום נוכחי</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.darkBtn}
                onPress={() => {
                  const lat = parseFloat(alarmLat);
                  const lon = parseFloat(alarmLon);
                  const rad = Math.max(20, parseInt(alarmRadius || '200', 10) || 200);
                  if (Number.isNaN(lat) || Number.isNaN(lon)) {
                    Alert.alert('קואורדינטות לא תקינות', 'הזן קו רוחב ואורך תקינים.');
                    return;
                  }
                  setLocationAlarms((prev) => [
                    {
                      id: Date.now().toString(),
                      label: alarmLabel.trim() || 'אזור מפה',
                      latitude: lat,
                      longitude: lon,
                      radiusMeters: rad,
                      enabled: true,
                    },
                    ...prev,
                  ]);
                  setAlarmLabel('');
                }}
              >
                <Text style={styles.whiteBtnText}>+ הוסף התראת מיקום</Text>
              </TouchableOpacity>

              {locationAlarms.map((a) => (
                <View key={a.id} style={styles.listItem}>
                  <View style={styles.flex1}>
                    <Text style={styles.itemTitle}>{a.label}</Text>
                    <Text style={styles.itemSub}>
                      רדיוס {a.radiusMeters} מ' ({a.latitude.toFixed(4)}, {a.longitude.toFixed(4)})
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.blueBtn}
                    onPress={() =>
                      setLocationAlarms((prev) =>
                        prev.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x))
                      )
                    }
                  >
                    <Text style={styles.whiteBtnText}>{a.enabled ? 'פעיל' : 'כבוי'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* --- Pop-up להדבקת פתק צהוב חדש (כולל אפשרויות מתקדמות אופציונליות) --- */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.yellowPopup}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>פתק צהוב חדש</Text>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                <Text style={styles.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.popupInput}
              placeholder="כותרת הפתק..."
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <TextInput
              style={[styles.popupInput, styles.popupTextarea]}
              placeholder="כתוב את המטלה או ההערה..."
              multiline
              value={newBody}
              onChangeText={setNewBody}
            />

            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setNewAdvancedOpen((v) => !v)}
            >
              <Text style={styles.advancedToggleText}>
                {newAdvancedOpen
                  ? '▾ הסתר אפשרויות מתקדמות (תזמון והתראה - לא חובה)'
                  : '▸ אפשרויות מתקדמות: תזמון והתראה (לא חובה)'}
              </Text>
            </TouchableOpacity>

            {newAdvancedOpen && (
              <View style={styles.advancedBox}>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>הפעל תזמון והתראה למטלה</Text>
                  <Switch value={newScheduleEnabled} onValueChange={setNewScheduleEnabled} />
                </View>
                {newScheduleEnabled && (
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.popupInput, styles.flex1]}
                      placeholder="YYYY-MM-DD"
                      value={newScheduleDate}
                      onChangeText={setNewScheduleDate}
                    />
                    <TextInput
                      style={[styles.popupInput, styles.flex1]}
                      placeholder="HH:MM"
                      value={newScheduleTime}
                      onChangeText={setNewScheduleTime}
                    />
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity style={styles.darkBtn} onPress={createStickyNote}>
              <Text style={styles.whiteBtnText}>הדבק לשולחן העבודה</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* --- Pop-up לפתק קיים: סגירה ב-X, עריכה, מחיקה, שיתוף ותזמון --- */}
      <Modal
        visible={!!selectedNote}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedNote(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.yellowPopup}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>פרטי פתק</Text>
              <TouchableOpacity onPress={() => setSelectedNote(null)}>
                <Text style={styles.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.popupInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="כותרת"
            />
            <TextInput
              style={[styles.popupInput, styles.popupTextarea]}
              value={editBody}
              onChangeText={setEditBody}
              multiline
              placeholder="תוכן הפתק"
            />

            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setEditAdvancedOpen((v) => !v)}
            >
              <Text style={styles.advancedToggleText}>
                {editAdvancedOpen
                  ? '▾ הסתר אפשרויות מתקדמות (תזמון והתראה - לא חובה)'
                  : '▸ אפשרויות מתקדמות: תזמון והתראה (לא חובה)'}
              </Text>
            </TouchableOpacity>

            {editAdvancedOpen && (
              <View style={styles.advancedBox}>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>הפעל תזמון והתראה למטלה</Text>
                  <Switch value={editScheduleEnabled} onValueChange={setEditScheduleEnabled} />
                </View>
                {editScheduleEnabled && (
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.popupInput, styles.flex1]}
                      placeholder="YYYY-MM-DD"
                      value={editScheduleDate}
                      onChangeText={setEditScheduleDate}
                    />
                    <TextInput
                      style={[styles.popupInput, styles.flex1]}
                      placeholder="HH:MM"
                      value={editScheduleTime}
                      onChangeText={setEditScheduleTime}
                    />
                  </View>
                )}
              </View>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.greenBtn} onPress={saveEditedNote}>
                <Text style={styles.whiteBtnText}>שמור עריכה</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.blueBtn}
                onPress={() => selectedNote && shareNote(selectedNote)}
              >
                <Text style={styles.whiteBtnText}>שתף</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.redBtn}
                onPress={() => selectedNote && deleteNote(selectedNote)}
              >
                <Text style={styles.whiteBtnText}>מחק</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EFECE4' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 3, borderBottomColor: '#0F172A' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  tabTextActive: { color: '#0F172A', fontWeight: '800' },
  desk: { flex: 1 },
  deskContent: { padding: 14, paddingBottom: 40 },
  topActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: '#1E293B' },
  stickNoteBtn: {
    backgroundColor: '#FACC15',
    borderWidth: 1,
    borderColor: '#CA8A04',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  stickNoteBtnText: { color: '#422006', fontWeight: '800', fontSize: 14 },
  notesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  yellowNote: {
    width: '48%',
    backgroundColor: '#FEF08A',
    borderRadius: 6,
    padding: 12,
    minHeight: 135,
    justifyContent: 'space-between',
    elevation: 3,
  },
  noteTitle: { fontSize: 15, fontWeight: '800', color: '#422006', marginBottom: 4 },
  noteBody: { fontSize: 13, color: '#713F12', flex: 1 },
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
  noteDate: { fontSize: 11, color: '#854D0E', marginTop: 6, textAlign: 'left' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    elevation: 2,
  },
  subTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  flex1: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    textAlign: 'right',
    backgroundColor: '#FFFFFF',
  },
  darkBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  whiteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  grayBtn: {
    backgroundColor: '#E2E8F0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  grayBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 12 },
  blueBtn: {
    backgroundColor: '#0284C7',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  greenBtn: {
    flex: 1,
    backgroundColor: '#15803D',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  redBtn: {
    flex: 1,
    backgroundColor: '#B91C1C',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  chipWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  chip: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  chipActive: { backgroundColor: '#0F172A' },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  removeX: { fontSize: 16, color: '#DC2626', fontWeight: '800', marginRight: 4 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  itemTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  itemSub: { fontSize: 12, color: '#64748B' },
  timerText: {
    fontSize: 40,
    fontWeight: '800',
    textAlign: 'center',
    color: '#0F172A',
    marginVertical: 8,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  yellowPopup: {
    backgroundColor: '#FEF9C3',
    borderRadius: 12,
    padding: 16,
    elevation: 8,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
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
    textAlign: 'right',
    color: '#1E293B',
  },
  popupTextarea: { minHeight: 100, textAlignVertical: 'top' },
  advancedToggle: { paddingVertical: 6, marginBottom: 6 },
  advancedToggleText: { fontSize: 13, fontWeight: '700', color: '#78350F', textAlign: 'right' },
  advancedBox: {
    backgroundColor: '#FEF08A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  switchLabel: { fontSize: 13, fontWeight: '700', color: '#422006' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
});