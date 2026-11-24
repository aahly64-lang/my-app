import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, ScrollView, Share, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { GeoAlarm } from '../modules/geo-alarm';
import { parseQuickTask } from './taskParse';
import { scheduleMorning } from './morning';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Feather } from '@expo/vector-icons';
import { useAppStyles } from './appStyles';
import { useTheme } from './theme';
import { PopupShell, ReminderEditor, ReminderValue, confirm, emptyReminder } from './ui';
import { DAY_LETTERS, daysSummary, displayYMD, hhmm, parseHHMM, parseYMD, pickDate, pickTimeWheels } from './pickers';
import { cancelRing, scheduleReminder, taskRingId } from './rings';
import { syncGeofences } from './geoTask';
import { DocChips } from './docLinks';
import {
  AlarmArea,
  Task,
  TaskList,
  TaskTemplate,
  loadAreas,
  loadMorning,
  loadTaskLists,
  loadTaskTemplates,
  loadTasks,
  localDateString,
  newId,
  saveMorning,
  saveTaskLists,
  saveTaskTemplates,
  saveTasks,
} from './storage';

const HISTORY_DAYS = 365;

const waLink = (phone: string) => {
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('0')) d = '972' + d.slice(1);
  return `https://wa.me/${d}`;
};

const PHOTO_DIR = `${FileSystem.documentDirectory}task-photos/`;

function addDays(ymd: string, n: number): string {
  const d = parseYMD(ymd) ?? new Date();
  d.setDate(d.getDate() + n);
  return localDateString(d);
}

/** Next date (after `from`) that falls on one of the given week days. */
function nextRepeatDate(days: number[], from: string): string {
  for (let i = 1; i <= 7; i++) {
    const cand = addDays(from, i);
    const d = parseYMD(cand);
    if (d && days.includes(d.getDay())) return cand;
  }
  return addDays(from, 7);
}

type SectionKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'nodate';
const SECTION_TITLES: Record<SectionKey, string> = {
  overdue: '🔴 באיחור',
  today: 'היום',
  tomorrow: 'מחר',
  week: 'השבוע',
  later: 'בהמשך',
  nodate: 'בלי תאריך',
};
const SECTION_ORDER: SectionKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate'];

function sectionOf(t: Task, today: string): SectionKey {
  if (!t.due) return 'nodate';
  if (t.due < today) return 'overdue';
  if (t.due === today) return 'today';
  if (t.due === addDays(today, 1)) return 'tomorrow';
  if (t.due <= addDays(today, 7)) return 'week';
  return 'later';
}

export function countDueToday(tasks: Task[]): number {
  const today = localDateString();
  return tasks.filter((t) => !t.done && t.due && t.due <= today).length;
}

type Row = { kind: 'header'; key: string; title: string; count: number } | { kind: 'task'; key: string; task: Task };

interface Props {
  dataVersion: number;
  onCountChange: (n: number) => void;
  onConvertToNote: (t: Task) => void;
}

async function scheduleTaskReminder(t: Task) {
  cancelRing(taskRingId(t.id));
  if (t.done || !t.reminder || !t.due || !t.reminderTime) return;
  const [h, m] = parseHHMM(t.reminderTime);
  const d = parseYMD(t.due);
  if (!d) return;
  d.setHours(h, m, 0, 0);
  await scheduleReminder({
    id: taskRingId(t.id),
    title: `משימה: ${t.title}`,
    body: t.notes || 'הגיע הזמן לבצע את המשימה',
    silent: t.reminderMode === 'silent',
    once: { at: d.getTime() },
  });
}

