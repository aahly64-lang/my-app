import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useScreenFrame } from './ui';
import { useAppStyles } from './appStyles';
import { useTheme } from './theme';
import { GeoAlarm, DocEntry } from '../modules/geo-alarm';
import { htmlToPlain } from './richNote';
import { displayYMD, hhmm } from './pickers';
import {
  AlarmArea,
  AlarmClock,
  StickyNote,
  Task,
  loadAlarmClocks,
  loadAreas,
  loadDocFolders,
  loadDocMeta,
  loadTasks,
} from './storage';

/**
 * One search for the whole app: tasks, notes, documents (file names), alarm clocks and
 * location areas. Locked notes match by title only and never show their content.
 */
export interface SearchTargets {
  onTask: (t: Task) => void;
  onNote: (n: StickyNote) => void;
  onDoc: (d: DocEntry) => void;
  onAlarm: (a: AlarmClock) => void;
  onArea: (a: AlarmArea) => void;
}

const norm = (s: string) => s.toLowerCase().replace(/[֑-ׇ]/g, '');

export default function SearchScreen({
  visible,
  notes,
  onClose,
  targets,
}: {
  visible: boolean;
  notes: StickyNote[];
  onClose: () => void;
  targets: SearchTargets;
}) {
  const frame = useScreenFrame();
  const styles = useAppStyles();
  const c = useTheme();
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alarms, setAlarms] = useState<AlarmClock[]>([]);
  const [areas, setAreas] = useState<AlarmArea[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [lockedDocs, setLockedDocs] = useState<Set<string>>(new Set());
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setQ('');
      setDocs(null);
      return;
    }
    (async () => {
      setTasks(await loadTasks());
      setAlarms(await loadAlarmClocks());
      setAreas(await loadAreas());
      setRoots((await loadDocFolders()).map((f) => f.uri));
      const meta = await loadDocMeta();
      setLockedDocs(new Set(Object.keys(meta).filter((k) => meta[k]?.locked)));
    })();
  }, [visible]);

  const query = norm(q.trim());

  // documents: searched in the connected folders (by file name), debounced
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.length < 2 || roots.length === 0) {
      setDocs(null);
      setDocsBusy(false);
      return;
    }
    setDocsBusy(true);
    timer.current = setTimeout(async () => {
      const r = await GeoAlarm.searchDocuments(roots, q.trim(), 30);
      setDocs(r.filter((d) => !d.isDir));
      setDocsBusy(false);
    }, 400);
  }, [query, roots]);

  const found = useMemo(() => {
    if (query.length < 1) return null;
    const has = (...parts: (string | undefined)[]) => parts.some((p) => p && norm(p).includes(query));
    return {
      tasks: tasks
        .filter((t) => has(t.title, t.notes, t.contact?.name, ...(t.subtasks ?? []).map((s) => s.title)))
        .sort((a, b) => Number(a.done) - Number(b.done))
        .slice(0, 30),
      notes: notes
        .filter((n) => (n.locked ? has(n.title) : has(n.title, n.body, n.html ? htmlToPlain(n.html) : undefined)))
        .slice(0, 30),
      alarms: alarms.filter((a) => has(a.label)),
      areas: areas.filter((a) => has(a.label)),
    };
  }, [query, tasks, notes, alarms, areas]);

  const snippet = (text: string | undefined) => {
    if (!text) return '';
    const plain = text.replace(/\s+/g, ' ');
    const i = norm(plain).indexOf(query);
    if (i < 0) return plain.slice(0, 80);
    const start = Math.max(0, i - 30);
    return (start > 0 ? '…' : '') + plain.slice(start, i + 60);
  };

  const Row = ({ icon, title, sub, onPress }: { icon: string; title: string; sub?: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <Text style={{ fontSize: 15.5, fontWeight: '600', color: c.text, textAlign: 'right' }} numberOfLines={1}>
        {icon} {title}
      </Text>
      {sub ? (
        <Text style={[styles.itemSub, { textAlign: 'right', marginTop: 3 }]} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  const Group = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) =>
    count ? (
      <View style={{ marginBottom: 8 }}>
        <Text style={[styles.sectionTitle, { fontSize: 17, marginTop: 6 }]}>
          {title} ({count})
        </Text>
        {children}
      </View>
    ) : null;

  const total =
    (found?.tasks.length ?? 0) +
    (found?.notes.length ?? 0) +
    (found?.alarms.length ?? 0) +
    (found?.areas.length ?? 0) +
    (docs?.length ?? 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[{ flex: 1, backgroundColor: c.bg, paddingTop: 16 }, frame.root]}>
        <View style={[styles.row, { paddingHorizontal: 16, marginBottom: 10 }]}>
          <TextInput
            style={[styles.input, styles.flex1, styles.noMargin]}
            placeholder="🔍 חיפוש בכל האפליקציה..."
            placeholderTextColor={c.muted}
            value={q}
            onChangeText={setQ}
            autoFocus
            returnKeyType="search"
          />
          <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 10 }}>
            <Feather name="x" size={22} color={c.text} />
          </TouchableOpacity>
        </View>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: frame.bottomSpace }}
          keyboardShouldPersistTaps="handled"
        >
          {!found ? (
            <Text style={[styles.itemSub, { textAlign: 'center', marginTop: 30, fontSize: 14 }]}>
              מחפש במשימות, בפתקים, בשמות המסמכים, בשעונים ובאזורים.
            </Text>
          ) : null}
          {found && total === 0 && !docsBusy ? (
            <Text style={[styles.itemSub, { textAlign: 'center', marginTop: 30, fontSize: 14 }]}>לא נמצא כלום.</Text>
          ) : null}
          {found ? (
            <>
              <Group title="✅ משימות" count={found.tasks.length}>
                {found.tasks.map((t) => (
                  <Row
                    key={t.id}
                    icon={t.done ? '☑' : '○'}
                    title={t.title}
                    sub={[t.due ? `📅 ${displayYMD(t.due)}` : '', t.notes ? snippet(t.notes) : ''].filter(Boolean).join(' · ')}
                    onPress={() => targets.onTask(t)}
                  />
                ))}
              </Group>
              <Group title="📝 פתקים" count={found.notes.length}>
                {found.notes.map((n) => (
                  <Row
                    key={n.id}
                    icon={n.locked ? '🔒' : '📝'}
                    title={n.title || 'פתק'}
                    sub={n.locked ? 'פתק נעול' : snippet(n.html ? htmlToPlain(n.html) : n.body)}
                    onPress={() => targets.onNote(n)}
                  />
                ))}
              </Group>
              <Group title="📁 מסמכים" count={(docs ?? []).filter((d) => !lockedDocs.has(d.uri)).length}>
                {(docs ?? []).filter((d) => !lockedDocs.has(d.uri)).map((d) => (
                  <Row
                    key={d.uri}
                    icon={lockedDocs.has(d.uri) ? '🔒' : '📄'}
                    title={d.name}
                    sub={d.folder}
                    onPress={() => targets.onDoc(d)}
                  />
                ))}
              </Group>
              {docsBusy ? <ActivityIndicator style={{ marginVertical: 10 }} color={c.accent} /> : null}
              <Group title="⏰ שעונים" count={found.alarms.length}>
                {found.alarms.map((a) => (
                  <Row key={a.id} icon="⏰" title={`${hhmm(a.hour, a.minute)}  ${a.label}`} onPress={() => targets.onAlarm(a)} />
                ))}
              </Group>
              <Group title="📍 אזורים" count={found.areas.length}>
                {found.areas.map((a) => (
                  <Row key={a.id} icon="📍" title={a.label} onPress={() => targets.onArea(a)} />
                ))}
              </Group>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
