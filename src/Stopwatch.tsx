import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Modal,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useScreenFrame } from './ui';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAppStyles } from './appStyles';
import { displayYMD, hhmm, pickDate, pickTimeWheels } from './pickers';
import {
  Journal,
  JournalEntry,
  StopwatchState,
  loadJournals,
  loadStopwatch,
  newId,
  saveJournals,
  saveStopwatch,
} from './storage';
import { Palette, cardShadow, useTheme, useThemedStyles } from './theme';
import { PopupShell, confirm } from './ui';

// ---------------------------------------------------------------- helpers

export function fmtDuration(ms: number, tenths = false): string {
  const total = Math.max(0, Math.floor(ms / 100));
  const t = total % 10;
  const s = Math.floor(total / 10) % 60;
  const m = Math.floor(total / 600) % 60;
  const h = Math.floor(total / 36000);
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const base = h > 0 ? `${h}:${mmss}` : mmss;
  return tenths ? `${base}.${t}` : base;
}

const elapsed = (s: StopwatchState, now: number) => s.accumulated + (s.startAt ? now - s.startAt : 0);

const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function fmtAt(at: number): string {
  const d = new Date(at);
  return `${displayYMD(ymdOf(d))} · ${hhmm(d.getHours(), d.getMinutes())}`;
}

/** Fingerprint / face / screen lock. Resolves true when the user passed. */
async function authenticate(prompt: string): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      Alert.alert('אין נעילת מסך', 'כדי לנעול יומן צריך להגדיר בטלפון טביעת אצבע, קוד או תבנית.');
      return false;
    }
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: 'ביטול',
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- stopwatch card