export default function TasksTab({ dataVersion, onCountChange, onConvertToNote }: Props) {
  const styles = useAppStyles();
  const c = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [areas, setAreas] = useState<AlarmArea[]>([]);
  const [quick, setQuick] = useState('');
  const [quickDue, setQuickDue] = useState<string | undefined>(undefined);
  const [quickStar, setQuickStar] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [undo, setUndo] = useState<{ msg: string; prev: Task[] } | null>(null);
  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // edit popup
  const [edit, setEdit] = useState<Task | null>(null);
  const [reminder, setReminder] = useState<ReminderValue>(emptyReminder());
  const [newSub, setNewSub] = useState('');

  // lists, search, templates, history, settings
  const [lists, setLists] = useState<TaskList[]>([]);
  const [listId, setListId] = useState<string>('all');
  const [listForm, setListForm] = useState<{ id: string | null; name: string } | null>(null);
  const [listMenu, setListMenu] = useState<TaskList | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [smartOff, setSmartOff] = useState(false);
  const [snooze, setSnooze] = useState<Task | null>(null);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplForm, setTplForm] = useState<{ name: string; items: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [morning, setMorning] = useState({ enabled: false, time: '07:30' });
  const [photo, setPhoto] = useState<string | null>(null);

  const today = localDateString();

  useEffect(() => {
    (async () => {
      const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
      const all = (await loadTasks()).filter((t) => !t.done || (t.doneAt ?? 0) > cutoff);
      setTasks(all);
      saveTasks(all);
      setAreas(await loadAreas());
      setLists(await loadTaskLists());
      setTemplates(await loadTaskTemplates());
      setMorning(await loadMorning());
    })();
  }, [dataVersion]);

  // Morning summary follows the tasks (debounced).
  const morningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (morningTimer.current) clearTimeout(morningTimer.current);
    morningTimer.current = setTimeout(() => scheduleMorning(tasks, morning), 1500);
  }, [tasks, morning]);

  useEffect(() => {
    onCountChange(countDueToday(tasks));
  }, [tasks, onCountChange]);

  const persist = useCallback((next: Task[]) => {
    setTasks(next);
    saveTasks(next);
  }, []);

  const showUndo = (msg: string, prev: Task[]) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ msg, prev });
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  };

  const doUndo = async () => {
    if (!undo) return;
    persist(undo.prev);
    for (const t of undo.prev) await scheduleTaskReminder(t);
    setUndo(null);
  };

  // ---------- actions ----------
  const parsed = useMemo(() => (smartOff || !quick.trim() ? null : parseQuickTask(quick)), [quick, smartOff]);
  const smartFound = !!parsed && (!!parsed.due || !!parsed.time);

  const addQuick = async () => {
    if (!quick.trim()) return;
    const p = smartFound && parsed ? parsed : { title: quick.trim(), due: undefined, time: undefined };
    const minOrder = tasks.reduce((m, t) => Math.min(m, t.order), 0);
    const t: Task = {
      id: newId(),
      title: p.title,
      done: false,
      createdAt: Date.now(),
      order: minOrder - 1,
      star: quickStar,
      due: quickDue ?? p.due,
      reminder: !!p.time,
      reminderTime: p.time,
      subtasks: [],
      list: listId !== 'all' ? listId : undefined,
    };
    persist([t, ...tasks]);
    setQuick('');
    setQuickStar(false);
    setSmartOff(false);
    if (t.reminder) await scheduleTaskReminder(t);
  };

  // ---------- snooze ----------
  const doSnooze = async (t: Task, due: string) => {
    const updated = { ...t, due };
    persist(tasks.map((x) => (x.id === t.id ? updated : x)));
    await scheduleTaskReminder(updated);
    setSnooze(null);
  };

  // ---------- lists ----------
  const saveList = () => {
    if (!listForm) return;
    const name = listForm.name.trim();
    if (!name) return;
    let next: TaskList[];
    if (listForm.id) next = lists.map((l) => (l.id === listForm.id ? { ...l, name } : l));
    else {
      const l = { id: newId(), name };
      next = [...lists, l];
      setListId(l.id);
    }
    setLists(next);
    saveTaskLists(next);
    setListForm(null);
  };
  const deleteList = (l: TaskList) =>
    confirm('מחיקת רשימה', `למחוק את הרשימה "${l.name}"? המשימות שבה יישארו ב"הכל".`, 'מחק', () => {
      const next = lists.filter((x) => x.id !== l.id);
      setLists(next);
      saveTaskLists(next);
      persist(tasks.map((t) => (t.list === l.id ? { ...t, list: undefined } : t)));
      setListId('all');
    });

  // ---------- templates ----------
  const useTemplate = (tpl: TaskTemplate) => {
    const minOrder = tasks.reduce((m, t) => Math.min(m, t.order), 0);
    const created: Task[] = tpl.items.map((title, i) => ({
      id: newId(),
      title,
      done: false,
      createdAt: Date.now(),
      order: minOrder - tpl.items.length + i,
      subtasks: [],
      list: listId !== 'all' ? listId : undefined,
    }));
    persist([...created, ...tasks]);
    setTplOpen(false);
  };
  const saveTemplate = (name: string, items: string[]) => {
    if (!name.trim() || !items.length) return;
    const next = [...templates, { id: newId(), name: name.trim(), items }];
    setTemplates(next);
    saveTaskTemplates(next);
    setTplForm(null);
  };
  const deleteTemplate = (tpl: TaskTemplate) =>
    confirm('מחיקת תבנית', `למחוק את התבנית "${tpl.name}"?`, 'מחק', () => {
      const next = templates.filter((x) => x.id !== tpl.id);
      setTemplates(next);
      saveTaskTemplates(next);
    });

  // ---------- contact & photos (edit popup) ----------
  const attachContact = async () => {
    if (!edit) return;
    const ct = await GeoAlarm.pickContact();
    if (ct && ct.phone) setEdit({ ...edit, contact: ct });
  };
  const addPhoto = async (camera: boolean) => {
    if (!edit) return;
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('מצלמה', 'צריך לאשר גישה למצלמה.');
          return;
        }
      }
      const r = camera
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
      if (r.canceled || !r.assets?.length) return;
      await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {});
      const to = `${PHOTO_DIR}${newId()}.jpg`;
      await FileSystem.copyAsync({ from: r.assets[0].uri, to });
      setEdit((e) => (e ? { ...e, photos: [...(e.photos ?? []), to] } : e));
    } catch {
      Alert.alert('תמונה', 'לא הצלחתי לצרף את התמונה.');
    }
  };

  const complete = async (t: Task) => {
    const prev = tasks;
    if (t.done) {
      const next = tasks.map((x) => (x.id === t.id ? { ...x, done: false, doneAt: undefined } : x));
      persist(next);
      await scheduleTaskReminder({ ...t, done: false });
      return;
    }
    if (t.repeatDays?.length) {
      const nextDue = nextRepeatDate(t.repeatDays, t.due && t.due > today ? t.due : today);
      const updated: Task = {
        ...t,
        due: nextDue,
        subtasks: (t.subtasks ?? []).map((s) => ({ ...s, done: false })),
      };
      persist(tasks.map((x) => (x.id === t.id ? updated : x)));
      await scheduleTaskReminder(updated);
      showUndo(`✓ בוצע · חוזרת ב-${displayYMD(nextDue)}`, prev);
      return;
    }
    cancelRing(taskRingId(t.id));
    persist(tasks.map((x) => (x.id === t.id ? { ...x, done: true, doneAt: Date.now() } : x)));
    showUndo('✓ סומנה כבוצעה', prev);
  };

  const remove = (t: Task) => {
    const prev = tasks;
    cancelRing(taskRingId(t.id));
    persist(tasks.filter((x) => x.id !== t.id));
    if (t.areaId) loadAreas().then((a) => syncGeofences(a));
    showUndo('🗑️ המשימה נמחקה', prev);
  };

  const toggleStar = (t: Task) => persist(tasks.map((x) => (x.id === t.id ? { ...x, star: !x.star } : x)));

  const clearDone = () =>
    confirm('ניקוי', 'למחוק את כל המשימות שבוצעו?', 'מחק', () => persist(tasks.filter((t) => !t.done)));

  const shareOpen = () => {
    const open = tasks.filter((t) => !t.done && inList(t));
    if (!open.length) return;
    const lines = open.flatMap((t) => [
      `☐ ${t.star ? '⭐ ' : ''}${t.title}${t.due ? ` (${displayYMD(t.due)})` : ''}`,
      ...(t.subtasks ?? []).map((x) => `    ${x.done ? '☑' : '☐'} ${x.title}`),
    ]);
    const name = listId === 'all' ? 'המשימות שלי' : lists.find((l) => l.id === listId)?.name ?? 'המשימות שלי';
    Share.share({ message: `${name}:\n${lines.join('\n')}` });
  };

  const shareOne = (t: Task) => {
    const subs = (t.subtasks ?? []).map((x) => `  ${x.done ? '☑' : '☐'} ${x.title}`);
    const lines = [`${t.star ? '⭐ ' : ''}${t.title}${t.due ? ` (${displayYMD(t.due)})` : ''}`, ...subs];
    Share.share({ message: lines.join('\n') });
  };

  const fromMenu = (fn: (t: Task) => void) => {
    const t = menuTask;
    setMenuTask(null);
    if (t) fn(t);
  };

  // ---------- edit ----------
  const openEdit = (t: Task) => {
    setEdit({ ...t, subtasks: [...(t.subtasks ?? [])] });
    setReminder({
      ...emptyReminder(),
      enabled: !!t.reminder,
      date: t.due ?? today,
      time: t.reminderTime ?? '09:00',
      mode: t.reminderMode ?? 'ring',
    });
    setNewSub('');
  };

  const saveEdit = async () => {
    if (!edit) return;
    const title = edit.title.trim();
    if (!title) return;
    const updated: Task = {
      ...edit,
      title,
      reminder: reminder.enabled,
      reminderTime: reminder.enabled ? reminder.time : undefined,
      reminderMode: reminder.mode,
      due: reminder.enabled ? reminder.date : edit.due,
    };
    const before = tasks.find((t) => t.id === updated.id);
    persist(tasks.map((t) => (t.id === updated.id ? updated : t)));
    await scheduleTaskReminder(updated);
    if ((before?.areaId ?? '') !== (updated.areaId ?? '')) syncGeofences(await loadAreas());
    setEdit(null);
  };

  const deleteFromEdit = () => {
    if (!edit) return;
    const t = tasks.find((x) => x.id === edit.id);
    setEdit(null);
    if (t) remove(t);
  };

  const toNote = () => {
    if (!edit) return;
    const t = edit;
    confirm('העברה לפתקים', `להפוך את "${t.title}" לפתק? המשימה תוסר מהרשימה.`, 'העבר', () => {
      cancelRing(taskRingId(t.id));
      persist(tasks.filter((x) => x.id !== t.id));
      setEdit(null);
      onConvertToNote(t);
    });
  };

  // ---------- rows ----------
  const inList = (t: Task) => listId === 'all' || t.list === listId;
  const q = search.trim().toLowerCase();
  const matches = (t: Task) =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    (t.notes ?? '').toLowerCase().includes(q) ||
    (t.subtasks ?? []).some((s) => s.title.toLowerCase().includes(q)) ||
    (t.contact?.name ?? '').toLowerCase().includes(q);

  const rows: Row[] = useMemo(() => {
    const visible = tasks.filter((t) => inList(t) && matches(t));
    const open = visible.filter((t) => !t.done);
    const out: Row[] = [];
    for (const key of SECTION_ORDER) {
      const list = open
        .filter((t) => sectionOf(t, today) === key)
        .sort((a, b) => Number(!!b.star) - Number(!!a.star) || a.order - b.order);
      if (!list.length) continue;
      out.push({ kind: 'header', key: `h-${key}`, title: SECTION_TITLES[key], count: list.length });
      for (const t of list) out.push({ kind: 'task', key: t.id, task: t });
    }
    const done = visible.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    if (done.length) {
      out.push({ kind: 'header', key: 'h-done', title: `✓ בוצעו`, count: done.length });
      if (showDone) for (const t of done) out.push({ kind: 'task', key: t.id, task: t });
    }
    return out;
  }, [tasks, today, showDone, listId, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragEnd = ({ data }: { data: Row[] }) => {
    let i = 0;
    const orderMap = new Map<string, number>();
    for (const r of data) if (r.kind === 'task') orderMap.set(r.task.id, i++);
    persist(tasks.map((t) => (orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id)! } : t)));
  };

  const renderRow = ({ item, drag, isActive }: RenderItemParams<Row>) => {
    if (item.kind === 'header') {
      const isDone = item.key === 'h-done';
      return (
        <View style={styles.taskHeaderRow}>
          <TouchableOpacity disabled={!isDone} onPress={() => setShowDone(!showDone)} style={styles.flex1}>
            <Text style={[styles.taskHeader, item.key === 'h-overdue' && styles.taskHeaderLate]}>
              {item.title} ({item.count}) {isDone ? (showDone ? '▾' : '◂') : ''}
            </Text>
          </TouchableOpacity>
          {isDone && showDone ? (
            <TouchableOpacity onPress={clearDone}>
              <Text style={styles.linkText}>נקה</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    const t = item.task;
    const subs = t.subtasks ?? [];
    const subsDone = subs.filter((s) => s.done).length;
    const area = t.areaId ? areas.find((a) => a.id === t.areaId) : undefined;
    return (
      <ReanimatedSwipeable
        friction={1.2}
        leftThreshold={40}
        rightThreshold={40}
        renderLeftActions={() => (
          <View style={[styles.swipeAction, styles.swipeDone]}>
            <Text style={styles.swipeText}>{t.done ? '↩' : '✓'}</Text>
          </View>
        )}
        renderRightActions={(_p, _d, sw) => (
          <View style={{ flexDirection: 'row' }}>
            {!t.done ? (
              <TouchableOpacity
                style={[styles.swipeAction, { backgroundColor: c.infoBg, marginEnd: 6 }]}
                onPress={() => {
                  sw.close();
                  setSnooze(t);
                }}
              >
                <Text style={[styles.swipeText, { color: c.infoText }]}>⏭ דחה</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.swipeAction, styles.swipeDelete]}
              onPress={() => {
                sw.close();
                remove(t);
              }}
            >
              <Text style={styles.swipeText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        )}
        onSwipeableOpen={(direction, sw) => {
          if (direction === 'left') {
            sw.close();
            complete(t);
          }
        }}
      >
        <TouchableOpacity
          style={[styles.taskRow, isActive && styles.listRowActive]}
          onPress={() => openEdit(t)}
          onLongPress={() => setMenuTask(t)}
          delayLongPress={350}
        >
          <TouchableOpacity
            onPress={() => complete(t)}
            hitSlop={10}
            style={[styles.checkbox, styles.taskCheckbox, t.done && styles.checkboxOn]}
          >
            {t.done ? <Feather name="check" size={16} color="#FFFFFF" /> : null}
          </TouchableOpacity>
          <View style={styles.flex1}>
            <Text style={[styles.taskTitle, t.done && styles.strike]} numberOfLines={2}>
              {t.title}
            </Text>
            <Text style={styles.itemSub} numberOfLines={1}>
              {[
                t.due && !t.done ? `📅 ${displayYMD(t.due)}` : '',
                t.reminder && !t.done ? `${t.reminderMode === 'silent' ? '🔕' : '🔔'} ${t.reminderTime}` : '',
                t.repeatDays?.length ? `🔁 ${daysSummary(t.repeatDays)}` : '',
                area ? `📍 ${area.label}` : '',
                subs.length ? `☑ ${subsDone}/${subs.length}` : '',
                t.docs?.length ? `📎 ${t.docs.length}` : '',
                t.contact ? `👤 ${t.contact.name}` : '',
                t.photos?.length ? `📷 ${t.photos.length}` : '',
                listId === 'all' && t.list ? `🗂 ${lists.find((l) => l.id === t.list)?.name ?? ''}` : '',
              ]
                .filter(Boolean)
                .join('  ')}
            </Text>
          </View>
          {t.contact && !t.done ? (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${t.contact!.phone}`)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
              <Text style={styles.starText}>📞</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => toggleStar(t)} hitSlop={10}>
            <Text style={[styles.starText, !t.star && styles.starOff]}>{t.star ? '⭐' : '☆'}</Text>
          </TouchableOpacity>
          {!t.done ? (
            <TouchableOpacity onLongPress={drag} delayLongPress={120} hitSlop={10} style={styles.dragHandle}>
              <Text style={styles.dragHandleText}>☰</Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      </ReanimatedSwipeable>
    );
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity style={[styles.chip, styles.chipSpaced, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.flex1}>
      <DraggableFlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        onDragEnd={onDragEnd}
        contentContainerStyle={styles.deskContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.sectionTitle}>משימות</Text>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                {(
                  [
                    ['🔍', () => setSearchOpen(!searchOpen)],
                    ['📋', () => setTplOpen(true)],
                    ['📜', () => setHistoryOpen(true)],
                    ['⚙️', () => setSettingsOpen(true)],
                    ['📤', shareOpen],
                  ] as [string, () => void][]
                ).map(([icon, fn]) => (
                  <TouchableOpacity key={icon} onPress={fn} hitSlop={8}>
                    <Text style={{ fontSize: 19 }}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navChips} keyboardShouldPersistTaps="handled">
              {[{ id: 'all', name: 'הכל' }, ...lists].map((l) => (
                <TouchableOpacity
                  key={l.id}
                  style={[styles.chip, styles.chipSpaced, listId === l.id && styles.chipActive]}
                  onPress={() => setListId(l.id)}
                  onLongPress={() => l.id !== 'all' && setListMenu(l as TaskList)}
                >
                  <Text style={[styles.chipText, listId === l.id && styles.chipTextActive]}>
                    {l.name}
                    {l.id !== 'all' ? ` ${tasks.filter((t) => !t.done && t.list === l.id).length}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.chip, styles.chipSpaced]} onPress={() => setListForm({ id: null, name: '' })}>
                <Text style={styles.chipText}>+ רשימה</Text>
              </TouchableOpacity>
            </ScrollView>
            {searchOpen ? (
              <TextInput
                style={styles.input}
                placeholder="🔍 חיפוש במשימות..."
                placeholderTextColor={c.muted}
                value={search}
                onChangeText={setSearch}
                autoFocus
              />
            ) : null}
            <View style={styles.card}>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1, styles.noMargin]}
                  placeholder='משימה חדשה... (למשל "להתקשר לספק מחר ב-10")'
                  placeholderTextColor={c.muted}
                  value={quick}
                  onChangeText={setQuick}
                  onSubmitEditing={addQuick}
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
                <TouchableOpacity style={styles.darkBtn} onPress={addQuick}>
                  <Text style={styles.whiteBtnText}>הוסף</Text>
                </TouchableOpacity>
              </View>
              {smartFound && parsed ? (
                <View style={[styles.row, { marginBottom: 6 }]}>
                  <Text style={[styles.itemSub, styles.flex1]}>
                    ✨ זוהה: {parsed.due ? `📅 ${parsed.due === today ? 'היום' : displayYMD(parsed.due)}` : ''}
                    {parsed.time ? `  🔔 ${parsed.time}` : ''} · "{parsed.title}"
                  </Text>
                  <TouchableOpacity onPress={() => setSmartOff(true)} hitSlop={8}>
                    <Text style={styles.linkText}>✕ בלי זיהוי</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={styles.chipsWrapRow}>
                {chip('היום', quickDue === today, () => setQuickDue(quickDue === today ? undefined : today))}
                {chip('מחר', quickDue === addDays(today, 1), () =>
                  setQuickDue(quickDue === addDays(today, 1) ? undefined : addDays(today, 1))
                )}
                {chip(
                  quickDue && quickDue !== today && quickDue !== addDays(today, 1) ? `📅 ${displayYMD(quickDue)}` : '📅 תאריך',
                  !!quickDue && quickDue !== today && quickDue !== addDays(today, 1),
                  () => pickDate(quickDue, (d) => setQuickDue(d))
                )}
                {chip('⭐ חשוב', quickStar, () => setQuickStar(!quickStar))}
              </View>
              <Text style={styles.hintText}>
                לחיצה ארוכה על משימה פותחת תפריט. החלקה ימינה ✓, החלקה שמאלה ⏭ דחייה או 🗑️ מחיקה. לסידור, החזק את ☰ וגרור. לחיצה ארוכה על רשימה: שינוי שם או מחיקה.
              </Text>
            </View>
            {rows.length === 0 ? <Text style={styles.emptyText}>אין משימות. כתוב משימה ולחץ "הוסף".</Text> : null}
          </View>
        }
      />

      {undo ? (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>{undo.msg}</Text>
          <TouchableOpacity onPress={doUndo} hitSlop={10}>
            <Text style={styles.snackbarUndo}>בטל</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <PopupShell visible={!!menuTask} title={menuTask?.title ?? ''} onClose={() => setMenuTask(null)} yellow={false}>
        {menuTask ? (
          <>
            {(
              [
                ['✏️  עריכה', () => fromMenu(openEdit)],
                [menuTask.done ? '↩  החזר לפתוחות' : '✓  סמן כבוצעה', () => fromMenu(complete)],
                [menuTask.star ? '☆  הסר סימון חשוב' : '⭐  סמן כחשובה', () => fromMenu(toggleStar)],
                ['⏭  דחה', () => fromMenu(setSnooze)],
                ['📤  שיתוף (וואטסאפ ועוד)', () => fromMenu(shareOne)],
              ] as [string, () => void][]
            ).map(([label, fn]) => (
              <TouchableOpacity key={label} style={styles.menuItem} onPress={fn}>
                <Text style={styles.menuItemText}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.menuItem} onPress={() => fromMenu(remove)}>
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>🗑️  מחיקה</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </PopupShell>

      <PopupShell
        visible={!!edit}
        title="משימה"
        onClose={() => setEdit(null)}
        yellow={false}
        actions={
          <TouchableOpacity style={styles.headerSaveBtn} onPress={saveEdit}>
            <Text style={styles.headerSaveText}>✓ שמור</Text>
          </TouchableOpacity>
        }
        footer={
          edit ? (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.greenBtn} onPress={saveEdit}>
                <Text style={styles.whiteBtnText}>שמור</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.blueBtnFlex} onPress={toNote}>
                <Text style={styles.softBtnText}>→ לפתק</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.redBtn} onPress={deleteFromEdit}>
                <Text style={styles.dangerBtnText}>מחק</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      >
        {edit ? (
          <>
            <TextInput
              style={styles.input}
              value={edit.title}
              onChangeText={(t) => setEdit({ ...edit, title: t })}
              placeholder="כותרת"
              placeholderTextColor={c.muted}
            />
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={edit.notes ?? ''}
              onChangeText={(t) => setEdit({ ...edit, notes: t })}
              placeholder="פרטים (לא חובה)"
              placeholderTextColor={c.muted}
              multiline
            />
            {edit.docs?.length ? <Text style={styles.label}>📎 מסמכים מצורפים</Text> : null}
            <DocChips
              docs={edit.docs}
              onRemove={(d) => setEdit({ ...edit, docs: (edit.docs ?? []).filter((x) => x.uri !== d.uri) })}
            />
            <View style={styles.switchRowPlain}>
              <Text style={styles.label}>⭐ חשובה</Text>
              <Switch
                trackColor={{ false: c.dark ? "#3A3A3C" : "#D1D1D6", true: c.accent }}
                thumbColor="#FFFFFF" value={!!edit.star} onValueChange={(v) => setEdit({ ...edit, star: v })} />
            </View>

            <Text style={styles.label}>תאריך יעד (לא חובה)</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.pickerBtnPlain, styles.flex1]}
                onPress={() => pickDate(edit.due, (d) => setEdit({ ...edit, due: d }), false)}
              >
                <Text style={styles.pickerBtnPlainText}>📅 {edit.due ? displayYMD(edit.due) : 'בחר תאריך'}</Text>
              </TouchableOpacity>
              {edit.due ? (
                <TouchableOpacity onPress={() => setEdit({ ...edit, due: undefined })} hitSlop={8}>
                  <Text style={styles.linkText}>הסר</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <ReminderEditor
              value={{ ...reminder, date: reminder.enabled ? reminder.date : edit.due ?? today }}
              onChange={setReminder}
              allowRepeat={false}
            />

            <Text style={styles.label}>🔁 משימה חוזרת (לא חובה)</Text>
            <View style={styles.daysRow}>
              {DAY_LETTERS.map((letter, d) => {
                const on = (edit.repeatDays ?? []).includes(d);
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dayChip, on && styles.dayChipOn]}
                    onPress={() =>
                      setEdit({
                        ...edit,
                        repeatDays: on
                          ? (edit.repeatDays ?? []).filter((x) => x !== d)
                          : [...(edit.repeatDays ?? []), d].sort(),
                      })
                    }
                  >
                    <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{letter}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {edit.repeatDays?.length ? (
              <Text style={styles.hintText}>אחרי סימון ✓ המשימה תחזור לבד ביום הבא שבחרת.</Text>
            ) : null}

            <Text style={styles.label}>📍 הזכר לי כשאני מגיע ל... (לא חובה)</Text>
            {areas.length === 0 ? (
              <Text style={styles.hintText}>עוד אין אזורים. אפשר להוסיף בטאב "שעונים".</Text>
            ) : (
              <View style={styles.chipsWrapRow}>
                {chip('ללא', !edit.areaId, () => setEdit({ ...edit, areaId: undefined }))}
                {areas.map((a) => chip(a.label, edit.areaId === a.id, () => setEdit({ ...edit, areaId: a.id })))}
              </View>
            )}

            {lists.length ? (
              <>
                <Text style={styles.label}>🗂 רשימה</Text>
                <View style={styles.chipsWrapRow}>
                  {chip('ללא', !edit.list, () => setEdit({ ...edit, list: undefined }))}
                  {lists.map((l) => chip(l.name, edit.list === l.id, () => setEdit({ ...edit, list: l.id })))}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>👤 איש קשר</Text>
            {edit.contact ? (
              <View style={styles.row}>
                <Text style={[styles.subtaskText, styles.flex1]}>
                  {edit.contact.name} · {edit.contact.phone}
                </Text>
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${edit.contact!.phone}`)} hitSlop={6}>
                  <Text style={{ fontSize: 20 }}>📞</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL(waLink(edit.contact!.phone))} hitSlop={6}>
                  <Text style={[styles.linkText, { fontSize: 15 }]}>WhatsApp</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEdit({ ...edit, contact: undefined })} hitSlop={8}>
                  <Text style={styles.removeX}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[styles.pickerBtnPlain, { marginBottom: 8 }]} onPress={attachContact}>
                <Text style={styles.pickerBtnPlainText}>👤 בחר איש קשר מהטלפון</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.label}>📷 תמונות</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {(edit.photos ?? []).map((u) => (
                <TouchableOpacity
                  key={u}
                  onPress={() => setPhoto(u)}
                  onLongPress={() =>
                    confirm('הסרת תמונה', 'להסיר את התמונה מהמשימה?', 'הסר', () => {
                      setEdit((e) => (e ? { ...e, photos: (e.photos ?? []).filter((x) => x !== u) } : e));
                      FileSystem.deleteAsync(u, { idempotent: true }).catch(() => {});
                    })
                  }
                >
                  <Image source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 10, marginEnd: 8 }} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.pickerBtnPlain, { marginEnd: 8, justifyContent: 'center' }]} onPress={() => addPhoto(true)}>
                <Text style={styles.pickerBtnPlainText}>📷 צלם</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pickerBtnPlain, { justifyContent: 'center' }]} onPress={() => addPhoto(false)}>
                <Text style={styles.pickerBtnPlainText}>🖼️ מהגלריה</Text>
              </TouchableOpacity>
            </ScrollView>

            <Text style={styles.label}>☑ תת-משימות</Text>
            {(edit.subtasks ?? []).map((s) => (
              <View key={s.id} style={styles.subtaskRow}>
                <TouchableOpacity
                  onPress={() =>
                    setEdit({
                      ...edit,
                      subtasks: (edit.subtasks ?? []).map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)),
                    })
                  }
                  style={[styles.checkbox, styles.taskCheckbox, s.done && styles.checkboxOn]}
                >
                  {s.done ? <Feather name="check" size={16} color="#FFFFFF" /> : null}
                </TouchableOpacity>
                <Text style={[styles.flex1, styles.subtaskText, s.done && styles.strike]}>{s.title}</Text>
                <TouchableOpacity
                  onPress={() => setEdit({ ...edit, subtasks: (edit.subtasks ?? []).filter((x) => x.id !== s.id) })}
                  hitSlop={8}
                >
                  <Text style={styles.removeX}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex1, styles.noMargin]}
                placeholder="שלב חדש..."
                placeholderTextColor={c.muted}
                value={newSub}
                onChangeText={setNewSub}
                onSubmitEditing={() => {
                  if (!newSub.trim()) return;
                  setEdit({ ...edit, subtasks: [...(edit.subtasks ?? []), { id: newId(), title: newSub.trim(), done: false }] });
                  setNewSub('');
                }}
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={styles.grayBtn}
                onPress={() => {
                  if (!newSub.trim()) return;
                  setEdit({ ...edit, subtasks: [...(edit.subtasks ?? []), { id: newId(), title: newSub.trim(), done: false }] });
                  setNewSub('');
                }}
              >
                <Text style={styles.grayBtnText}>+</Text>
              </TouchableOpacity>
            </View>

          </>
        ) : null}
      </PopupShell>

      {/* snooze */}
      <PopupShell visible={!!snooze} title={`⏭ לדחות את "${snooze?.title ?? ''}"`} onClose={() => setSnooze(null)} yellow={false}>
        {snooze ? (
          <>
            {(
              [
                ['מחר', addDays(today, 1)],
                ['בעוד 3 ימים', addDays(today, 3)],
                ['בעוד שבוע', addDays(today, 7)],
                ['בעוד חודש', addDays(today, 30)],
              ] as [string, string][]
            ).map(([label, d]) => (
              <TouchableOpacity key={label} style={styles.menuItem} onPress={() => doSnooze(snooze, d)}>
                <Text style={styles.menuItemText}>
                  {label} · {displayYMD(d)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.menuItem} onPress={() => pickDate(snooze.due, (d) => doSnooze(snooze, d))}>
              <Text style={styles.menuItemText}>📅 בחר תאריך…</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </PopupShell>

      {/* list create / rename */}
      <PopupShell visible={!!listForm} title={listForm?.id ? 'שינוי שם רשימה' : 'רשימה חדשה'} onClose={() => setListForm(null)} yellow={false}>
        {listForm ? (
          <>
            <TextInput
              style={styles.input}
              value={listForm.name}
              onChangeText={(t) => setListForm({ ...listForm, name: t })}
              placeholder="למשל: בית, עבודה, קניות"
              placeholderTextColor={c.muted}
              autoFocus
              onSubmitEditing={saveList}
            />
            <TouchableOpacity style={styles.greenBtnWide} onPress={saveList}>
              <Text style={styles.whiteBtnText}>שמור</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </PopupShell>

      <PopupShell visible={!!listMenu} title={listMenu?.name ?? ''} onClose={() => setListMenu(null)} yellow={false}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => {
            const l = listMenu;
            setListMenu(null);
            if (l) setListForm({ id: l.id, name: l.name });
          }}
        >
          <Text style={styles.menuItemText}>✏️  שינוי שם</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => {
            const l = listMenu;
            setListMenu(null);
            if (l) deleteList(l);
          }}
        >
          <Text style={[styles.menuItemText, styles.menuItemDanger]}>🗑️  מחיקת הרשימה</Text>
        </TouchableOpacity>
      </PopupShell>

      {/* templates */}
      <PopupShell visible={tplOpen} title="📋 תבניות" onClose={() => { setTplOpen(false); setTplForm(null); }} yellow={false}>
        {tplForm ? (
          <>
            <TextInput
              style={styles.input}
              value={tplForm.name}
              onChangeText={(t) => setTplForm({ ...tplForm, name: t })}
              placeholder="שם התבנית (למשל: אריזה לטיול)"
              placeholderTextColor={c.muted}
            />
            <TextInput
              style={[styles.input, styles.notesInput, { minHeight: 140 }]}
              value={tplForm.items}
              onChangeText={(t) => setTplForm({ ...tplForm, items: t })}
              placeholder={'משימה בכל שורה'}
              placeholderTextColor={c.muted}
              multiline
            />
            <TouchableOpacity
              style={styles.greenBtnWide}
              onPress={() =>
                saveTemplate(
                  tplForm.name,
                  tplForm.items.split('\n').map((x) => x.trim()).filter(Boolean)
                )
              }
            >
              <Text style={styles.whiteBtnText}>שמור תבנית</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {templates.length === 0 ? <Text style={styles.hintText}>אין עדיין תבניות.</Text> : null}
            {templates.map((tpl) => (
              <TouchableOpacity key={tpl.id} style={styles.menuItem} onPress={() => useTemplate(tpl)} onLongPress={() => deleteTemplate(tpl)}>
                <Text style={styles.menuItemText}>
                  📋  {tpl.name} ({tpl.items.length})
                </Text>
              </TouchableOpacity>
            ))}
            {templates.length ? (
              <Text style={styles.hintText}>לחיצה מוסיפה את כל המשימות{listId !== 'all' ? ' לרשימה הנוכחית' : ''}. לחיצה ארוכה מוחקת.</Text>
            ) : null}
            <TouchableOpacity style={styles.menuItem} onPress={() => setTplForm({ name: '', items: '' })}>
              <Text style={styles.menuItemText}>➕  תבנית חדשה</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const open = tasks.filter((t) => !t.done && inList(t));
                if (!open.length) return;
                setTplForm({
                  name: listId === 'all' ? '' : lists.find((l) => l.id === listId)?.name ?? '',
                  items: open.map((t) => t.title).join('\n'),
                });
              }}
            >
              <Text style={styles.menuItemText}>💾  צור תבנית מהמשימות הפתוחות</Text>
            </TouchableOpacity>
          </>
        )}
      </PopupShell>

      {/* history */}
      <PopupShell visible={historyOpen} title="📜 היסטוריה" onClose={() => setHistoryOpen(false)} yellow={false}>
        {(() => {
          const done = tasks
            .filter((t) => t.done && t.doneAt && inList(t))
            .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
          if (!done.length) return <Text style={styles.hintText}>עוד אין משימות שבוצעו.</Text>;
          const groups: { day: string; items: Task[] }[] = [];
          for (const t of done) {
            const day = localDateString(new Date(t.doneAt!));
            const g = groups[groups.length - 1];
            if (g && g.day === day) g.items.push(t);
            else groups.push({ day, items: [t] });
          }
          return groups.map((g) => (
            <View key={g.day} style={{ marginBottom: 10 }}>
              <Text style={styles.label}>
                {g.day === today ? 'היום' : displayYMD(g.day)} · {g.items.length}
              </Text>
              {g.items.map((t) => (
                <Text key={t.id} style={[styles.subtaskText, { marginBottom: 4 }]}>
                  ✓ {t.title}
                </Text>
              ))}
            </View>
          ));
        })()}
        <Text style={styles.hintText}>נשמרת שנה אחורה.</Text>
      </PopupShell>

      {/* settings */}
      <PopupShell visible={settingsOpen} title="⚙️ הגדרות משימות" onClose={() => setSettingsOpen(false)} yellow={false}>
        <View style={styles.switchRowPlain}>
          <Text style={styles.label}>☀️ סיכום בוקר</Text>
          <Switch
            trackColor={{ false: c.dark ? '#3A3A3C' : '#D1D1D6', true: c.accent }}
            thumbColor="#FFFFFF"
            value={morning.enabled}
            onValueChange={(v) => {
              const m = { ...morning, enabled: v };
              setMorning(m);
              saveMorning(m);
            }}
          />
        </View>
        {morning.enabled ? (
          <TouchableOpacity
            style={styles.pickerBtnPlain}
            onPress={() => {
              const [h, m] = parseHHMM(morning.time);
              pickTimeWheels(h, m, (hh, mm) => {
                const next = { ...morning, time: hhmm(hh, mm) };
                setMorning(next);
                saveMorning(next);
              });
            }}
          >
            <Text style={styles.pickerBtnPlainText}>🕒 {morning.time}</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.hintText}>
          התראה בכל בוקר עם המשימות של היום ומה שבאיחור. בימים בלי משימות לא תגיע התראה.
        </Text>
      </PopupShell>

      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }} onPress={() => setPhoto(null)}>
          {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: '85%' }} resizeMode="contain" /> : null}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
