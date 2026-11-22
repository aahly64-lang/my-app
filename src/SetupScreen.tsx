import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { GeoAlarm } from '../modules/geo-alarm';
import { ringNow } from './rings';
import { ACCENTS, Palette, ThemeMode, cardShadow, useTheme, withFonts } from './theme';
import { SoundKind, SoundSettings, loadSounds, saveSounds } from './storage';

const SOUND_ROWS: [SoundKind, string][] = [
  ['alarm', '⏰ שעון מעורר'],
  ['timer', '⏱️ טיימר'],
  ['reminder', '📝 תזכורות פתקים'],
  ['geo', '📍 התראת מיקום'],
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
  themeMode: ThemeMode;
  onThemeMode: (m: ThemeMode) => void;
  accent: string;
  onAccent: (k: string) => void;
}

function useStyles() {
  const c = useTheme();
  return useMemo(() => makeStyles(c), [c]);
}

interface Status {
  notifications: boolean;
  locationFg: boolean;
  locationBg: boolean;
  fullScreen: boolean;
  battery: boolean;
}

const EMPTY: Status = {
  notifications: false,
  locationFg: false,
  locationBg: false,
  fullScreen: false,
  battery: false,
};

export async function readPermissionStatus(): Promise<Status> {
  try {
    const [n, fg, bg] = await Promise.all([
      Notifications.getPermissionsAsync(),
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    return {
      notifications: n.granted,
      locationFg: fg.granted,
      locationBg: bg.granted,
      fullScreen: GeoAlarm.canUseFullScreenIntent(),
      battery: GeoAlarm.isIgnoringBatteryOptimizations(),
    };
  } catch {
    return EMPTY;
  }
}

export async function allAlarmPermissionsOk(): Promise<boolean> {
  const s = await readPermissionStatus();
  return s.notifications && s.locationFg && s.locationBg && s.fullScreen && s.battery;
}

function Step({
  n,
  title,
  text,
  ok,
  manual,
  button,
  onPress,
}: {
  n: number;
  title: string;
  text: string;
  ok?: boolean;
  manual?: boolean;
  button: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.step, ok && styles.stepOk]}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepNum}>{ok ? '✓' : n}</Text>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={[styles.badge, ok ? styles.badgeOk : manual ? styles.badgeManual : styles.badgeTodo]}>
          {ok ? 'מאושר' : manual ? 'ידני' : 'צריך לאשר'}
        </Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
      {!ok ? (
        <TouchableOpacity style={styles.stepBtn} onPress={onPress}>
          <Text style={styles.stepBtnText}>{button}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function SetupScreen({ visible, onClose, onExport, onImport, themeMode, onThemeMode, accent, onAccent }: Props) {
  const styles = useStyles();
  const c = useTheme();
  const [status, setStatus] = useState<Status>(EMPTY);
  const [sounds, setSounds] = useState<SoundSettings>({});

  useEffect(() => {
    if (visible) loadSounds().then(setSounds);
  }, [visible]);

  const chooseSound = async (kind: SoundKind, label: string) => {
    const picked = await GeoAlarm.pickSound(sounds[kind] ?? null, label);
    if (!picked) return;
    const next = { ...sounds, [kind]: picked.uri };
    setSounds(next);
    await saveSounds(next);
  };

  const refresh = useCallback(async () => setStatus(await readPermissionStatus()), []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [visible, refresh]);

  const askNotifications = async () => {
    const r = await Notifications.requestPermissionsAsync();
    if (!r.granted && !r.canAskAgain) GeoAlarm.openAppSettings();
    refresh();
  };

  const askLocationFg = async () => {
    const r = await Location.requestForegroundPermissionsAsync();
    if (!r.granted && !r.canAskAgain) GeoAlarm.openAppSettings();
    refresh();
  };

  const askLocationBg = async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      Alert.alert('קודם מיקום בזמן שימוש', 'אשר קודם את שלב 2.');
      return;
    }
    Alert.alert(
      'מיקום "כל הזמן"',
      'במסך שייפתח בחר "אפשר כל הזמן" (Allow all the time), ואז חזור לאפליקציה.',
      [
        {
          text: 'המשך',
          onPress: async () => {
            const r = await Location.requestBackgroundPermissionsAsync();
            if (!r.granted && !r.canAskAgain) GeoAlarm.openAppSettings();
            refresh();
          },
        },
      ]
    );
  };

  const testAlarm = () => {
    Alert.alert('בדיקת צלצול', 'השעון יצלצל עכשיו בעוצמה מרבית. לעצירה לחץ "עצור".', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'צלצל', onPress: () => ringNow('alarm', 'בדיקת צלצול', 'כך ייראה השעון המעורר') },
    ]);
  };

  const allOk =
    status.notifications && status.locationFg && status.locationBg && status.fullScreen && status.battery;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>הגדרות וגיבוי</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.section}>מראה</Text>
          <View style={styles.themeRow}>
            {(
              [
                ['auto', '📱 אוטומטי'],
                ['light', '☀️ בהיר'],
                ['dark', '🌙 כהה'],
              ] as [ThemeMode, string][]
            ).map(([m, label]) => (
              <TouchableOpacity
                key={m}
                style={[styles.themeBtn, themeMode === m && styles.themeBtnOn]}
                onPress={() => onThemeMode(m)}
              >
                <Text style={[styles.themeBtnText, themeMode === m && styles.themeBtnTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.subSection}>צבע ראשי</Text>
          <View style={styles.accentRow}>
            {ACCENTS.map((a) => {
              const col = c.dark ? a.dark.accent : a.light.accent;
              const on = accent === a.key;
              return (
                <TouchableOpacity key={a.key} style={styles.accentItem} onPress={() => onAccent(a.key)}>
                  <View style={[styles.accentDot, { backgroundColor: col }, on && styles.accentDotOn]}>
                    {on ? <Text style={[styles.accentCheck, { color: c.dark ? a.dark.onAccent : a.light.onAccent }]}>✓</Text> : null}
                  </View>
                  <Text style={[styles.accentName, on && styles.accentNameOn]}>{a.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.section}>הרשאות לשעון המעורר לפי מיקום</Text>
          <Text style={styles.intro}>
            כדי שהשעון יצלצל גם כשהאפליקציה סגורה, צריך לאשר את כל השלבים. מספיק לעשות את זה פעם אחת.
          </Text>
          {allOk ? <Text style={styles.allOk}>✓ כל ההרשאות מאושרות</Text> : null}

          <Step
            n={1}
            title="התראות"
            text="מאפשר לאפליקציה להציג את הצלצול ואת התזכורות."
            ok={status.notifications}
            button="אשר התראות"
            onPress={askNotifications}
          />
          <Step
            n={2}
            title="מיקום בזמן שימוש"
            text="נדרש כדי להציג את המיקום שלך במפה."
            ok={status.locationFg}
            button="אשר מיקום"
            onPress={askLocationFg}
          />
          <Step
            n={3}
            title='מיקום "כל הזמן"'
            text='נדרש כדי לזהות כניסה לאזור גם כשהאפליקציה סגורה. בחר "אפשר כל הזמן".'
            ok={status.locationBg}
            button="פתח הגדרת מיקום"
            onPress={askLocationBg}
          />
          <Step
            n={4}
            title="התראות במסך מלא"
            text="מאפשר לשעון להידלק על כל המסך גם כשהטלפון נעול. הפעל את המתג במסך שייפתח."
            ok={status.fullScreen}
            button="פתח הגדרה"
            onPress={() => GeoAlarm.openFullScreenIntentSettings()}
          />
          <Step
            n={5}
            title="ביטול חיסכון בסוללה"
            text='מונע מהטלפון לעצור את האפליקציה ברקע. אשר "אפשר" בחלון שייפתח.'
            ok={status.battery}
            button="בטל חיסכון סוללה"
            onPress={() => GeoAlarm.requestIgnoreBatteryOptimizations()}
          />
          <Step
            n={6}
            title="Honor: ניהול הפעלת אפליקציות"
            text={
              'בטלפוני Honor חובה גם את זה:\n' +
              'במסך שייפתח מצא את "יומן ושולחן עבודה", כבה את "ניהול אוטומטי", ובחלון שקופץ הדלק את שלושת המתגים: הפעלה אוטומטית, הפעלה משנית, הפעלה ברקע.\n' +
              'אם נפתח מסך אחר: הגדרות ← סוללה ← הפעלת אפליקציות.'
            }
            manual
            button="פתח ניהול הפעלה"
            onPress={() => GeoAlarm.openAutoStartSettings()}
          />

          <TouchableOpacity style={styles.testBtn} onPress={testAlarm}>
            <Text style={styles.testBtnText}>🔔 בדיקת צלצול</Text>
          </TouchableOpacity>

          <Text style={styles.section}>צלילים</Text>
          <Text style={styles.intro}>
            בחר צליל לכל סוג צלצול מתוך הצלילים של הטלפון. ברירת המחדל: צליל השעון המעורר של הטלפון.
          </Text>
          {SOUND_ROWS.map(([kind, label]) => (
            <TouchableOpacity key={kind} style={styles.soundRow} onPress={() => chooseSound(kind, label)}>
              <Text style={styles.stepTitle}>{label}</Text>
              <Text style={styles.soundName} numberOfLines={1}>
                {GeoAlarm.getSoundTitle(sounds[kind] ?? null)} ◂
              </Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.section}>גיבוי ושחזור</Text>
          <Text style={styles.intro}>
            כל המידע (פתקים, סרטונים, אזורים) שמור רק בטלפון. מומלץ לגבות מדי פעם ולשמור את הקובץ בדרייב, במייל או בווטסאפ.
          </Text>
          <TouchableOpacity style={styles.backupBtn} onPress={onExport}>
            <Text style={styles.backupBtnText}>⬆️ צור קובץ גיבוי ושתף</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.backupBtn, styles.restoreBtn]} onPress={onImport}>
            <Text style={[styles.backupBtnText, styles.restoreText]}>⬇️ שחזר מקובץ גיבוי</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create(
    withFonts({
      safe: { flex: 1, backgroundColor: c.bg },
      header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
        backgroundColor: c.bg,
      },
      headerTitle: { fontSize: 25, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
      closeBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: c.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        alignItems: 'center',
        justifyContent: 'center',
      },
      closeText: { fontSize: 16, fontWeight: '700', color: c.text },
      content: { padding: 16, paddingBottom: 56 },
      section: { fontSize: 19, fontWeight: '700', color: c.text, marginTop: 12, marginBottom: 6 },
      intro: { fontSize: 14, color: c.muted, marginBottom: 12, lineHeight: 21 },
      allOk: {
        fontSize: 14.5,
        fontWeight: '700',
        color: c.okText,
        backgroundColor: c.okBg,
        padding: 12,
        borderRadius: 14,
        overflow: 'hidden',
        marginBottom: 12,
      },
      step: {
        backgroundColor: c.card,
        borderRadius: 20,
        padding: 14,
        marginBottom: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        ...cardShadow(c),
      },
      stepOk: { opacity: 0.85 },
      stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
      stepNum: {
        width: 28,
        height: 28,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: c.accent,
        color: c.onAccent,
        textAlign: 'center',
        textAlignVertical: 'center',
        fontWeight: '700',
        fontSize: 14,
      },
      stepTitle: { flex: 1, fontSize: 15.5, fontWeight: '700', color: c.text },
      badge: { fontSize: 12, fontWeight: '600', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
      badgeOk: { backgroundColor: c.okBg, color: c.okText },
      badgeTodo: { backgroundColor: c.dangerSoft, color: c.onDangerSoft },
      badgeManual: { backgroundColor: c.warnBg, color: c.warnText },
      stepText: { fontSize: 14, color: c.text2, lineHeight: 21 },
      stepBtn: {
        marginTop: 12,
        backgroundColor: c.accent,
        minHeight: 44,
        paddingVertical: 11,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
      },
      stepBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 14.5 },
      testBtn: {
        backgroundColor: c.primary,
        minHeight: 50,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 14,
      },
      testBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 16 },
      soundRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c.card,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        padding: 14,
        marginBottom: 8,
        gap: 8,
      },
      soundName: { maxWidth: '55%', fontSize: 13, color: c.accentText, fontWeight: '600' },
      backupBtn: {
        backgroundColor: c.accent,
        minHeight: 50,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
      },
      backupBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 15 },
      restoreBtn: { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border },
      restoreText: { color: c.text },
      themeRow: { flexDirection: 'row', gap: 4, marginBottom: 12, padding: 4, borderRadius: 18, backgroundColor: c.seg },
      themeBtn: {
        flex: 1,
        minHeight: 44,
        paddingVertical: 10,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
      },
      themeBtnOn: { backgroundColor: c.accent },
      subSection: { fontSize: 14, fontWeight: '700', color: c.muted, marginTop: 14, marginBottom: 8 },
      accentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
      accentItem: { width: '18%', alignItems: 'center', marginBottom: 8 },
      accentDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
      accentDotOn: { borderWidth: 3, borderColor: c.text },
      accentCheck: { fontSize: 16, fontWeight: '900' },
      accentName: { fontSize: 11, color: c.muted, marginTop: 3 },
      accentNameOn: { color: c.text, fontWeight: '700' },
      themeBtnText: { fontWeight: '500', color: c.muted, fontSize: 14 },
      themeBtnTextOn: { color: c.onAccent, fontWeight: '700' },
    })
  );
