import React, { useCallback, useEffect, useState } from 'react';
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

interface Props {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
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

export default function SetupScreen({ visible, onClose, onExport, onImport }: Props) {
  const [status, setStatus] = useState<Status>(EMPTY);

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
      { text: 'צלצל', onPress: () => GeoAlarm.triggerAlarm('בדיקת צלצול', 'כך ייראה השעון המעורר') },
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EFECE4' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  closeBtn: { padding: 6 },
  closeText: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  content: { padding: 14, paddingBottom: 48 },
  section: { fontSize: 18, fontWeight: '800', color: '#1E293B', marginTop: 8, marginBottom: 6 },
  intro: { fontSize: 14, color: '#475569', marginBottom: 12, lineHeight: 20 },
  allOk: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803D',
    backgroundColor: '#DCFCE7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  step: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 10, elevation: 2 },
  stepOk: { backgroundColor: '#F0FDF4' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    color: '#FFFFFF',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontWeight: '800',
  },
  stepTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: '#0F172A' },
  badge: { fontSize: 12, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  badgeOk: { backgroundColor: '#BBF7D0', color: '#166534' },
  badgeTodo: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  badgeManual: { backgroundColor: '#FEF3C7', color: '#92400E' },
  stepText: { fontSize: 14, color: '#334155', lineHeight: 20 },
  stepBtn: { marginTop: 10, backgroundColor: '#0F172A', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  stepBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  testBtn: { backgroundColor: '#DC2626', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginVertical: 14 },
  testBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  backupBtn: { backgroundColor: '#0284C7', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  backupBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  restoreBtn: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#0284C7' },
  restoreText: { color: '#0284C7' },
});
