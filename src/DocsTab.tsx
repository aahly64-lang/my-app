import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { DocEntry, GeoAlarm } from '../modules/geo-alarm';
import { Palette, cardShadow, useTheme, useThemedStyles } from './theme';
import { PopupShell, confirm } from './ui';
import { docIcon } from './docLinks';
import { displayYMD, pickDate } from './pickers';
import { cancelRing, scheduleReminder } from './rings';
import {
  DocFolder,
  DocLink,
  DocMeta,
  RecentDoc,
  Task,
  loadDocFolders,
  loadDocMeta,
  loadDocRecent,
  loadDocView,
  loadTasks,
  newId,
  saveDocFolders,
  saveDocMeta,
  saveDocRecent,
  saveDocView,
  saveTasks,
} from './storage';

// ---------------------------------------------------------------- helpers

type TypeFilter = 'all' | 'pdf' | 'image' | 'word' | 'excel' | 'other';
const FILTERS: [TypeFilter, string][] = [
  ['all', 'הכל'],
  ['pdf', '📕 PDF'],
  ['image', '🖼️ תמונות'],
  ['word', '📄 Word'],
  ['excel', '📊 Excel'],
  ['other', '📎 אחר'],
];

function typeOf(mime: string): Exclude<TypeFilter, 'all'> {
  const m = mime || '';
  if (m.includes('pdf')) return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return 'excel';
  if (m.includes('word') || m.includes('wordprocessing') || m.includes('msword') || m.includes('opendocument.text') || m.startsWith('text/'))
    return 'word';
  return 'other';
}

const TYPE_COLORS: Record<Exclude<TypeFilter, 'all'>, string> = {
  pdf: '#E5484D',
  image: '#3E8EF7',
  word: '#2B5FD9',
  excel: '#1F9D55',
  other: '#8E8E93',
};

function passes(f: TypeFilter, mime: string, isDir: boolean) {
  if (f === 'all') return true;
  if (isDir) return false;
  return typeOf(mime) === f;
}