export default function StopwatchCard() {
  const app = useAppStyles();
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const [sw, setSw] = useState<StopwatchState>({ startAt: null, accumulated: 0 });
  const [now, setNow] = useState(Date.now());
  const [journals, setJournals] = useState<Journal[]>([]);
  const [saveVisible, setSaveVisible] = useState(false);
  const [listVisible, setListVisible] = useState(false);

  useEffect(() => {
    loadStopwatch().then(setSw);
    loadJournals().then(setJournals);
  }, []);

  // Tick only while running and the app is in front.
  useEffect(() => {
    if (!sw.startAt) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setNow(Date.now()));
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [sw.startAt]);

  const update = (s: StopwatchState) => {
    setSw(s);
    setNow(Date.now());
    saveStopwatch(s);
  };
  const persistJournals = (j: Journal[]) => {
    setJournals(j);
    saveJournals(j);
  };

  const ms = elapsed(sw, now);
  const running = !!sw.startAt;

  const toggle = () => {
    const t = Date.now();
    if (running) update({ startAt: null, accumulated: elapsed(sw, t) });
    else update({ startAt: t, accumulated: sw.accumulated });
  };
  const reset = () => update({ startAt: null, accumulated: 0 });

  const openSave = () => {
    if (running) update({ startAt: null, accumulated: elapsed(sw, Date.now()) });
    setSaveVisible(true);
  };

  return (
    <View style={app.card}>
      <View style={styles.headRow}>
        <Text style={[app.subTitle, styles.noMb]}>⏱️ סטופר</Text>
        <TouchableOpacity style={styles.journalsBtn} onPress={() => setListVisible(true)}>
          <Text style={styles.journalsBtnText}>📒 יומנים{journals.length ? ` (${journals.length})` : ''}</Text>
        </TouchableOpacity>
      </View>
      <Text style={app.timerText}>{fmtDuration(ms, true)}</Text>
      <View style={app.row}>
        <TouchableOpacity style={[app.darkBtn, app.flex1]} onPress={toggle}>
          <Text style={app.whiteBtnText}>{running ? '⏸ עצור' : ms > 0 ? '▶ המשך' : '▶ התחל'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[app.grayBtn, app.flex1, styles.center, ms === 0 && styles.disabled]}
          disabled={ms === 0}
          onPress={openSave}
        >
          <Text style={app.grayBtnText}>💾 שמור ליומן</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[app.grayBtn, styles.center]} onPress={reset} disabled={ms === 0}>
          <Text style={[app.grayBtnText, ms === 0 && { color: c.muted }]}>איפוס</Text>
        </TouchableOpacity>
      </View>
      <Text style={app.hintText}>הסטופר ממשיך לספור גם כשהאפליקציה סגורה.</Text>

      <SavePopup
        visible={saveVisible}
        ms={ms}
        journals={journals}
        onClose={() => setSaveVisible(false)}
        onSave={(journalId, newName, entry) => {
          let list = journals;
          let id = journalId;
          if (!id) {
            id = newId();
            list = [...list, { id, name: newName, entries: [], createdAt: Date.now() }];
          }
          persistJournals(list.map((j) => (j.id === id ? { ...j, entries: [...j.entries, entry] } : j)));
          setSaveVisible(false);
          reset();
        }}
      />

      <JournalsScreen
        visible={listVisible}
        journals={journals}
        onChange={persistJournals}
        onClose={() => setListVisible(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------- save popup

function SavePopup({
  visible,
  ms,
  journals,
  onClose,
  onSave,
}: {
  visible: boolean;
  ms: number;
  journals: Journal[];
  onClose: () => void;
  onSave: (journalId: string | null, newName: string, entry: JournalEntry) => void;
}) {
  const app = useAppStyles();
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const [journalId, setJournalId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [withDate, setWithDate] = useState(true);
  const [at, setAt] = useState(Date.now());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    setJournalId(journals.length ? journals[journals.length - 1].id : null);
    setNewName('');
    setWithDate(true);
    setAt(Date.now());
    setNote('');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const atDate = new Date(at);
  const save = () => {
    if (!journalId && !newName.trim()) {
      Alert.alert('בחר יומן', 'בחר יומן קיים או תן שם ליומן חדש.');
      return;
    }
    onSave(journalId, newName.trim(), {
      id: newId(),
      ms,
      at: withDate ? at : undefined,
      note: note.trim() || undefined,
      savedAt: Date.now(),
    });
  };

  return (
    <PopupShell visible={visible} title="שמירה ליומן" onClose={onClose}>
      <Text style={styles.bigTime}>{fmtDuration(ms, true)}</Text>
      <Text style={app.label}>יומן</Text>
      <View style={app.chipsWrapRow}>
        {journals.map((j) => (
          <TouchableOpacity
            key={j.id}
            style={[app.chip, app.chipSpaced, journalId === j.id && app.chipActive]}
            onPress={() => setJournalId(j.id)}
          >
            <Text style={[app.chipText, journalId === j.id && app.chipTextActive]}>
              {j.locked ? '🔒 ' : ''}
              {j.name}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[app.chip, app.chipSpaced, journalId === null && app.chipActive]}
          onPress={() => setJournalId(null)}
        >
          <Text style={[app.chipText, journalId === null && app.chipTextActive]}>+ יומן חדש</Text>
        </TouchableOpacity>
      </View>
      {journalId === null ? (
        <TextInput
          placeholderTextColor={c.muted}
          style={app.popupInput}
          placeholder="שם היומן"
          value={newName}
          onChangeText={setNewName}
          autoFocus={journals.length === 0}
        />
      ) : null}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>לשמור תאריך ושעה</Text>
        <Switch
          trackColor={{ false: c.dark ? '#3A3A3C' : '#D1D1D6', true: c.accent }}
          thumbColor="#FFFFFF"
          value={withDate}
          onValueChange={setWithDate}
        />
      </View>
      {withDate ? (
        <View style={app.row}>
          <TouchableOpacity
            style={[app.grayBtn, app.flex1, styles.center]}
            onPress={() =>
              pickDate(
                ymdOf(atDate),
                (ymd) => {
                  const [y, m, d] = ymd.split('-').map(Number);
                  const n = new Date(at);
                  n.setFullYear(y, m - 1, d);
                  setAt(n.getTime());
                },
                false
              )
            }
          >
            <Text style={app.grayBtnText}>📅 {displayYMD(ymdOf(atDate))}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[app.grayBtn, app.flex1, styles.center]}
            onPress={() =>
              pickTimeWheels(atDate.getHours(), atDate.getMinutes(), (h, m) => {
                const n = new Date(at);
                n.setHours(h, m, 0, 0);
                setAt(n.getTime());
              })
            }
          >
            <Text style={app.grayBtnText}>🕒 {hhmm(atDate.getHours(), atDate.getMinutes())}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TextInput
        placeholderTextColor={c.muted}
        style={app.popupInput}
        placeholder="הערה (לא חובה)"
        value={note}
        onChangeText={setNote}
      />
      <TouchableOpacity style={app.darkBtn} onPress={save}>
        <Text style={app.whiteBtnText}>שמור</Text>
      </TouchableOpacity>
    </PopupShell>
  );
}

// ---------------------------------------------------------------- journals screen

function JournalsScreen({
  visible,
  journals,
  onChange,
  onClose,
}: {
  visible: boolean;
  journals: Journal[];
  onChange: (j: Journal[]) => void;
  onClose: () => void;
}) {
  const frame = useScreenFrame();
  const styles = useThemedStyles(makeStyles);
  const app = useAppStyles();
  const c = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Journal | null>(null);
  const [renameText, setRenameText] = useState('');

  useEffect(() => {
    if (!visible) setOpenId(null);
  }, [visible]);

  useEffect(() => {
    if (!visible || !openId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenId(null);
      return true;
    });
    return () => sub.remove();
  }, [visible, openId]);

  const open = journals.find((j) => j.id === openId) ?? null;
  const patch = (id: string, p: Partial<Journal>) => onChange(journals.map((j) => (j.id === id ? { ...j, ...p } : j)));

  const tryOpen = async (j: Journal) => {
    if (j.locked && !(await authenticate(`פתיחת "${j.name}"`))) return;
    setOpenId(j.id);
  };

  const toggleLock = async (j: Journal) => {
    if (!(await authenticate(j.locked ? 'הסרת הנעילה' : 'נעילת היומן'))) return;
    patch(j.id, { locked: !j.locked });
  };

  const [menuFor, setMenuFor] = useState<Journal | null>(null);
  const journalMenu = (j: Journal) => setMenuFor(j);
  const menuAction = (fn: (j: Journal) => void) => {
    const j = menuFor;
    setMenuFor(null);
    if (j) fn(j);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (openId ? setOpenId(null) : onClose())}>
      <View style={[styles.screen, frame.root]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (openId ? setOpenId(null) : onClose())} hitSlop={12}>
            <Text style={styles.headerBtn}>{openId ? '→' : '✕'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {open ? `${open.locked ? '🔒 ' : ''}${open.name}` : '📒 יומנים'}
          </Text>
          {open ? (
            <TouchableOpacity onPress={() => journalMenu(open)} hitSlop={12}>
              <Text style={styles.headerBtn}>⋮</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        {!open ? (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: frame.bottomSpace }]}>
            {journals.length === 0 ? (
              <Text style={app.emptyText}>
                עדיין אין יומנים. עצור את הסטופר ולחץ "שמור ליומן" כדי ליצור יומן ראשון בשם שתבחר.
              </Text>
            ) : null}
            {journals.map((j) => {
              const last = j.entries[j.entries.length - 1];
              return (
                <TouchableOpacity
                  key={j.id}
                  style={styles.journalRow}
                  onPress={() => tryOpen(j)}
                  onLongPress={() => journalMenu(j)}
                >
                  <View style={app.flex1}>
                    <Text style={styles.journalName}>
                      {j.locked ? '🔒 ' : ''}
                      {j.name}
                    </Text>
                    <Text style={app.itemSub}>
                      {j.entries.length} רשומות
                      {!j.locked && last ? ` · אחרונה ${fmtDuration(last.ms)}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.chev}>‹</Text>
                </TouchableOpacity>
              );
            })}
            {journals.length ? <Text style={app.hintText}>לחיצה ארוכה על יומן: שינוי שם, נעילה או מחיקה.</Text> : null}
          </ScrollView>
        ) : (
          <JournalDetail
            journal={open}
            onDeleteEntry={(e) =>
              confirm('מחיקת רשומה', `למחוק את הרשומה ${fmtDuration(e.ms, true)}?`, 'מחק', () =>
                patch(open.id, { entries: open.entries.filter((x) => x.id !== e.id) })
              )
            }
          />
        )}
      </View>

      <PopupShell visible={!!menuFor} title={menuFor?.name ?? ''} onClose={() => setMenuFor(null)} yellow={false}>
        <TouchableOpacity
          style={styles.menuRow}
          onPress={() =>
            menuAction((j) => {
              setRenaming(j);
              setRenameText(j.name);
            })
          }
        >
          <Text style={styles.menuText}>✏️  שנה שם</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => menuAction(toggleLock)}>
          <Text style={styles.menuText}>{menuFor?.locked ? '🔓  הסר נעילה' : '🔒  נעל (טביעת אצבע / קוד)'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.menuRow}
          onPress={() =>
            menuAction((j) =>
              confirm('מחיקת יומן', `למחוק את "${j.name}" וכל ${j.entries.length} הרשומות שבו?`, 'מחק', () => {
                onChange(journals.filter((x) => x.id !== j.id));
                setOpenId(null);
              })
            )
          }
        >
          <Text style={[styles.menuText, { color: c.danger }]}>🗑️  מחק יומן</Text>
        </TouchableOpacity>
      </PopupShell>

      <PopupShell visible={!!renaming} title="שם היומן" onClose={() => setRenaming(null)}>
        <TextInput
          placeholderTextColor={c.muted}
          style={app.popupInput}
          value={renameText}
          onChangeText={setRenameText}
          autoFocus
        />
        <TouchableOpacity
          style={app.darkBtn}
          onPress={() => {
            if (renaming && renameText.trim()) patch(renaming.id, { name: renameText.trim() });
            setRenaming(null);
          }}
        >
          <Text style={app.whiteBtnText}>שמור</Text>
        </TouchableOpacity>
      </PopupShell>
    </Modal>
  );
}

function JournalDetail({ journal, onDeleteEntry }: { journal: Journal; onDeleteEntry: (e: JournalEntry) => void }) {
  const styles = useThemedStyles(makeStyles);
  const app = useAppStyles();

  const stats = useMemo(() => {
    const ms = journal.entries.map((e) => e.ms);
    if (!ms.length) return null;
    const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
    const last5 = ms.slice(-5);
    return {
      count: ms.length,
      avg,
      max: Math.max(...ms),
      min: Math.min(...ms),
      avg5: last5.reduce((a, b) => a + b, 0) / last5.length,
    };
  }, [journal.entries]);

  const chart = journal.entries.slice(-20);
  const chartMax = Math.max(1, ...chart.map((e) => e.ms));
  const newestFirst = [...journal.entries].reverse();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {stats ? (
        <>
          <View style={styles.statsGrid}>
            <Stat label="רשומות" value={String(stats.count)} />
            <Stat label="ממוצע" value={fmtDuration(stats.avg)} />
            <Stat label="ממוצע 5 אחרונות" value={fmtDuration(stats.avg5)} />
            <Stat label="הכי ארוך" value={fmtDuration(stats.max)} />
            <Stat label="הכי קצר" value={fmtDuration(stats.min)} />
          </View>
          {chart.length > 1 ? (
            <View style={styles.chartBox}>
              <Text style={styles.chartTitle}>{chart.length} הרשומות האחרונות</Text>
              <View style={styles.chart}>
                {chart.map((e) => (
                  <View key={e.id} style={styles.barSlot}>
                    <View style={[styles.bar, { height: `${Math.max(4, (e.ms / chartMax) * 100)}%` }]} />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={app.emptyText}>היומן ריק.</Text>
      )}

      {newestFirst.map((e) => (
        <TouchableOpacity key={e.id} style={styles.entryRow} onLongPress={() => onDeleteEntry(e)} delayLongPress={400}>
          <Text style={styles.entryTime}>{fmtDuration(e.ms, true)}</Text>
          <View style={app.flex1}>
            <Text style={app.itemSub}>{e.at ? fmtAt(e.at) : 'ללא תאריך'}</Text>
            {e.note ? <Text style={styles.entryNote}>{e.note}</Text> : null}
          </View>
        </TouchableOpacity>
      ))}
      {journal.entries.length ? <Text style={app.hintText}>לחיצה ארוכה על רשומה מוחקת אותה.</Text> : null}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  noMb: { marginBottom: 0 },
  journalsBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.accentSoft },
  journalsBtnText: { color: c.onAccentSoft, fontWeight: '700' as const, fontSize: 13 },
  center: { alignItems: 'center' as const },
  disabled: { opacity: 0.45 },
  bigTime: {
    fontSize: 40,
    fontWeight: '300' as const,
    color: c.text,
    textAlign: 'center' as const,
    marginBottom: 6,
    fontVariant: ['tabular-nums' as const],
  },
  switchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginVertical: 6,
  },
  switchLabel: { fontSize: 14.5, fontWeight: '600' as const, color: c.text },
  screen: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    gap: 12,
  },
  headerBtn: { fontSize: 22, color: c.text, fontWeight: '700' as const, minWidth: 24, textAlign: 'center' as const },
  headerSpacer: { width: 24 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '800' as const, color: c.text },
  content: { padding: 16, paddingBottom: 40 },
  journalRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: c.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    ...cardShadow(c),
  },
  journalName: { fontSize: 16, fontWeight: '700' as const, color: c.text, marginBottom: 2 },
  chev: { fontSize: 22, color: c.muted },
  statsGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 },
  stat: { width: '31.5%' as const, backgroundColor: c.card, borderRadius: 14, padding: 10, alignItems: 'center' as const },
  statValue: { fontSize: 18, fontWeight: '700' as const, color: c.text, fontVariant: ['tabular-nums' as const] },
  statLabel: { fontSize: 11.5, color: c.muted, marginTop: 2, textAlign: 'center' as const },
  chartBox: { backgroundColor: c.card, borderRadius: 16, padding: 12, marginBottom: 14 },
  chartTitle: { fontSize: 12.5, color: c.muted, marginBottom: 8 },
  chart: { height: 110, flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: 3 },
  barSlot: { flex: 1, height: '100%' as const, justifyContent: 'flex-end' as const },
  bar: { backgroundColor: c.accent, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  entryRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    backgroundColor: c.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  entryTime: { fontSize: 18, fontWeight: '600' as const, color: c.text, fontVariant: ['tabular-nums' as const] },
  menuRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  menuText: { fontSize: 15.5, fontWeight: '600' as const, color: c.text },
  entryNote: { fontSize: 13.5, color: c.text2, marginTop: 2 },
});
