import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Feather } from '@expo/vector-icons';
import { useAppStyles } from './appStyles';
import { useTheme } from './theme';
import { PopupShell, ReminderEditor, ReminderValue, confirm, emptyReminder } from './ui';
import { DAY_LETTERS, daysSummary, displayYMD, parseHHMM, parseYMD, pickDate } from './pickers';
import { cancelRing, scheduleReminder, taskRingId } from './rings';
import { syncGeofences } from './geoTask';
import { DocChips } from './docLinks';
import { AlarmArea, Task, loadAreas, loadTasks, localDateString, newId, saveTasks } from './storage';

const HISTORY_DAYS = 30;

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

  const today = localDateString();

  useEffect(() => {
    (async () => {
      const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
      const all = (await loadTasks()).filter((t) => !t.done || (t.doneAt ?? 0) > cutoff);
      setTasks(all);
      saveTasks(all);
      setAreas(await loadAreas());
    })();
  }, [dataVersion]);

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
  const addQuick = () => {
    const title = quick.trim();
    if (!title) return;
    const minOrder = tasks.reduce((m, t) => Math.min(m, t.order), 0);
    const t: Task = {
      id: newId(),
      title,
      done: false,
      createdAt: Date.now(),
      order: minOrder - 1,
      star: quickStar,
      due: quickDue,
      subtasks: [],
    };
    persist([t, ...tasks]);
    setQuick('');
    setQuickStar(false);
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
    const open = tasks.filter((t) => !t.done);
    if (!open.length) return;
    const lines = open.map((t) => `☐ ${t.star ? '⭐ ' : ''}${t.title}${t.due ? ` (${displayYMD(t.due)})` : ''}`);
    Share.share({ message: `המשימות שלי:\n${lines.join('\n')}` });
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
  const rows: Row[] = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    const out: Row[] = [];
    for (const key of SECTION_ORDER) {
      const list = open
        .filter((t) => sectionOf(t, today) === key)
        .sort((a, b) => Number(!!b.star) - Number(!!a.star) || a.order - b.order);
      if (!list.length) continue;
      out.push({ kind: 'header', key: `h-${key}`, title: SECTION_TITLES[key], count: list.length });
      for (const t of list) out.push({ kind: 'task', key: t.id, task: t });
    }
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    if (done.length) {
      out.push({ kind: 'header', key: 'h-done', title: `✓ בוצעו`, count: done.length });
      if (showDone) for (const t of done) out.push({ kind: 'task', key: t.id, task: t });
    }
    return out;
  }, [tasks, today, showDone]);

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
        renderRightActions={() => (
          <View style={[styles.swipeAction, styles.swipeDelete]}>
            <Text style={styles.swipeText}>🗑️</Text>
          </View>
        )}
        onSwipeableOpen={(direction, sw) => {
          sw.close();
          if (direction === 'left') complete(t);
          else remove(t);
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
              ]
                .filter(Boolean)
                .join('  ')}
            </Text>
          </View>
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
              <TouchableOpacity onPress={shareOpen} hitSlop={8}>
                <Text style={styles.linkText}>📤 שתף</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.card}>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.flex1, styles.noMargin]}
                  placeholder="משימה חדשה..."
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
                לחיצה ארוכה על משימה פותחת תפריט (מחיקה, שיתוף ועוד). אפשר גם להחליק: ימינה ✓, שמאלה 🗑️. לסידור, החזק את ☰ וגרור.
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

      <PopupShell visible={!!edit} title="משימה" onClose={() => setEdit(null)} yellow={false}>
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
          </>
        ) : null}
      </PopupShell>
    </View>
  );
}