function sizeText(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
const docRingId = (uri: string) => `doc:${hash(uri)}`;

function daysUntil(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function expiryText(ymd: string) {
  const n = daysUntil(ymd);
  if (n < 0) return { text: `פג תוקף לפני ${-n} ימים`, bad: true };
  if (n === 0) return { text: 'פג תוקף היום', bad: true };
  if (n <= 30) return { text: `בתוקף עוד ${n} ימים`, bad: true };
  return { text: `בתוקף עד ${displayYMD(ymd)}`, bad: false };
}

async function scheduleExpiry(uri: string, meta: DocMeta) {
  const id = docRingId(uri);
  cancelRing(id);
  if (!meta.expiry || !meta.remindDays) return false;
  const [y, m, d] = meta.expiry.split('-').map(Number);
  const at = new Date(y, m - 1, d - meta.remindDays, 9, 0, 0).getTime();
  return scheduleReminder({
    id,
    title: `⏰ תוקף מסמך: ${meta.name}`,
    body: `התוקף מסתיים ב-${displayYMD(meta.expiry)} (בעוד ${meta.remindDays} ימים)`,
    silent: false,
    once: { at },
  });
}

/** Thumbnails are cached for the whole session. */
const thumbCache = new Map<string, string | null>();

function Thumb({ e, size, styles }: { e: DocEntry; size: number; styles: ReturnType<typeof makeStyles> }) {
  const key = `${e.uri}|${e.modified}`;
  const [uri, setUri] = useState<string | null | undefined>(thumbCache.get(key));
  const t = typeOf(e.mime);
  useEffect(() => {
    if (e.isDir || (t !== 'image' && t !== 'pdf') || thumbCache.has(key)) return;
    let alive = true;
    GeoAlarm.documentThumbnail(e.uri, e.mime, 320, e.modified || 0).then((r) => {
      thumbCache.set(key, r);
      if (alive) setUri(r);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  if (uri) return <Image source={{ uri }} style={[styles.thumbImg, { width: size, height: size }]} resizeMode="cover" />;
  return (
    <View style={[styles.thumbIcon, { width: size, height: size }]}>
      <Text style={{ fontSize: size * 0.42 }}>{docIcon(e.mime, e.isDir)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- component

interface Props {
  dataVersion: number;
  notes: { id: string; title: string }[];
  onAttachToNote: (noteId: string, link: DocLink) => void;
}

export default function DocsTab({ dataVersion, notes, onAttachToNote }: Props) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [path, setPath] = useState<DocFolder[]>([]); // browsing stack
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [broken, setBroken] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<DocEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [meta, setMeta] = useState<Record<string, DocMeta>>({});
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [menu, setMenu] = useState<DocEntry | null>(null);
  const [panel, setPanel] = useState<'menu' | 'rename' | 'expiry' | 'link'>('menu');
  const [renameText, setRenameText] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null); // multi-select
  const [scanPick, setScanPick] = useState<{ uri: string; name: string } | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null); // name being typed
  const [scanBusy, setScanBusy] = useState(false);
  const [width, setWidth] = useState(360);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadDocFolders().then(setFolders);
    loadDocMeta().then(setMeta);
    loadDocRecent().then(setRecent);
    loadDocView().then(setView);
    setPath([]);
  }, [dataVersion]);

  const current = path[path.length - 1];

  const refresh = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    const list = await GeoAlarm.listDocuments(current.uri);
    setLoading(false);
    if (list === null) {
      setBroken(true);
      setEntries([]);
    } else {
      setBroken(false);
      setEntries(list);
    }
  }, [current]);

  useEffect(() => {
    setSearch('');
    setResults(null);
    setSelected(null);
    refresh();
  }, [refresh]);

  // Global search (home screen): all connected folders, including sub-folders.
  useEffect(() => {
    if (current) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = search.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const r = await GeoAlarm.searchDocuments(
        folders.map((f) => f.uri),
        q,
        300
      );
      setResults(r);
      setSearching(false);
    }, 450);
  }, [search, current, folders]);

  const updateMeta = async (uri: string, patch: Partial<DocMeta> | null, base?: { name: string; mime: string }) => {
    const next = { ...meta };
    if (patch === null) delete next[uri];
    else next[uri] = { ...(next[uri] ?? { name: base?.name ?? '', mime: base?.mime ?? '' }), ...patch };
    setMeta(next);
    await saveDocMeta(next);
    return next[uri];
  };

  const rememberOpen = async (e: DocEntry) => {
    const next = [{ uri: e.uri, name: e.name, mime: e.mime, at: Date.now() }, ...recent.filter((r) => r.uri !== e.uri)].slice(0, 20);
    setRecent(next);
    await saveDocRecent(next);
  };

  const openEntry = (e: DocEntry) => {
    if (selected && !e.isDir) {
      const s = new Set(selected);
      if (s.has(e.uri)) s.delete(e.uri);
      else s.add(e.uri);
      setSelected(s);
      return;
    }
    if (e.isDir) {
      setPath([...path, { uri: e.uri, name: e.name }]);
      return;
    }
    if (!GeoAlarm.openDocument(e.uri, e.mime)) {
      Alert.alert('לא ניתן לפתוח', 'הקובץ לא נמצא (אולי הוזז או נמחק), או שאין אפליקציה שפותחת אותו.');
      return;
    }
    rememberOpen(e);
  };

  // ---------- folders ----------
  const connectFolder = async () => {
    try {
      const r = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!r.granted) return;
      if (folders.some((f) => f.uri === r.directoryUri)) {
        Alert.alert('כבר מחוברת', 'התיקייה הזו כבר מופיעה ברשימה.');
        return;
      }
      const next = [...folders, { uri: r.directoryUri, name: GeoAlarm.documentFolderName(r.directoryUri) }];
      setFolders(next);
      saveDocFolders(next);
    } catch {
      Alert.alert('שגיאה', 'לא הצלחתי לחבר את התיקייה.');
    }
  };

  const createFolder = async () => {
    const name = (newFolder ?? '').trim().replace(/[\\/:*?"<>|]/g, '');
    if (!current || !name) return;
    if (entries.some((e) => e.isDir && e.name === name)) {
      Alert.alert('תיקייה חדשה', `כבר יש כאן תיקייה בשם "${name}".`);
      return;
    }
    const uri = await GeoAlarm.createFolder(current.uri, name);
    setNewFolder(null);
    if (!uri) {
      Alert.alert('תיקייה חדשה', 'לא הצלחתי ליצור את התיקייה. ייתכן שאין הרשאת כתיבה – נתק וחבר את התיקייה שוב.');
      return;
    }
    refresh();
  };

  const disconnect = (f: DocFolder) => {
    confirm('ניתוק תיקייה', `לנתק את "${f.name}"? הקבצים עצמם לא יימחקו.`, 'נתק', () => {
      GeoAlarm.releaseFolder(f.uri);
      const next = folders.filter((x) => x.uri !== f.uri);
      setFolders(next);
      saveDocFolders(next);
      setPath([]);
    });
  };

  // ---------- scanning ----------
  const scan = async () => {
    if (folders.length === 0) {
      Alert.alert('סריקת מסמך', 'קודם חבר תיקייה שבה יישמרו הסריקות (למשל "מסמכים").');
      return;
    }
    let r: { uri: string; pages: number } | null = null;
    setScanBusy(true);
    try {
      r = await GeoAlarm.scanDocument();
    } catch (e: any) {
      Alert.alert('סריקת מסמך', 'הסורק לא זמין בטלפון: ' + (e?.message ?? ''));
      return;
    } finally {
      setScanBusy(false);
    }
    if (!r) return;
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `סריקה ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
    if (current) await saveScan(r.uri, name, current);
    else if (folders.length === 1) await saveScan(r.uri, name, folders[0]);
    else setScanPick({ uri: r.uri, name });
  };

  const saveScan = async (src: string, name: string, folder: DocFolder) => {
    setScanPick(null);
    const created = await GeoAlarm.copyIntoFolder(src, folder.uri, name + '.pdf', 'application/pdf');
    if (!created) {
      Alert.alert('סריקת מסמך', `לא הצלחתי לשמור בתיקייה "${folder.name}". ייתכן שאין הרשאת כתיבה – נתק וחבר אותה שוב.`);
      return;
    }
    if (current) refresh();
    const entry: DocEntry = { uri: created, name: name + '.pdf', mime: 'application/pdf', isDir: false, size: 0, modified: Date.now() };
    rememberOpen(entry);
    Alert.alert('נשמר ✓', `"${name}.pdf" נשמר בתיקייה "${folder.name}".`, [
      { text: 'סגור', style: 'cancel' },
      { text: 'פעולות נוספות', onPress: () => openMenu(entry) },
      { text: 'פתח', onPress: () => GeoAlarm.openDocument(created, 'application/pdf') },
    ]);
  };

  // ---------- item menu ----------
  const openMenu = (e: DocEntry) => {
    if (e.isDir) return;
    setMenu(e);
    setPanel('menu');
  };
  const closeMenu = () => setMenu(null);

  const toggleFav = async (e: DocEntry) => {
    const fav = !meta[e.uri]?.fav;
    const m = await updateMeta(e.uri, { fav, name: e.name, mime: e.mime }, e);
    if (m && !m.fav && !m.expiry) await updateMeta(e.uri, null);
  };

  const doRename = async () => {
    if (!menu) return;
    let name = renameText.trim();
    if (!name) return;
    const ext = menu.name.includes('.') ? menu.name.slice(menu.name.lastIndexOf('.')) : '';
    if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
    const newUri = GeoAlarm.renameDocument(menu.uri, name);
    if (!newUri) {
      Alert.alert('שינוי שם', 'לא הצלחתי לשנות את השם. ייתכן שאין הרשאת כתיבה לתיקייה.');
      return;
    }
    // move meta / recent to the new uri
    if (meta[menu.uri]) {
      const next = { ...meta, [newUri]: { ...meta[menu.uri], name } };
      if (newUri !== menu.uri) delete next[menu.uri];
      setMeta(next);
      await saveDocMeta(next);
    }
    const rec = recent.map((r) => (r.uri === menu.uri ? { ...r, uri: newUri, name } : r));
    setRecent(rec);
    await saveDocRecent(rec);
    closeMenu();
    refresh();
    if (results) setResults(results.map((r) => (r.uri === menu.uri ? { ...r, uri: newUri, name } : r)));
  };

  const forget = async (uris: string[]) => {
    const m = { ...meta };
    uris.forEach((u) => {
      cancelRing(docRingId(u));
      delete m[u];
    });
    setMeta(m);
    await saveDocMeta(m);
    const rec = recent.filter((r) => !uris.includes(r.uri));
    setRecent(rec);
    await saveDocRecent(rec);
  };

  const doDelete = (e: DocEntry) => {
    confirm('מחיקת קובץ', `למחוק את "${e.name}" מהטלפון? אי אפשר לבטל את זה.`, 'מחק', async () => {
      if (!GeoAlarm.deleteDocument(e.uri)) {
        Alert.alert('מחיקה', 'לא הצלחתי למחוק. ייתכן שאין הרשאת כתיבה לתיקייה.');
        return;
      }
      await forget([e.uri]);
      closeMenu();
      refresh();
      if (results) setResults(results.filter((r) => r.uri !== e.uri));
    });
  };

  const setExpiry = (e: DocEntry) => {
    pickDate(meta[e.uri]?.expiry, async (ymd) => {
      const m = await updateMeta(e.uri, { expiry: ymd, remindDays: meta[e.uri]?.remindDays ?? 30, name: e.name, mime: e.mime }, e);
      if (m) await scheduleExpiry(e.uri, m);
    }, false);
  };

  const setRemindDays = async (e: DocEntry, days: number) => {
    const m = await updateMeta(e.uri, { remindDays: days }, e);
    if (m && m.expiry) {
      const ok = await scheduleExpiry(e.uri, m);
      if (days && !ok) Alert.alert('תזכורת', 'מועד התזכורת כבר עבר, ולכן לא נקבעה תזכורת.');
    }
  };

  const clearExpiry = async (e: DocEntry) => {
    cancelRing(docRingId(e.uri));
    const m = await updateMeta(e.uri, { expiry: undefined, remindDays: undefined }, e);
    if (m && !m.fav) await updateMeta(e.uri, null);
  };

  const linkToTask = async (e: DocEntry, taskId: string | null) => {
    const link: DocLink = { uri: e.uri, name: e.name, mime: e.mime };
    const tasks = await loadTasks();
    let next: Task[];
    if (taskId) {
      next = tasks.map((t) =>
        t.id === taskId ? { ...t, docs: [...(t.docs ?? []).filter((d) => d.uri !== e.uri), link] } : t
      );
    } else {
      const minOrder = tasks.reduce((m, t) => Math.min(m, t.order ?? 0), 0);
      next = [
        {
          id: newId(),
          title: e.name.replace(/\.[^.]+$/, ''),
          done: false,
          createdAt: Date.now(),
          order: minOrder - 1,
          docs: [link],
        },
        ...tasks,
      ];
    }
    await saveTasks(next);
    closeMenu();
    Alert.alert('קושר ✓', taskId ? 'המסמך צורף למשימה.' : 'נוצרה משימה חדשה עם המסמך.');
  };

  const linkToNote = (e: DocEntry, noteId: string) => {
    onAttachToNote(noteId, { uri: e.uri, name: e.name, mime: e.mime });
    closeMenu();
    Alert.alert('קושר ✓', 'המסמך צורף לפתק.');
  };

  // ---------- multi select ----------
  const shareSelected = () => {
    if (!selected || selected.size === 0) return;
    const list = (current ? entries : results ?? []).filter((e) => selected.has(e.uri));
    GeoAlarm.shareDocuments(
      list.map((e) => e.uri),
      list.map((e) => e.mime)
    );
  };
  const deleteSelected = () => {
    if (!selected || selected.size === 0) return;
    confirm('מחיקת קבצים', `למחוק ${selected.size} קבצים מהטלפון? אי אפשר לבטל את זה.`, 'מחק', async () => {
      const uris = [...selected];
      const failed = uris.filter((u) => !GeoAlarm.deleteDocument(u));
      await forget(uris.filter((u) => !failed.includes(u)));
      setSelected(null);
      refresh();
      if (failed.length) Alert.alert('מחיקה', `${failed.length} קבצים לא נמחקו.`);
    });
  };

  const switchView = (v: 'list' | 'grid') => {
    setView(v);
    saveDocView(v);
  };

  // ---------- data for the lists ----------
  const shownEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter(
      (e) => !e.name.startsWith('.') && (!q || e.name.toLowerCase().includes(q)) && passes(filter, e.mime, e.isDir)
    );
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sortBy === 'date') return b.modified - a.modified;
      return a.name.localeCompare(b.name, 'he');
    });
  }, [entries, search, sortBy, filter]);

  const shownResults = useMemo(
    () => (results ?? []).filter((e) => passes(filter, e.mime, e.isDir)),
    [results, filter]
  );

  const favs = useMemo(
    () =>
      Object.entries(meta)
        .filter(([, m]) => m.fav && passes(filter, m.mime, false))
        .map(([uri, m]) => ({ uri, name: m.name, mime: m.mime, isDir: false, size: 0, modified: 0 } as DocEntry)),
    [meta, filter]
  );
  const expiring = useMemo(
    () =>
      Object.entries(meta)
        .filter(([, m]) => m.expiry && daysUntil(m.expiry) <= 60)
        .sort((a, b) => (a[1].expiry! < b[1].expiry! ? -1 : 1))
        .map(([uri, m]) => ({ uri, name: m.name, mime: m.mime, isDir: false, size: 0, modified: 0 } as DocEntry)),
    [meta]
  );
  const recentShown = useMemo(
    () =>
      recent
        .filter((r) => passes(filter, r.mime, false))
        .slice(0, 6)
        .map((r) => ({ uri: r.uri, name: r.name, mime: r.mime, isDir: false, size: 0, modified: 0 } as DocEntry)),
    [recent, filter]
  );

  // ---------- rendering ----------
  const cols = 3;
  const cell = Math.floor((width - 32 - (cols - 1) * 10) / cols);

  const subLine = (e: DocEntry) => {
    const parts: string[] = [];
    if (e.folder) parts.push('📂 ' + e.folder);
    if (e.size) parts.push(sizeText(e.size));
    if (e.modified) parts.push(new Date(e.modified).toLocaleDateString('he-IL'));
    return parts.join(' · ');
  };

  const badges = (e: DocEntry) => {
    const m = meta[e.uri];
    if (!m) return null;
    const ex = m.expiry ? expiryText(m.expiry) : null;
    return (
      <View style={styles.badgeRow}>
        {m.fav ? <Text style={styles.favMark}>⭐</Text> : null}
        {ex ? <Text style={[styles.expiryBadge, ex.bad && styles.expiryBad]}>⏰ {ex.text}</Text> : null}
      </View>
    );
  };

  const row = (e: DocEntry) => {
    const sel = selected?.has(e.uri);
    const t = e.isDir ? null : typeOf(e.mime);
    return (
      <TouchableOpacity
        key={e.uri}
        style={[styles.row, sel && styles.rowSel]}
        onPress={() => openEntry(e)}
        onLongPress={() => openMenu(e)}
        delayLongPress={300}
      >
        {selected && !e.isDir ? <View style={[styles.check, sel && styles.checkOn]}>{sel ? <Text style={styles.checkMark}>✓</Text> : null}</View> : null}
        <View style={[styles.typeStripe, { backgroundColor: t ? TYPE_COLORS[t] : 'transparent' }]} />
        <Thumb e={e} size={44} styles={styles} />
        <View style={styles.flex1}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {e.name}
          </Text>
          {subLine(e) ? <Text style={styles.rowSub} numberOfLines={1}>{subLine(e)}</Text> : null}
          {badges(e)}
        </View>
        {e.isDir ? (
          <Text style={styles.chev}>‹</Text>
        ) : !selected ? (
          <TouchableOpacity onPress={() => openMenu(e)} hitSlop={12} style={styles.moreBtn}>
            <Text style={styles.moreText}>⋮</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

  const tile = (e: DocEntry) => {
    const sel = selected?.has(e.uri);
    return (
      <TouchableOpacity
        key={e.uri}
        style={[styles.tile, { width: cell }, sel && styles.rowSel]}
        onPress={() => openEntry(e)}
        onLongPress={() => openMenu(e)}
        delayLongPress={300}
      >
        <Thumb e={e} size={cell - 12} styles={styles} />
        {meta[e.uri]?.fav ? <Text style={styles.tileFav}>⭐</Text> : null}
        {sel ? (
          <View style={[styles.check, styles.checkOn, styles.tileCheck]}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        ) : null}
        <Text style={styles.tileName} numberOfLines={2}>
          {e.name}
        </Text>
      </TouchableOpacity>
    );
  };

  const items = (list: DocEntry[]) =>
    view === 'grid' ? <View style={styles.grid}>{list.map(tile)}</View> : <View>{list.map(row)}</View>;

  const filterBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} keyboardShouldPersistTaps="handled">
      {FILTERS.map(([k, label]) => (
        <TouchableOpacity key={k} style={[styles.chip, filter === k && styles.chipOn]} onPress={() => setFilter(k)}>
          <Text style={[styles.chipText, filter === k && styles.chipTextOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const viewToggle = (
    <View style={styles.viewToggle}>
      {(
        [
          ['list', '☰'],
          ['grid', '▦'],
        ] as ['list' | 'grid', string][]
      ).map(([k, icon]) => (
        <TouchableOpacity key={k} style={[styles.viewBtn, view === k && styles.viewBtnOn]} onPress={() => switchView(k)}>
          <Text style={[styles.viewBtnText, view === k && styles.chipTextOn]}>{icon}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const selectBar = selected ? (
    <View style={styles.selectBar}>
      <Text style={styles.selectText}>נבחרו {selected.size}</Text>
      <TouchableOpacity style={styles.selectBtn} onPress={shareSelected}>
        <Text style={styles.selectBtnText}>📤 שתף</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.selectBtn} onPress={deleteSelected}>
        <Text style={[styles.selectBtnText, styles.danger]}>🗑️ מחק</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.selectBtn} onPress={() => setSelected(null)}>
        <Text style={styles.selectBtnText}>ביטול</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  const m = menu ? meta[menu.uri] : undefined;
  const menuPopup = (
    <PopupShell visible={!!menu} title={menu?.name ?? ''} onClose={closeMenu} yellow={false}>
      {menu && panel === 'menu' ? (
        <>
          <MenuItem styles={styles} label="📂  פתח" onPress={() => { const e = menu; closeMenu(); openEntry(e); }} />
          <MenuItem styles={styles} label={m?.fav ? '☆  הסר ממועדפים' : '⭐  הוסף למועדפים'} onPress={() => toggleFav(menu)} />
          <MenuItem
            styles={styles}
            label={m?.expiry ? `⏰  תוקף: ${displayYMD(m.expiry)}` : '⏰  קבע תוקף ותזכורת'}
            onPress={() => setPanel('expiry')}
          />
          <MenuItem styles={styles} label="🔗  צרף למשימה או לפתק" onPress={() => setPanel('link')} />
          <MenuItem styles={styles} label="📤  שיתוף" onPress={() => GeoAlarm.shareDocument(menu.uri, menu.mime)} />
          <MenuItem
            styles={styles}
            label="✏️  שינוי שם"
            onPress={() => {
              setRenameText(menu.name.replace(/\.[^.]+$/, ''));
              setPanel('rename');
            }}
          />
          <MenuItem
            styles={styles}
            label="☑️  בחירה מרובה"
            onPress={() => {
              setSelected(new Set([menu.uri]));
              closeMenu();
            }}
          />
          <MenuItem styles={styles} label="🗑️  מחיקה" danger onPress={() => doDelete(menu)} />
        </>
      ) : null}

      {menu && panel === 'rename' ? (
        <>
          <TextInput style={styles.input} value={renameText} onChangeText={setRenameText} autoFocus placeholderTextColor={c.muted} />
          <TouchableOpacity style={styles.bigBtn} onPress={doRename}>
            <Text style={styles.bigBtnText}>שמור</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {menu && panel === 'expiry' ? (
        <>
          <Text style={styles.hint}>מתי המסמך מפסיק להיות בתוקף? (ביטוח, רישיון, אחריות...)</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setExpiry(menu)}>
            <Text style={styles.dateBtnText}>📅 {m?.expiry ? displayYMD(m.expiry) : 'בחר תאריך'}</Text>
          </TouchableOpacity>
          {m?.expiry ? (
            <>
              <Text style={styles.label}>תזכורת לפני</Text>
              <View style={styles.chipsWrap}>
                {[0, 7, 14, 30, 60].map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.chip, (m.remindDays ?? 0) === d && styles.chipOn]}
                    onPress={() => setRemindDays(menu, d)}
                  >
                    <Text style={[styles.chipText, (m.remindDays ?? 0) === d && styles.chipTextOn]}>
                      {d === 0 ? 'בלי' : `${d} ימים`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.hint}>התזכורת תצלצל ב-9:00 בבוקר.</Text>
              <MenuItem styles={styles} label="🗑️  הסר תוקף" danger onPress={() => clearExpiry(menu)} />
            </>
          ) : null}
          <TouchableOpacity style={styles.bigBtn} onPress={() => setPanel('menu')}>
            <Text style={styles.bigBtnText}>סיום</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {menu && panel === 'link' ? <LinkPanel e={menu} notes={notes} styles={styles} onTask={linkToTask} onNote={linkToNote} /> : null}
    </PopupShell>
  );

  const scanPopup = (
    <PopupShell visible={!!scanPick} title="📷 לאיזו תיקייה לשמור?" onClose={() => setScanPick(null)} yellow={false}>
      {folders.map((f) => (
        <MenuItem key={f.uri} styles={styles} label={`📂  ${f.name}`} onPress={() => scanPick && saveScan(scanPick.uri, scanPick.name, f)} />
      ))}
      <Text style={styles.popupHint}>לשמירה בתת-תיקייה: היכנס אליה ולחץ "סרוק לכאן".</Text>
    </PopupShell>
  );

  const newFolderPopup = (
    <PopupShell visible={newFolder !== null} title="📁 תיקייה חדשה" onClose={() => setNewFolder(null)} yellow={false}>
      <TextInput
        style={[styles.input, { marginBottom: 12 }]}
        placeholder="שם התיקייה"
        placeholderTextColor={c.muted}
        value={newFolder ?? ''}
        onChangeText={setNewFolder}
        autoFocus
        onSubmitEditing={createFolder}
      />
      <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={createFolder}>
        <Text style={styles.actionPrimaryText}>צור תיקייה</Text>
      </TouchableOpacity>
    </PopupShell>
  );

  // ---------- home ----------
  if (!current) {
    const showingSearch = search.trim().length >= 2;
    return (
      <View style={styles.flex1} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <Text style={styles.title}>מסמכים</Text>
            {viewToggle}
          </View>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={scan}>
              <Text style={styles.actionPrimaryText}>📷 סרוק מסמך</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={connectFolder}>
              <Text style={styles.actionText}>+ חבר תיקייה</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() =>
                Alert.alert(
                  '📁 תיקייה חדשה',
                  'בחלון שייפתח, עבור למקום הרצוי (למשל "מסמכים"), לחץ על ⋮ או על סמל התיקייה עם +, בחר "תיקייה חדשה", תן שם, ואז "השתמש בתיקייה זו" ו"אפשר". התיקייה תופיע כאן ברשימה הראשית.',
                  [
                    { text: 'ביטול', style: 'cancel' },
                    { text: 'המשך', onPress: connectFolder },
                  ]
                )
              }
            >
              <Text style={styles.actionText}>📁 תיקייה חדשה</Text>
            </TouchableOpacity>
          </View>
          {scanBusy ? <Text style={styles.popupHint}>⏳ משפר את הדפים הסרוקים…</Text> : null}
          <TextInput
            style={styles.input}
            placeholder="🔍 חיפוש בכל התיקיות"
            placeholderTextColor={c.muted}
            value={search}
            onChangeText={setSearch}
          />
          {filterBar}

          {showingSearch ? (
            <>
              <Text style={styles.section}>
                תוצאות חיפוש {searching ? '' : `(${shownResults.length})`}
              </Text>
              {searching ? <ActivityIndicator style={styles.spinner} /> : null}
              {!searching && shownResults.length === 0 ? <Text style={styles.empty}>לא נמצאו קבצים.</Text> : null}
              {!searching ? items(shownResults) : null}
            </>
          ) : (
            <>
              {expiring.length ? (
                <>
                  <Text style={styles.section}>⏰ תוקף מתקרב</Text>
                  <View>{expiring.map(row)}</View>
                </>
              ) : null}
              {favs.length ? (
                <>
                  <Text style={styles.section}>⭐ מועדפים</Text>
                  {items(favs)}
                </>
              ) : null}
              {recentShown.length ? (
                <>
                  <Text style={styles.section}>🕘 נפתחו לאחרונה</Text>
                  {items(recentShown)}
                </>
              ) : null}
              <Text style={styles.section}>📂 תיקיות</Text>
              {folders.length === 0 ? (
                <Text style={styles.empty}>
                  חבר תיקייה מהטלפון (למשל "מסמכים" או "הורדות"). הקבצים מוצגים כמו שהם, בלי העתקה.
                </Text>
              ) : null}
              {folders.map((f) => (
                <TouchableOpacity key={f.uri} style={styles.row} onPress={() => setPath([f])} onLongPress={() => disconnect(f)}>
                  <Text style={styles.folderIcon}>📂</Text>
                  <View style={styles.flex1}>
                    <Text style={styles.rowTitle}>{f.name}</Text>
                    <Text style={styles.rowSub}>לחיצה ארוכה לניתוק</Text>
                  </View>
                  <Text style={styles.chev}>‹</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
        {selectBar}
        {menuPopup}
        {scanPopup}
      </View>
    );
  }

  // ---------- browsing a folder ----------
  return (
    <View style={styles.flex1} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <FlatList
        data={[0]}
        keyExtractor={() => 'x'}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onRefresh={refresh}
        refreshing={false}
        renderItem={() => (
          <View>
            <TouchableOpacity onPress={() => setPath(path.slice(0, -1))} style={styles.back}>
              <Text style={styles.backText}>› {path.length > 1 ? path[path.length - 2].name : 'מסמכים'}</Text>
            </TouchableOpacity>
            <View style={styles.headerRow}>
              <Text style={styles.title} numberOfLines={1}>
                📂 {current.name}
              </Text>
              {viewToggle}
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={scan}>
                <Text style={styles.actionPrimaryText}>📷 סרוק לכאן</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setNewFolder('')}>
                <Text style={styles.actionText}>📁 תיקייה חדשה</Text>
              </TouchableOpacity>
              {path.length === 1 ? (
                <TouchableOpacity style={styles.actionBtn} onPress={() => disconnect(current)}>
                  <Text style={styles.actionText}>נתק תיקייה</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {scanBusy ? <Text style={styles.popupHint}>⏳ משפר את הדפים הסרוקים…</Text> : null}
            <TextInput
              style={styles.input}
              placeholder="🔍 חיפוש בתיקייה"
              placeholderTextColor={c.muted}
              value={search}
              onChangeText={setSearch}
            />
            {filterBar}
            <View style={styles.chipsWrap}>
              {(
                [
                  ['name', 'לפי שם'],
                  ['date', 'לפי תאריך'],
                ] as ['name' | 'date', string][]
              ).map(([k, label]) => (
                <TouchableOpacity key={k} style={[styles.chip, sortBy === k && styles.chipOn]} onPress={() => setSortBy(k)}>
                  <Text style={[styles.chipText, sortBy === k && styles.chipTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {loading ? <ActivityIndicator style={styles.spinner} /> : null}
            {broken ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>אין גישה לתיקייה. ייתכן שהיא הוזזה או ששמה שונה. נתק אותה וחבר שוב.</Text>
              </View>
            ) : null}
            {!loading && !broken && shownEntries.length === 0 ? <Text style={styles.empty}>אין קבצים כאן.</Text> : null}
            {items(shownEntries)}
          </View>
        )}
      />
      {selectBar}
      {menuPopup}
      {scanPopup}
      {newFolderPopup}
    </View>
  );
}

function MenuItem({
  styles,
  label,
  onPress,
  danger,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Text style={[styles.menuText, danger && styles.danger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function LinkPanel({
  e,
  notes,
  styles,
  onTask,
  onNote,
}: {
  e: DocEntry;
  notes: { id: string; title: string }[];
  styles: ReturnType<typeof makeStyles>;
  onTask: (e: DocEntry, taskId: string | null) => void;
  onNote: (e: DocEntry, noteId: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    loadTasks().then((t) => setTasks(t.filter((x) => !x.done)));
  }, []);
  return (
    <View>
      <MenuItem styles={styles} label="➕  משימה חדשה עם המסמך" onPress={() => onTask(e, null)} />
      <Text style={styles.label}>✅ משימות</Text>
      {tasks.length === 0 ? <Text style={styles.hint}>אין משימות פתוחות.</Text> : null}
      {tasks.slice(0, 30).map((t) => (
        <MenuItem key={t.id} styles={styles} label={`☐  ${t.title}`} onPress={() => onTask(e, t.id)} />
      ))}
      <Text style={styles.label}>📝 פתקים</Text>
      {notes.length === 0 ? <Text style={styles.hint}>אין פתקים.</Text> : null}
      {notes.slice(0, 30).map((n) => (
        <MenuItem key={n.id} styles={styles} label={`📝  ${n.title || 'פתק ללא כותרת'}`} onPress={() => onNote(e, n.id)} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- styles

const makeStyles = (c: Palette) => ({
  flex1: { flex: 1 },
  content: { padding: 16, paddingBottom: 90 },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10 },
  title: { fontSize: 22, fontWeight: '800' as const, color: c.text, flexShrink: 1 },
  actionsRow: { flexDirection: 'row' as const, gap: 8, marginTop: 10, marginBottom: 10 },
  actionBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
  },
  actionText: { fontSize: 14.5, fontWeight: '700' as const, color: c.text },
  actionPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  popupHint: { fontSize: 12.5, color: c.muted, marginTop: 10, lineHeight: 18 },
  actionPrimaryText: { fontSize: 15, fontWeight: '800' as const, color: c.onAccent },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15.5,
    color: c.text,
    textAlign: 'right' as const,
  },
  chipsScroll: { flexGrow: 0, marginTop: 10 },
  chipsWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    marginEnd: 6,
  },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontSize: 13.5, color: c.text, fontWeight: '600' as const },
  chipTextOn: { color: c.onAccent, fontWeight: '800' as const },
  viewToggle: { flexDirection: 'row' as const, backgroundColor: c.subtle, borderRadius: 10, padding: 3 },
  viewBtn: { width: 38, height: 32, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const },
  viewBtnOn: { backgroundColor: c.accent },
  viewBtnText: { fontSize: 17, color: c.text, fontWeight: '700' as const },
  section: { fontSize: 15.5, fontWeight: '800' as const, color: c.text, marginTop: 18, marginBottom: 6 },
  empty: { fontSize: 14, color: c.muted, marginVertical: 10, lineHeight: 20 },
  spinner: { marginVertical: 14 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: c.card,
    borderRadius: 14,
    padding: 10,
    marginTop: 8,
    overflow: 'hidden' as const,
    ...cardShadow(c),
  },
  rowSel: { borderWidth: 2, borderColor: c.accent },
  typeStripe: { position: 'absolute' as const, top: 0, bottom: 0, start: 0, width: 4 },
  rowTitle: { fontSize: 15, fontWeight: '700' as const, color: c.text },
  rowSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  chev: { fontSize: 22, color: c.muted },
  moreBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  moreText: { fontSize: 22, color: c.muted, fontWeight: '800' as const },
  folderIcon: { fontSize: 30 },
  badgeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 4, flexWrap: 'wrap' as const },
  favMark: { fontSize: 13 },
  expiryBadge: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: c.text2,
    backgroundColor: c.subtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden' as const,
  },
  expiryBad: { color: c.danger, backgroundColor: c.dangerSoft },
  thumbImg: { borderRadius: 8, backgroundColor: c.subtle },
  thumbIcon: { borderRadius: 8, backgroundColor: c.subtle, alignItems: 'center' as const, justifyContent: 'center' as const },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, marginTop: 8 },
  tile: { backgroundColor: c.card, borderRadius: 14, padding: 6, alignItems: 'center' as const, ...cardShadow(c) },
  tileName: { fontSize: 12, color: c.text, marginTop: 6, textAlign: 'center' as const, minHeight: 30 },
  tileFav: { position: 'absolute' as const, top: 8, end: 8, fontSize: 14 },
  tileCheck: { position: 'absolute' as const, top: 8, start: 8 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.card,
  },
  checkOn: { backgroundColor: c.accent, borderColor: c.accent },
  checkMark: { color: c.onAccent, fontWeight: '900' as const, fontSize: 13 },
  selectBar: {
    position: 'absolute' as const,
    start: 12,
    end: 12,
    bottom: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: 10,
    borderRadius: 16,
    backgroundColor: c.primary,
  },
  selectText: { flex: 1, color: c.onPrimary, fontWeight: '800' as const, fontSize: 14 },
  selectBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: c.card },
  selectBtnText: { color: c.text, fontWeight: '700' as const, fontSize: 13.5 },
  danger: { color: c.danger },
  back: { paddingVertical: 6, alignSelf: 'flex-start' as const },
  backText: { fontSize: 15, color: c.link, fontWeight: '700' as const },
  warnBox: { backgroundColor: c.dangerSoft, borderRadius: 10, padding: 10, marginTop: 8 },
  warnText: { color: c.danger, fontWeight: '700' as const, fontSize: 13.5 },
  menuItem: { paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: c.border },
  menuText: { fontSize: 15.5, color: c.text, fontWeight: '500' as const },
  hint: { fontSize: 13, color: c.muted, lineHeight: 19, marginVertical: 6 },
  label: { fontSize: 14, fontWeight: '800' as const, color: c.text, marginTop: 14, marginBottom: 4 },
  dateBtn: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.card,
    marginTop: 6,
  },
  dateBtnText: { fontSize: 16, fontWeight: '700' as const, color: c.text },
  bigBtn: {
    backgroundColor: c.accent,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 14,
  },
  bigBtnText: { color: c.onAccent, fontWeight: '800' as const, fontSize: 16 },
});
