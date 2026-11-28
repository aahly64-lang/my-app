import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import {
  TRASH_DAYS,
  TRASH_WARN_BYTES,
  TrashItem,
  daysLeft,
  deleteForever,
  emptyTrash,
  loadTrash,
  moveToTrash,
  purgeTrash,
  restoreFromTrash,
  trashSize,
} from './trash';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { DocEntry, GeoAlarm, SharedFile } from '../modules/geo-alarm';
import { Palette, cardShadow, useTheme, useThemedStyles } from './theme';
import { PopupShell, confirm } from './ui';
import { docIcon } from './docLinks';
import { displayYMD, pickDate } from './pickers';
import { canLock, ensureUnlocked } from './lock';
import { cancelRing, scheduleReminder } from './rings';
import { refreshMorning } from './morning';
import { PendingFile, scanAndSave, scanName, useSaveDocs } from './SaveDocs';
import DocSign from './DocSign';
import { OcrSuggestion, suggestFromText } from './ocrSuggest';
import DocPreview from './DocPreview';
import { DATE_FILTERS, DateFilter, PERSONAL_SLOTS, PersonalSlot, addYear, allTags, passesDate, slotOf } from './docInfo';
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
  loadFolderHelpSeen,
  saveFolderHelpSeen,
  loadPersonalHidden,
  metaEmpty,
  savePersonalHidden,
  loadScanQuality,
  loadDocOrder,
  saveDocOrder,
  ScanQuality,
  saveScanQuality,
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

/** PDFs and pictures open in the app's own quick preview; other files in another app. */
const canPreview = (mime: string) => mime.includes('pdf') || mime.startsWith('image/');

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
const QUALITY_LABEL: Record<ScanQuality, string> = {
  small: 'קטן (לוואטסאפ ומייל)',
  normal: 'רגיל',
  high: 'גבוה (כתב קטן)',
  original: 'מקורי, בלי שיפור',
};

type Rect = { x: number; y: number; w: number; h: number };
const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

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
  if (!meta.expiry || !meta.remindDays || meta.archived) return false;
  const [y, m, d] = meta.expiry.split('-').map(Number);
  const at = new Date(y, m - 1, d - meta.remindDays, 9, 0, 0).getTime();
  return scheduleReminder({
    id,
    title: meta.renewYearly ? `🔁 חידוש שנתי: ${meta.name}` : `⏰ תוקף מסמך: ${meta.name}`,
    body: `התוקף מסתיים ב-${displayYMD(meta.expiry)} (בעוד ${meta.remindDays} ימים)`,
    silent: false,
    once: { at },
  });
}

/** Thumbnails are cached for the whole session. */
const thumbCache = new Map<string, string | null>();

function Thumb({ e, size, styles, locked }: { e: DocEntry; size: number; styles: ReturnType<typeof makeStyles>; locked?: boolean }) {
  const key = `${e.uri}|${e.modified}`;
  const [uri, setUri] = useState<string | null | undefined>(thumbCache.get(key));
  const t = typeOf(e.mime);
  useEffect(() => {
    if (locked || e.isDir || (t !== 'image' && t !== 'pdf') || thumbCache.has(key)) return;
    let alive = true;
    GeoAlarm.documentThumbnail(e.uri, e.mime, 320, e.modified || 0).then((r) => {
      thumbCache.set(key, r);
      if (alive) setUri(r);
    });
    return () => {
      alive = false;
    };
  }, [key, locked]);
  if (locked)
    return (
      <View style={[styles.thumbIcon, { width: size, height: size }]}>
        <Text style={{ fontSize: size * 0.42 }}>🔒</Text>
      </View>
    );
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
  /** files shared into the app from WhatsApp / mail…, waiting to be saved */
  incoming?: SharedFile[] | null;
  onIncomingDone?: () => void;
  /** the tab is on screen (it stays mounted in the background after the first visit) */
  active?: boolean;
}

function DocsTab({ dataVersion, notes, onAttachToNote, incoming, onIncomingDone, active = true }: Props) {
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
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size' | 'manual'>('name');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // documents stage C
  const [preview, setPreview] = useState<DocEntry | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [listView, setListView] = useState<{ kind: 'archive' } | { kind: 'tag'; tag: string } | null>(null);
  const [personalOpen, setPersonalOpen] = useState(false);
  // one "📁 תיקיות" button: choose new folder / existing folder; simple help the first time
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [folderHelp, setFolderHelp] = useState(false);
  const [personalHidden, setPersonalHidden] = useState<string[]>([]);
  const [dupes, setDupes] = useState<DocEntry[][] | null>(null);
  const [noteText, setNoteText] = useState('');
  const [newTag, setNewTag] = useState('');
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [meta, setMeta] = useState<Record<string, DocMeta>>({});
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [menu, setMenu] = useState<DocEntry | null>(null);
  const [panel, setPanel] = useState<
    'menu' | 'rename' | 'expiry' | 'link' | 'rotate' | 'pages' | 'protect' | 'note' | 'tags' | 'personal' | 'ocr'
  >('menu');
  const [password, setPassword] = useState('');
  // recycle bin
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  // locked documents are hidden until the user asks to see them (fingerprint)
  const [showLocked, setShowLocked] = useState(false);
  const saver = useSaveDocs();
  const [renameText, setRenameText] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null); // multi-select
  const [newFolder, setNewFolder] = useState<string | null>(null); // name being typed
  const [newFolderParent, setNewFolderParent] = useState<DocFolder | null>(null); // home: where to create
  const [scanBusy, setScanBusy] = useState(false);
  const [quality, setQuality] = useState<ScanQuality>('normal');
  const [qualityPick, setQualityPick] = useState(false);
  // move to…
  const [moveItems, setMoveItems] = useState<DocEntry[] | null>(null);
  const [movePath, setMovePath] = useState<DocFolder[]>([]);
  const [moveDirs, setMoveDirs] = useState<DocEntry[] | null>(null);
  // drag & drop
  const [drag, setDrag] = useState<{ e: DocEntry; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<View>(null);
  const rootPos = useRef({ x: 0, y: 0 });
  const targetRefs = useRef<Record<string, View | null>>({});
  const targetRects = useRef<Record<string, Rect>>({});
  const busyMove = useRef(false);
  const [width, setWidth] = useState(360);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadDocFolders().then(setFolders);
    loadDocMeta().then(setMeta);
    loadDocRecent().then(setRecent);
    loadDocView().then(setView);
    loadScanQuality().then(setQuality);
    loadDocOrder().then(setOrder);
    purgeTrash().then(setTrash);
    loadPersonalHidden().then(setPersonalHidden);
    setPath([]);
  }, [dataVersion]);

  // hide the locked documents again when the app goes to the background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') setShowLocked(false);
    });
    return () => sub.remove();
  }, []);

  const hidden = (uri: string) => (!showLocked && !!meta[uri]?.locked) || (!showArchived && !!meta[uri]?.archived);
  const revealLocked = async () => {
    if (await ensureUnlocked('הצגת מסמכים נעולים')) setShowLocked(true);
  };

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

  // Coming back to the tab: pick up folders added from a task/note scan and changes made to the files
  // outside the app – quietly, without a loading spinner.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      loadDocFolders().then(setFolders);
      loadDocRecent().then(setRecent);
      if (current)
        GeoAlarm.listDocuments(current.uri).then((list) => {
          if (list) setEntries(list);
        });
    }
    wasActive.current = active;
  }, [active]);

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

  // the latest meta, so that quick changes in a row (tags…) don't overwrite each other
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const updateMeta = async (uri: string, patch: Partial<DocMeta> | null, base?: { name: string; mime: string; size?: number }) => {
    const next = { ...metaRef.current };
    let out: DocMeta | undefined;
    if (patch !== null) {
      out = { ...(next[uri] ?? { name: base?.name ?? '', mime: base?.mime ?? '' }), ...patch };
      if (base?.size) out.size = base.size;
    }
    if (!out || metaEmpty(out)) delete next[uri];
    else next[uri] = out;
    metaRef.current = next;
    setMeta(next);
    await saveDocMeta(next);
    return out;
  };

  const rememberOpen = async (e: DocEntry) => {
    const next = [{ uri: e.uri, name: e.name, mime: e.mime, at: Date.now() }, ...recent.filter((r) => r.uri !== e.uri)].slice(0, 20);
    setRecent(next);
    await saveDocRecent(next);
  };

  const openEntry = async (e: DocEntry) => {
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
    if (meta[e.uri]?.locked && !(await ensureUnlocked('פתיחת מסמך נעול'))) return;
    if (canPreview(e.mime)) {
      setPreview(e);
      rememberOpen(e);
      return;
    }
    openExternal(e);
  };

  const openExternal = (e: DocEntry) => {
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
    const parent = current ?? newFolderParent;
    if (!parent || !name) return;
    if (current && entries.some((e) => e.isDir && e.name === name)) {
      Alert.alert('תיקייה חדשה', `כבר יש כאן תיקייה בשם "${name}".`);
      return;
    }
    const uri = await GeoAlarm.createFolder(parent.uri, name);
    setNewFolder(null);
    if (!uri) {
      Alert.alert('תיקייה חדשה', 'לא הצלחתי ליצור את התיקייה. ייתכן שאין הרשאת כתיבה – נתק וחבר את התיקייה שוב.');
      return;
    }
    if (current) refresh();
    else {
      // home: show the new folder in the main list as a folder of its own
      const next = [...folders, { uri, name }];
      setFolders(next);
      saveDocFolders(next);
    }
  };

  const startNewFolder = () => {
    if (!folders.length) {
      Alert.alert(
        '📁 תיקייה חדשה',
        'בפעם הראשונה צריך לבחור מקום בטלפון שבו יישמרו התיקיות (למשל "Documents" או "מסמכים"). אחרי זה יוצרים תיקיות בלחיצה אחת.',
        [
          { text: 'ביטול', style: 'cancel' },
          { text: 'בחר מקום', onPress: connectFolder },
        ]
      );
      return;
    }
    setNewFolderParent(folders.length === 1 ? folders[0] : null);
    setNewFolder('');
  };

  const openFolders = async () => {
    setFoldersOpen(true);
    if (!(await loadFolderHelpSeen())) setFolderHelp(true);
  };
  const closeFolderHelp = () => {
    setFolderHelp(false);
    saveFolderHelpSeen();
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

  // ---------- scanning / new PDFs ----------
  const afterSaved = (saved: DocLink[] | null, what: string, quiet = false) => {
    if (!saved || !saved.length) return;
    refresh();
    const rec = [
      ...saved.map((d, i) => ({ ...d, at: Date.now() - i })),
      ...recent.filter((r) => !saved.some((d) => d.uri === r.uri)),
    ].slice(0, 20);
    setRecent(rec);
    saveDocRecent(rec);
    if (quiet) return;
    if (saved.length > 1) {
      Alert.alert('נשמר ✓', `${saved.length} קבצים נשמרו.`);
      return;
    }
    const d = saved[0];
    const entry: DocEntry = { uri: d.uri, name: d.name, mime: d.mime, isDir: false, size: 0, modified: Date.now() };
    Alert.alert('נשמר ✓', `${what} "${d.name}" נשמר.`, [
      { text: 'סגור', style: 'cancel' },
      { text: 'פעולות נוספות', onPress: () => openMenu(entry) },
      { text: 'פתח', onPress: () => GeoAlarm.openDocument(d.uri, d.mime) },
    ]);
  };

  const scan = async (card = false) => {
    const d = await scanAndSave(saver, current, undefined, { card });
    if (!d) return;
    if (offerSuggest(d, d.suggest, 'נשמר ✓')) afterSaved([d], 'הסריקה', true);
    else afterSaved([d], card ? 'הכרטיס' : 'הסריקה');
  };

  /** Photos from the gallery, in the order picked, into one PDF. */
  const pickImages = async (): Promise<PendingFile[] | null> => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: 30,
      quality: 1,
    });
    if (r.canceled || !r.assets?.length) return null;
    return r.assets.map((a, i) => ({ src: a.uri, name: a.fileName || `תמונה ${i + 1}.jpg`, mime: a.mimeType || 'image/jpeg' }));
  };

  const imagesToPdf = async () => {
    const imgs = await pickImages();
    if (!imgs) return;
    const pdf = await saver.busy('⏳ בונה PDF מהתמונות…', () =>
      GeoAlarm.combinePdf(imgs.map((f) => f.src), imgs.map((f) => f.mime), quality === 'original' ? 'normal' : quality)
    );
    if (!pdf) {
      Alert.alert('תמונות ל-PDF', 'לא הצלחתי לבנות את הקובץ.');
      return;
    }
    const saved = await saver.ask({
      title: `🖼️ ${imgs.length === 1 ? 'תמונה' : `${imgs.length} תמונות`} ל-PDF`,
      files: [{ src: pdf, name: scanName().replace('סריקה', 'תמונות') + '.pdf', mime: 'application/pdf' }],
      folder: current,
    });
    afterSaved(saved, 'הקובץ');
  };

  /** Adds scanned pages / photos at the end of an existing PDF (the file itself is rewritten). */
  const addPages = async (e: DocEntry, from: 'scan' | 'gallery') => {
    closeMenu();
    let extra: PendingFile[] | null = null;
    if (from === 'scan') {
      try {
        const r = await saver.busy('⏳ משפר את הדפים הסרוקים…', () => GeoAlarm.scanDocument(quality));
        if (r) extra = [{ src: r.uri, name: 'scan.pdf', mime: 'application/pdf' }];
      } catch (err: any) {
        Alert.alert('סריקת מסמך', 'הסורק לא זמין בטלפון: ' + (err?.message ?? ''));
        return;
      }
    } else extra = await pickImages();
    if (!extra) return;
    const ok = await saver.busy('⏳ מוסיף את העמודים…', () =>
      GeoAlarm.combinePdf(
        [e.uri, ...extra!.map((f) => f.src)],
        [e.mime, ...extra!.map((f) => f.mime)],
        quality === 'original' ? 'normal' : quality,
        e.uri
      )
    );
    if (!ok) {
      Alert.alert('הוספת עמודים', 'לא הצלחתי לעדכן את הקובץ. ייתכן שאין הרשאת כתיבה לתיקייה.');
      return;
    }
    refresh();
    Alert.alert('עודכן ✓', `העמודים נוספו בסוף "${e.name}".`, [
      { text: 'סגור', style: 'cancel' },
      { text: 'פתח', onPress: () => GeoAlarm.openDocument(e.uri, e.mime) },
    ]);
  };

  // files shared into the app ("Share" → our app, from WhatsApp, mail, gallery…)
  useEffect(() => {
    if (!incoming || !incoming.length) return;
    let alive = true;
    (async () => {
      const saved = await saver.ask({
        title: incoming.length === 1 ? '📥 שמירת קובץ שהתקבל' : `📥 שמירת ${incoming.length} קבצים שהתקבלו`,
        files: incoming.map((f) => ({ src: f.uri, name: f.name, mime: f.mime })),
        folder: current,
        mergeable: true,
      });
      if (!alive) return;
      onIncomingDone?.();
      afterSaved(saved, 'הקובץ');
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  // ---------- item menu ----------
  const openMenu = (e: DocEntry) => {
    if (e.isDir) return;
    setMenu(e);
    setPanel('menu');
  };
  const closeMenu = () => setMenu(null);

  const toggleFav = async (e: DocEntry) => {
    const fav = !meta[e.uri]?.fav;
    await updateMeta(e.uri, { fav, name: e.name, mime: e.mime }, e);
  };

  const toggleLock = async (e: DocEntry) => {
    const locked = !!meta[e.uri]?.locked;
    if (locked) {
      if (!(await ensureUnlocked('ביטול נעילת מסמך'))) return;
      await updateMeta(e.uri, { locked: false }, e);
    } else {
      if (!(await canLock())) return;
      await updateMeta(e.uri, { locked: true, name: e.name, mime: e.mime }, e);
      if (!showLocked)
        Alert.alert('🔒 המסמך ננעל', 'מעכשיו הוא מוסתר מהרשימות. כדי לראות אותו לחץ "הצג נעולים" (עם טביעת אצבע).');
    }
    closeMenu();
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
    if (preview?.uri === menu.uri) setPreview({ ...preview, uri: newUri, name });
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

  // ---------- moving ----------
  const relocate = async (pairs: [string, string][]) => {
    const m = { ...meta };
    let metaChanged = false;
    for (const [from, to] of pairs) {
      if (m[from]) {
        m[to] = m[from];
        delete m[from];
        metaChanged = true;
        cancelRing(docRingId(from));
        if (m[to].expiry) await scheduleExpiry(to, m[to]);
      }
    }
    if (metaChanged) {
      setMeta(m);
      await saveDocMeta(m);
    }
    const map = new Map(pairs);
    const rec = recent.map((r) => (map.has(r.uri) ? { ...r, uri: map.get(r.uri)! } : r));
    setRecent(rec);
    await saveDocRecent(rec);
  };

  const moveTo = async (list: DocEntry[], dest: DocFolder) => {
    if (busyMove.current) return;
    busyMove.current = true;
    const pairs: [string, string][] = [];
    const copied: string[] = [];
    const errors: string[] = [];
    for (const e of list) {
      if (e.uri === dest.uri) continue;
      const r = await GeoAlarm.moveDocument(e.uri, current?.uri ?? '', dest.uri);
      if (r.status === 'moved' && r.uri) pairs.push([e.uri, r.uri]);
      else if (r.status === 'copied') copied.push(e.name);
      else errors.push(`• ${e.name}: ${r.error ?? 'שגיאה לא ידועה'}`);
    }
    await relocate(pairs);
    busyMove.current = false;
    setSelected(null);
    setMoveItems(null);
    if (current) refresh();
    if (results) setResults(results.filter((r) => !pairs.some(([from]) => from === r.uri)));
    if (copied.length)
      Alert.alert(
        'הועתק, אבל המקור נשאר',
        `${copied.join(', ')} הועתק ל"${dest.name}", אבל לא הצלחתי למחוק את הקובץ המקורי.\n\nכדי לתת הרשאה מלאה: נתק את תיקיית המקור (לחיצה ארוכה עליה במסך הראשי) וחבר אותה שוב.`
      );
    if (errors.length) Alert.alert('ההעברה נכשלה', errors.join('\n'));
  };

  const openMoveTo = (list: DocEntry[]) => {
    closeMenu();
    setMoveItems(list);
    setMovePath([]);
    setMoveDirs(null);
  };

  useEffect(() => {
    const f = movePath[movePath.length - 1];
    if (!f) {
      setMoveDirs(null);
      return;
    }
    setMoveDirs(null);
    GeoAlarm.listDocuments(f.uri).then((l) => setMoveDirs((l ?? []).filter((x) => x.isDir)));
  }, [movePath]);

  // ---------- drag & drop (inside a folder) ----------
  const measureTargets = () => {
    targetRects.current = {};
    rootRef.current?.measureInWindow((x, y) => (rootPos.current = { x, y }));
    for (const [key, v] of Object.entries(targetRefs.current)) {
      v?.measureInWindow((x, y, w, h) => {
        targetRects.current[key] = { x, y, w, h };
      });
    }
  };
  const targetAt = (x: number, y: number) => {
    // measure anything that was not measured yet (refs can attach after the drag started)
    for (const [key, v] of Object.entries(targetRefs.current)) {
      if (v && !targetRects.current[key])
        v.measureInWindow((mx, my, w, h) => {
          targetRects.current[key] = { x: mx, y: my, w, h };
        });
    }
    for (const [key, r] of Object.entries(targetRects.current)) if (inRect(r, x, y)) return key;
    return null;
  };
  const reorder = (e: DocEntry, before: DocEntry) => {
    if (!current) return;
    const names = shownEntries.filter((x) => !x.isDir).map((x) => x.name).filter((n) => n !== e.name);
    const at = names.indexOf(before.name);
    names.splice(at < 0 ? names.length : at, 0, e.name);
    const next = { ...order, [current.uri]: names };
    setOrder(next);
    saveDocOrder(next);
    setSortBy('manual');
  };
  const dropOn = (e: DocEntry, key: string | null) => {
    if (!key || key === e.uri) return;
    if (key.startsWith('root:')) {
      const f = folders.find((x) => 'root:' + x.uri === key);
      if (f) moveTo([e], f);
      return;
    }
    if (!current) return;
    if (key === '__up') {
      const parent = path[path.length - 2];
      if (parent) moveTo([e], parent);
      return;
    }
    const target = entries.find((x) => x.uri === key);
    if (target?.isDir) moveTo([e], { uri: target.uri, name: target.name });
    else if (target) reorder(e, target);
  };
  const dragGesture = (e: DocEntry) =>
    Gesture.Pan()
      .runOnJS(true)
      .activateAfterLongPress(350)
      .onStart((ev) => {
        measureTargets();
        setDrag({ e, x: ev.absoluteX, y: ev.absoluteY });
      })
      .onUpdate((ev) => {
        setDrag({ e, x: ev.absoluteX, y: ev.absoluteY });
        setHover(targetAt(ev.absoluteX, ev.absoluteY));
      })
      .onEnd((ev) => dropOn(e, targetAt(ev.absoluteX, ev.absoluteY)))
      .onFinalize(() => {
        setDrag(null);
        setHover(null);
        delete targetRects.current.__up;
        delete targetRefs.current.__up;
      });
  const draggable = (e: DocEntry, node: React.ReactElement) =>
    !selected ? (
      <GestureDetector key={e.uri} gesture={dragGesture(e)}>
        {node}
      </GestureDetector>
    ) : (
      node
    );

  const inFolder = (uri: string) => (current && entries.some((x) => x.uri === uri) ? current.uri : undefined);

  /** Moves documents to the recycle bin. Returns the ones that were removed from their folder. */
  const trashDocs = async (list: DocEntry[]) => {
    const gone: string[] = [];
    const noCopy: DocEntry[] = [];
    let failed = 0;
    for (const e of list) {
      const r = await moveToTrash(e, inFolder(e.uri), meta[e.uri]);
      if (r === 'ok') gone.push(e.uri);
      else if (r === 'nocopy') noCopy.push(e);
      else failed++;
    }
    await forget(gone);
    const t = await loadTrash();
    setTrash(t);
    if (preview && gone.includes(preview.uri)) setPreview(null);
    if (dupes) setDupes(dupes.map((g) => g.filter((x) => !gone.includes(x.uri))).filter((g) => g.length > 1));
    if (failed) Alert.alert('מחיקה', `${failed} קבצים לא נמחקו. ייתכן שאין הרשאת כתיבה לתיקייה.`);
    if (noCopy.length)
      confirm(
        'מחיקה',
        `לא הצלחתי לשמור עותק בסל המחזור של ${noCopy.length === 1 ? `"${noCopy[0].name}"` : `${noCopy.length} קבצים`} (אולי אין מספיק מקום). למחוק לצמיתות בלי סל?`,
        'מחק לצמיתות',
        async () => {
          const ok = noCopy.filter((e) => GeoAlarm.deleteDocument(e.uri)).map((e) => e.uri);
          await forget(ok);
          refresh();
          if (results) setResults(results.filter((r) => !ok.includes(r.uri)));
        }
      );
    else if (gone.length && trashSize(t) > TRASH_WARN_BYTES)
      Alert.alert('🗑️ סל המחזור מתמלא', `בסל יש ${t.length} מסמכים שתופסים ${sizeText(trashSize(t))}. כדאי לרוקן אותו (כפתור "סל מחזור" במסך המסמכים).`);
    refresh();
    if (results) setResults(results.filter((r) => !gone.includes(r.uri)));
    return gone;
  };

  const doDelete = (e: DocEntry) => {
    confirm('מחיקת קובץ', `להעביר את "${e.name}" לסל המחזור? אפשר לשחזר אותו במשך ${TRASH_DAYS} יום.`, 'מחק', async () => {
      closeMenu();
      await trashDocs([e]);
    });
  };

  // ---------- recycle bin ----------
  const restoreItem = async (t: TrashItem) => {
    if (t.meta?.locked && !showLocked && !(await ensureUnlocked('שחזור מסמך נעול'))) return;
    const uri = await restoreFromTrash(t, folders.map((f) => f.uri));
    if (!uri) {
      Alert.alert('שחזור', 'לא הצלחתי להחזיר את הקובץ לתיקייה. ייתכן שהתיקייה נותקה או נמחקה – חבר אותה שוב ונסה.');
      return;
    }
    if (t.meta) {
      const m = await updateMeta(uri, { ...t.meta, name: t.name, mime: t.mime });
      if (m?.expiry) await scheduleExpiry(uri, m);
      refreshMorning();
    }
    setTrash(await loadTrash());
    refresh();
    Alert.alert('שוחזר ✓', `"${t.name}" חזר לתיקייה.`);
  };
  const deleteItemForever = (t: TrashItem) =>
    confirm('מחיקה לצמיתות', `למחוק את "${t.name}" לצמיתות? אי אפשר לבטל את זה.`, 'מחק לצמיתות', async () =>
      setTrash(await deleteForever([t.id]))
    );
  const doEmptyTrash = () =>
    confirm(
      'ריקון סל המחזור',
      `למחוק לצמיתות ${trash.length === 1 ? 'מסמך אחד' : `${trash.length} מסמכים`} (${sizeText(trashSize(trash))})? אי אפשר לבטל את זה.`,
      'רוקן סל',
      async () => {
        await emptyTrash();
        setTrash([]);
      }
    );

  // ---------- password-protected PDF (only when the user picks it) ----------
  const shareProtected = async (e: DocEntry) => {
    const pw = password.trim();
    if (pw.length < 4) {
      Alert.alert('PDF עם סיסמה', 'הסיסמה צריכה להיות לפחות 4 תווים.');
      return;
    }
    if (meta[e.uri]?.locked && !(await ensureUnlocked('שיתוף מסמך נעול'))) return;
    const base = e.name.replace(/\.[^.]+$/, '');
    const out = await saver.busy('⏳ מכין PDF עם סיסמה…', async () => {
      let src: string | null = e.uri;
      if (!e.mime.includes('pdf')) src = await GeoAlarm.combinePdf([e.uri], [e.mime], 'normal');
      return src ? GeoAlarm.protectPdf(src, pw, base + '.pdf') : null;
    });
    if (!out) {
      Alert.alert('PDF עם סיסמה', 'לא הצלחתי להכין את הקובץ.');
      return;
    }
    closeMenu();
    setPassword('');
    try {
      await Sharing.shareAsync(out, { mimeType: 'application/pdf', dialogTitle: 'שיתוף PDF עם סיסמה' });
    } catch {
      Alert.alert('PDF עם סיסמה', 'השיתוף נכשל.');
    }
  };

  const setExpiry = (e: DocEntry) => {
    pickDate(meta[e.uri]?.expiry, async (ymd) => {
      const m = await updateMeta(e.uri, { expiry: ymd, remindDays: meta[e.uri]?.remindDays ?? 30, name: e.name, mime: e.mime }, e);
      if (m) await scheduleExpiry(e.uri, m);
      refreshMorning();
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
    await updateMeta(e.uri, { expiry: undefined, remindDays: undefined, renewYearly: undefined }, e);
    refreshMorning();
  };

  // ---------- documents stage C: note, tags, archive, personal file, yearly renewal, duplicates ----------
  const saveNote = async (e: DocEntry) => {
    await updateMeta(e.uri, { note: noteText.trim() || undefined, name: e.name, mime: e.mime }, e);
    setPanel('menu');
  };

  const toggleTag = async (e: DocEntry, tag: string) => {
    const cur = metaRef.current[e.uri]?.tags ?? [];
    const tags = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
    await updateMeta(e.uri, { tags: tags.length ? tags : undefined, name: e.name, mime: e.mime }, e);
  };
  const addTag = async (e: DocEntry) => {
    const t = newTag.trim().replace(/^#/, '').slice(0, 24);
    if (!t) return;
    setNewTag('');
    if (!(metaRef.current[e.uri]?.tags ?? []).includes(t)) await toggleTag(e, t);
  };

  const toggleArchive = async (e: DocEntry) => {
    const archived = !meta[e.uri]?.archived;
    const m = await updateMeta(e.uri, { archived: archived || undefined, name: e.name, mime: e.mime }, e);
    if (archived) cancelRing(docRingId(e.uri));
    else if (m?.expiry) await scheduleExpiry(e.uri, m);
    refreshMorning();
    closeMenu();
    if (archived) {
      if (preview?.uri === e.uri) setPreview(null);
      if (!showArchived)
        Alert.alert('🗄️ הועבר לארכיון', 'הקובץ נשאר במקומו, אבל לא יופיע ברשימות ולא יזכיר תוקף. אפשר למצוא אותו ב"ארכיון" במסך הראשי של המסמכים.');
    }
  };

  const toggleRenew = async (e: DocEntry) => {
    const m = await updateMeta(e.uri, { renewYearly: !meta[e.uri]?.renewYearly || undefined }, e);
    if (m?.expiry) await scheduleExpiry(e.uri, m);
  };
  /** "I renewed it": the expiry moves on by a year (or more, until it is in the future). */
  const renewNow = async (e: DocEntry) => {
    const old = meta[e.uri]?.expiry;
    if (!old) return;
    let next = addYear(old);
    while (daysUntil(next) < 0) next = addYear(next);
    const m = await updateMeta(e.uri, { expiry: next }, e);
    if (m) await scheduleExpiry(e.uri, m);
    refreshMorning();
    Alert.alert('🔁 חודש ✓', `התוקף עודכן ל-${displayYMD(next)}. כדאי גם לסרוק את המסמך החדש ("➕ הוסף עמודים" או סריקה חדשה).`);
  };

  const assignSlot = async (e: { uri: string; name: string; mime: string; size?: number }, key: string | null) => {
    const next = { ...metaRef.current };
    if (key)
      for (const [u, x] of Object.entries(next))
        if (x.personal === key && u !== e.uri) {
          const y = { ...x, personal: undefined };
          if (metaEmpty(y)) delete next[u];
          else next[u] = y;
        }
    metaRef.current = next;
    const slot = slotOf(key ?? undefined);
    const cur = next[e.uri];
    await updateMeta(
      e.uri,
      {
        personal: key ?? undefined,
        name: e.name,
        mime: e.mime,
        ...(slot?.yearly && cur?.renewYearly === undefined ? { renewYearly: true } : {}),
      },
      e
    );
  };

  const scanToSlot = async (slot: PersonalSlot) => {
    const d = await scanAndSave(saver, current, slot.label, { card: slot.card });
    if (!d) return;
    await assignSlot(d, slot.key);
    const sg = { ...d.suggest, slot: undefined };
    if (offerSuggest(d, sg, 'נשמר בתיק ✓')) afterSaved([d], 'המסמך', true);
    else afterSaved([d], 'המסמך');
  };

  // ---------- suggestions from the scan's text (read on the phone) ----------
  /** Offers the expiry / personal-file slot / tag found in the text. Returns false when there is nothing to offer. */
  const offerSuggest = (e: DocLink, sg: OcrSuggestion, title: string) => {
    const cur = metaRef.current[e.uri];
    const parts: string[] = [];
    const exp = sg.expiry && !cur?.expiry && (sg.expiryByKeyword || daysUntil(sg.expiry) >= 0) ? sg.expiry : undefined;
    if (exp) parts.push(`📅 תוקף עד ${displayYMD(exp)}${sg.expiryByKeyword ? '' : ' (ניחוש)'}, עם תזכורת חודש לפני`);
    const slot = slotOf(sg.slot);
    const slotOk = !!slot && !cur?.personal && !personalState.bySlot.has(slot.key);
    if (slotOk) parts.push(`🗂️ לתיק האישי: ${slot!.label}`);
    const tag = sg.tag && !(cur?.tags ?? []).includes(sg.tag) ? sg.tag : undefined;
    if (tag) parts.push(`🏷️ תגית: ${tag}`);
    if (!parts.length) return false;
    Alert.alert(title, `"${e.name}"\n\nמהטקסט שבסריקה זיהיתי:\n${parts.join('\n')}\n\nלהוסיף?`, [
      { text: 'לא תודה', style: 'cancel' },
      { text: 'הוסף', onPress: () => applySuggest(e, exp, slotOk ? slot!.key : undefined, tag) },
    ]);
    return true;
  };
  const applySuggest = async (e: DocLink, expiry?: string, slotKey?: string, tag?: string) => {
    if (slotKey) await assignSlot(e, slotKey);
    const cur = metaRef.current[e.uri];
    const patch: Partial<DocMeta> = { name: e.name, mime: e.mime };
    if (expiry) {
      patch.expiry = expiry;
      patch.remindDays = cur?.remindDays ?? 30;
    }
    if (tag) patch.tags = [...new Set([...(cur?.tags ?? []), tag])];
    const m = await updateMeta(e.uri, patch, e);
    if (m?.expiry) await scheduleExpiry(e.uri, m);
    refreshMorning();
  };

  const [ocr, setOcr] = useState<{ text: string | null; sg: OcrSuggestion } | null>(null);
  const readDocText = async (e: DocEntry) => {
    setOcr(null);
    setPanel('ocr');
    const text = await GeoAlarm.readText(e.uri, e.mime, 2);
    setOcr({ text, sg: suggestFromText(text) });
  };

  // ---------- shrink before sending ----------
  const shareSmall = async (e: DocEntry) => {
    if (meta[e.uri]?.locked && !(await ensureUnlocked('שיתוף מסמך נעול'))) return;
    const r = await saver.busy('⏳ מכווץ את הקובץ…', () => GeoAlarm.compressForShare(e.uri, e.mime, e.name));
    if (!r) {
      Alert.alert('שיתוף מכווץ', 'לא הצלחתי לכווץ את הקובץ.');
      return;
    }
    const orig = e.size || meta[e.uri]?.size || 0;
    const share = () => Sharing.shareAsync(r.uri, { mimeType: r.mime, dialogTitle: 'שיתוף מכווץ' }).catch(() => {});
    if (orig && r.size >= orig * 0.95) {
      Alert.alert('שיתוף מכווץ', `הקובץ כבר קטן (${sizeText(orig)}), הכיווץ לא חוסך.`, [
        { text: 'ביטול', style: 'cancel' },
        { text: 'שתף את המקורי', onPress: () => GeoAlarm.shareDocument(e.uri, e.mime) },
      ]);
      return;
    }
    closeMenu();
    Alert.alert('📦 כווץ ✓', orig ? `${sizeText(orig)} ← ${sizeText(r.size)}` : `גודל: ${sizeText(r.size)}`, [
      { text: 'ביטול', style: 'cancel' },
      { text: 'שתף', onPress: share },
    ]);
  };

  // ---------- signing ----------
  const [signing, setSigning] = useState<DocEntry | null>(null);
  const startSign = async (e: DocEntry) => {
    if (meta[e.uri]?.locked && !(await ensureUnlocked('חתימה על מסמך נעול'))) return;
    closeMenu();
    setPreview(null);
    setSigning(e);
  };
  const onSigned = async (file: string, e: DocEntry) => {
    setSigning(null);
    const saved = await saver.ask({
      title: '✍️ שמירת המסמך החתום',
      files: [{ src: file, name: e.name.replace(/\.[^.]+$/, '') + ' - חתום.pdf', mime: 'application/pdf' }],
      folder: current,
    });
    afterSaved(saved, 'המסמך החתום');
  };

  const toggleSlotHidden = (key: string) => {
    const next = personalHidden.includes(key) ? personalHidden.filter((k) => k !== key) : [...personalHidden, key];
    setPersonalHidden(next);
    savePersonalHidden(next);
  };

  const findDupes = async () => {
    if (!folders.length) {
      Alert.alert('קבצים כפולים', 'קודם צריך לחבר תיקייה.');
      return;
    }
    const g = await saver.busy('⏳ מחפש קבצים כפולים בכל התיקיות…', () => GeoAlarm.findDuplicates(folders.map((f) => f.uri)));
    if (g === null) {
      Alert.alert('קבצים כפולים', 'החיפוש נכשל.');
      return;
    }
    // keep first: the copy with a star / tag / note…, otherwise the oldest
    setDupes(g.map((grp) => [...grp].sort((a, b) => Number(!!meta[b.uri]) - Number(!!meta[a.uri]))));
  };
  const dupeKeepFirst = (g: DocEntry[]) => {
    const extra = g.slice(1);
    confirm(
      'מחיקת כפולים',
      `להשאיר את "${g[0].name}" (📂 ${g[0].folder ?? ''}) ולהעביר ${extra.length === 1 ? 'עותק אחד' : `${extra.length} עותקים`} לסל המחזור?`,
      'מחק עותקים',
      () => trashDocs(extra)
    );
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
  const shareSelected = async () => {
    if (!selected || selected.size === 0) return;
    const list = (current ? entries : results ?? []).filter((e) => selected.has(e.uri));
    if (list.some((e) => meta[e.uri]?.locked) && !(await ensureUnlocked('שיתוף מסמך נעול'))) return;
    GeoAlarm.shareDocuments(
      list.map((e) => e.uri),
      list.map((e) => e.mime)
    );
  };
  /** Selected PDFs / images (in the order they were picked) into one new PDF. */
  const mergeSelected = async () => {
    if (!selected || selected.size === 0) return;
    const pool = new Map<string, DocEntry>();
    [...recentShown, ...favs, ...(results ?? []), ...entries].forEach((e) => pool.set(e.uri, e));
    const list = [...selected].map((u) => pool.get(u)).filter((e): e is DocEntry => !!e);
    if (!list.length) return;
    if (list.some((e) => !(e.mime.includes('pdf') || e.mime.startsWith('image/')))) {
      Alert.alert('איחוד ל-PDF', 'אפשר לאחד רק קבצי PDF ותמונות.');
      return;
    }
    if (list.some((e) => meta[e.uri]?.locked) && !(await ensureUnlocked('איחוד מסמך נעול'))) return;
    const pdf = await saver.busy('⏳ מאחד לקובץ אחד…', () =>
      GeoAlarm.combinePdf(list.map((e) => e.uri), list.map((e) => e.mime), quality === 'original' ? 'normal' : quality)
    );
    if (!pdf) {
      Alert.alert('איחוד ל-PDF', 'לא הצלחתי לאחד את הקבצים.');
      return;
    }
    const first = list[0].name.replace(/\.[^.]+$/, '');
    const saved = await saver.ask({
      title: `📕 איחוד ${list.length} קבצים ל-PDF`,
      files: [{ src: pdf, name: (list.length > 1 ? `${first} - מאוחד` : first) + '.pdf', mime: 'application/pdf' }],
      folder: current,
    });
    if (saved?.length) setSelected(null);
    afterSaved(saved, 'הקובץ');
  };

  const deleteSelected = () => {
    if (!selected || selected.size === 0) return;
    confirm('מחיקת קבצים', `להעביר ${selected.size} קבצים לסל המחזור? אפשר לשחזר אותם במשך ${TRASH_DAYS} יום.`, 'מחק', async () => {
      const pool = new Map<string, DocEntry>();
      [...recentShown, ...favs, ...(results ?? []), ...entries].forEach((e) => pool.set(e.uri, e));
      const list = [...selected].map((u) => pool.get(u)).filter((e): e is DocEntry => !!e);
      setSelected(null);
      await trashDocs(list);
    });
  };

  const switchView = (v: 'list' | 'grid') => {
    setView(v);
    saveDocView(v);
  };

  // ---------- data for the lists ----------
  const metaText = (uri: string) => {
    const m = meta[uri];
    return m ? `${m.note ?? ''} ${(m.tags ?? []).join(' ')}`.toLowerCase() : '';
  };
  const metaEntry = (uri: string, m: DocMeta): DocEntry => ({ uri, name: m.name, mime: m.mime, isDir: false, size: m.size ?? 0, modified: 0 });

  const archived = useMemo(
    () =>
      Object.entries(meta)
        .filter(([, m]) => m.archived && (showLocked || !m.locked))
        .sort((a, b) => a[1].name.localeCompare(b[1].name, 'he'))
        .map(([uri, m]) => metaEntry(uri, m)),
    [meta, showLocked]
  );
  const tagList = useMemo(() => allTags(meta).filter((t) => t.count > 0), [meta]);
  const listItems = useMemo(() => {
    if (!listView) return [];
    if (listView.kind === 'archive') return archived;
    return Object.entries(meta)
      .filter(([, m]) => (m.tags ?? []).includes(listView.tag) && (showLocked || !m.locked) && (showArchived || !m.archived))
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'he'))
      .map(([uri, m]) => metaEntry(uri, m));
  }, [listView, meta, archived, showLocked, showArchived]);
  const personalState = useMemo(() => {
    const bySlot = new Map<string, [string, DocMeta]>();
    Object.entries(meta).forEach(([u, m]) => m.personal && bySlot.set(m.personal, [u, m]));
    let missing = 0;
    let bad = 0;
    let ok = 0;
    for (const slot of PERSONAL_SLOTS) {
      if (personalHidden.includes(slot.key)) continue;
      const d = bySlot.get(slot.key);
      if (!d) missing++;
      else if (d[1].expiry && daysUntil(d[1].expiry) <= 30) bad++;
      else ok++;
    }
    return { bySlot, missing, bad, ok };
  }, [meta, personalHidden]);
  const shownEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter(
      (e) =>
        !e.name.startsWith('.') &&
        !hidden(e.uri) &&
        (!q || e.name.toLowerCase().includes(q) || metaText(e.uri).includes(q)) &&
        passes(filter, e.mime, e.isDir) &&
        (e.isDir ? dateFilter === 'all' : passesDate(dateFilter, e.modified))
    );
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sortBy === 'date') return b.modified - a.modified;
      if (sortBy === 'size') return b.size - a.size;
      if (sortBy === 'manual' && current) {
        const o = order[current.uri] ?? [];
        const ia = o.indexOf(a.name);
        const ib = o.indexOf(b.name);
        if (ia !== ib) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      }
      return a.name.localeCompare(b.name, 'he');
    });
  }, [entries, search, sortBy, filter, order, current, meta, showLocked, showArchived, dateFilter]);

  /** Home search: file names (in the folders) + the notes and tags the user wrote. */
  const shownResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...(results ?? [])];
    if (q.length >= 2) {
      const have = new Set(list.map((e) => e.uri));
      for (const [uri, m] of Object.entries(meta))
        if (!have.has(uri) && (m.name.toLowerCase().includes(q) || metaText(uri).includes(q)))
          list.push({ uri, name: m.name, mime: m.mime, isDir: false, size: m.size ?? 0, modified: 0 });
    }
    return list.filter((e) => !hidden(e.uri) && passes(filter, e.mime, e.isDir) && passesDate(dateFilter, e.modified));
  }, [results, filter, meta, showLocked, showArchived, dateFilter, search]);

  const favs = useMemo(
    () =>
      Object.entries(meta)
        .filter(([, m]) => m.fav && !m.archived && (showLocked || !m.locked) && passes(filter, m.mime, false))
        .map(([uri, m]) => metaEntry(uri, m)),
    [meta, filter, showLocked]
  );
  const expiring = useMemo(
    () =>
      Object.entries(meta)
        .filter(([, m]) => m.expiry && !m.archived && (showLocked || !m.locked) && daysUntil(m.expiry) <= 60)
        .sort((a, b) => (a[1].expiry! < b[1].expiry! ? -1 : 1))
        .map(([uri, m]) => metaEntry(uri, m)),
    [meta, showLocked]
  );
  const recentShown = useMemo(
    () =>
      recent
        .filter((r) => !hidden(r.uri) && passes(filter, r.mime, false))
        .slice(0, 6)
        .map((r) => ({ uri: r.uri, name: r.name, mime: r.mime, isDir: false, size: 0, modified: 0 } as DocEntry)),
    [recent, filter, meta, showLocked]
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
    const renewDue = m.renewYearly && m.expiry && daysUntil(m.expiry) < 0;
    const slot = slotOf(m.personal);
    return (
      <>
        <View style={styles.badgeRow}>
          {m.fav ? <Text style={styles.favMark}>⭐</Text> : null}
          {m.locked ? <Text style={styles.favMark}>🔒</Text> : null}
          {m.archived ? <Text style={styles.tagBadge}>🗄️ בארכיון</Text> : null}
          {slot ? <Text style={styles.tagBadge}>🗂️ {slot.label}</Text> : null}
          {ex ? (
            <Text style={[styles.expiryBadge, ex.bad && styles.expiryBad]}>
              {renewDue ? '🔁 הגיע זמן החידוש' : `${m.renewYearly ? '🔁' : '⏰'} ${ex.text}`}
            </Text>
          ) : null}
          {(m.tags ?? []).map((t) => (
            <Text key={t} style={styles.tagBadge}>
              🏷️ {t}
            </Text>
          ))}
        </View>
        {m.note ? (
          <Text style={styles.noteLine} numberOfLines={1}>
            📝 {m.note}
          </Text>
        ) : null}
      </>
    );
  };

  const row = (e: DocEntry) => {
    const sel = selected?.has(e.uri);
    const t = e.isDir ? null : typeOf(e.mime);
    return (
      <View
        key={e.uri}
        ref={(v) => {
          if (!v) delete targetRefs.current[e.uri];
          else if (e.isDir || current) targetRefs.current[e.uri] = v;
        }}
        collapsable={false}
      >
      <TouchableOpacity
        style={[styles.row, sel && styles.rowSel, hover === e.uri && styles.dropHover, drag?.e.uri === e.uri && styles.dragSource]}
        onPress={() => openEntry(e)}
        onLongPress={undefined}
        delayLongPress={300}
      >
        {selected && !e.isDir ? <View style={[styles.check, sel && styles.checkOn]}>{sel ? <Text style={styles.checkMark}>✓</Text> : null}</View> : null}
        <View style={[styles.typeStripe, { backgroundColor: t ? TYPE_COLORS[t] : 'transparent' }]} />
        <Thumb e={e} size={44} styles={styles} locked={!!meta[e.uri]?.locked} />
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
      </View>
    );
  };

  const tile = (e: DocEntry) => {
    const sel = selected?.has(e.uri);
    return (
      <View
        key={e.uri}
        ref={(v) => {
          if (!v) delete targetRefs.current[e.uri];
          else if (e.isDir || current) targetRefs.current[e.uri] = v;
        }}
        collapsable={false}
      >
      <TouchableOpacity
        style={[styles.tile, { width: cell }, sel && styles.rowSel, hover === e.uri && styles.dropHover, drag?.e.uri === e.uri && styles.dragSource]}
        onPress={() => openEntry(e)}
        onLongPress={undefined}
        delayLongPress={300}
      >
        <Thumb e={e} size={cell - 12} styles={styles} locked={!!meta[e.uri]?.locked} />
        {meta[e.uri]?.fav ? <Text style={styles.tileFav}>⭐</Text> : null}
        {sel ? (
          <View style={[styles.check, styles.checkOn, styles.tileCheck]}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        ) : null}
        <Text style={styles.tileName} numberOfLines={2}>
          {e.name}
        </Text>
        {!e.isDir && !selected ? (
          <TouchableOpacity onPress={() => openMenu(e)} hitSlop={10} style={styles.tileMore}>
            <Text style={styles.moreText}>⋮</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      </View>
    );
  };

  const items = (list: DocEntry[]) =>
    view === 'grid' ? (
      <View style={styles.grid}>{list.map((e) => (e.isDir ? tile(e) : draggable(e, tile(e))))}</View>
    ) : (
      <View>{list.map((e) => (e.isDir ? row(e) : draggable(e, row(e))))}</View>
    );

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
      {current ? (
        <TouchableOpacity
          style={styles.selectBtn}
          onPress={() => selected.size && openMoveTo(entries.filter((e) => selected.has(e.uri)))}
        >
          <Text style={styles.selectBtnText}>📂 העבר</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.selectBtn} onPress={mergeSelected}>
        <Text style={styles.selectBtnText}>📕 ל-PDF</Text>
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
          {canPreview(menu.mime) ? (
            <>
              {preview?.uri !== menu.uri ? (
                <MenuItem styles={styles} label="👁️  הצג" onPress={() => { const e = menu; closeMenu(); openEntry(e); }} />
              ) : null}
              <MenuItem
                styles={styles}
                label="↗️  פתח באפליקציה אחרת"
                onPress={async () => {
                  const e = menu;
                  if (m?.locked && !(await ensureUnlocked('פתיחת מסמך נעול'))) return;
                  closeMenu();
                  openExternal(e);
                }}
              />
            </>
          ) : (
            <MenuItem styles={styles} label="📂  פתח" onPress={() => { const e = menu; closeMenu(); openEntry(e); }} />
          )}
          <MenuItem styles={styles} label={m?.fav ? '☆  הסר ממועדפים' : '⭐  הוסף למועדפים'} onPress={() => toggleFav(menu)} />
          <MenuItem
            styles={styles}
            label={m?.expiry ? `⏰  תוקף: ${displayYMD(m.expiry)}` : '⏰  קבע תוקף ותזכורת'}
            onPress={() => setPanel('expiry')}
          />
          {m?.renewYearly && m.expiry && daysUntil(m.expiry) <= 30 ? (
            <MenuItem styles={styles} label={`🔁  חידשתי – העבר ל-${displayYMD(addYear(m.expiry))}`} onPress={() => renewNow(menu)} />
          ) : null}
          <MenuItem
            styles={styles}
            label={m?.note ? '📝  ערוך הערה' : '📝  הוסף הערה'}
            onPress={() => {
              setNoteText(m?.note ?? '');
              setPanel('note');
            }}
          />
          <MenuItem
            styles={styles}
            label={m?.tags?.length ? `🏷️  תגיות: ${m.tags.join(', ')}` : '🏷️  תגיות'}
            onPress={() => {
              setNewTag('');
              setPanel('tags');
            }}
          />
          <MenuItem
            styles={styles}
            label={slotOf(m?.personal) ? `🗂️  בתיק האישי: ${slotOf(m?.personal)!.label}` : '🗂️  הוסף לתיק האישי'}
            onPress={() => setPanel('personal')}
          />
          <MenuItem styles={styles} label="🔗  צרף למשימה או לפתק" onPress={() => setPanel('link')} />
          <MenuItem
            styles={styles}
            label="📤  שיתוף"
            onPress={async () => {
              if (m?.locked && !(await ensureUnlocked('שיתוף מסמך נעול'))) return;
              GeoAlarm.shareDocument(menu.uri, menu.mime);
            }}
          />
          {canPreview(menu.mime) ? (
            <MenuItem styles={styles} label="📦  שיתוף מכווץ (קובץ קטן לוואטסאפ ומייל)" onPress={() => shareSmall(menu)} />
          ) : null}
          {canPreview(menu.mime) ? <MenuItem styles={styles} label="✍️  חתימה על המסמך" onPress={() => startSign(menu)} /> : null}
          {canPreview(menu.mime) ? (
            <MenuItem styles={styles} label="🔎  זהה טקסט (הצעת שם ותוקף)" onPress={() => readDocText(menu)} />
          ) : null}
          {menu.mime.includes('pdf') || menu.mime.startsWith('image/') ? (
            <MenuItem
              styles={styles}
              label="🔐  שיתוף כ-PDF עם סיסמה"
              onPress={() => {
                setPassword('');
                setPanel('protect');
              }}
            />
          ) : null}
          <MenuItem styles={styles} label={m?.locked ? '🔓  בטל נעילה' : '🔒  נעל (טביעת אצבע)'} onPress={() => toggleLock(menu)} />
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
          {current ? <MenuItem styles={styles} label="📂  העבר אל…" onPress={() => openMoveTo([menu])} /> : null}
          {menu.mime === 'application/pdf' ? (
            <MenuItem styles={styles} label="➕  הוסף עמודים" onPress={() => setPanel('pages')} />
          ) : null}
          {menu.mime === 'application/pdf' ? (
            <MenuItem styles={styles} label="🔄  סובב עמודים" onPress={() => setPanel('rotate')} />
          ) : null}
          <MenuItem styles={styles} label={m?.archived ? '📤  הוצא מהארכיון' : '🗄️  העבר לארכיון'} onPress={() => toggleArchive(menu)} />
          <MenuItem styles={styles} label="🗑️  מחיקה" danger onPress={() => doDelete(menu)} />
        </>
      ) : null}

      {menu && panel === 'ocr' ? (
        !ocr ? (
          <View style={{ paddingVertical: 20 }}>
            <ActivityIndicator />
            <Text style={[styles.hint, { textAlign: 'center' }]}>⏳ קורא את הטקסט (בתוך הטלפון)…</Text>
          </View>
        ) : (
          <>
            {!ocr.text || !ocr.text.trim() ? (
              <Text style={styles.hint}>לא הצלחתי לקרוא טקסט מהקובץ (אולי הסריקה לא חדה, או שהקובץ מוגן).</Text>
            ) : null}
            {ocr.sg.name ? (
              <MenuItem
                styles={styles}
                label={`✏️  שנה שם ל"${ocr.sg.name}"`}
                onPress={() => {
                  setRenameText(ocr.sg.name!);
                  setPanel('rename');
                }}
              />
            ) : null}
            {ocr.sg.expiry ? (
              <MenuItem
                styles={styles}
                label={`📅  קבע תוקף ${displayYMD(ocr.sg.expiry)}${ocr.sg.expiryByKeyword ? '' : ' (ניחוש)'}`}
                onPress={async () => {
                  await applySuggest(menu, ocr.sg.expiry);
                  setPanel('expiry');
                }}
              />
            ) : null}
            {slotOf(ocr.sg.slot) && m?.personal !== ocr.sg.slot ? (
              <MenuItem
                styles={styles}
                label={`🗂️  הוסף לתיק האישי: ${slotOf(ocr.sg.slot)!.label}`}
                onPress={async () => {
                  await applySuggest(menu, undefined, ocr.sg.slot);
                  setPanel('menu');
                }}
              />
            ) : null}
            {ocr.sg.tag && !(m?.tags ?? []).includes(ocr.sg.tag) ? (
              <MenuItem
                styles={styles}
                label={`🏷️  הוסף תגית: ${ocr.sg.tag}`}
                onPress={() => applySuggest(menu, undefined, undefined, ocr.sg.tag)}
              />
            ) : null}
            {ocr.text && ocr.text.trim() && !ocr.sg.name && !ocr.sg.expiry ? (
              <Text style={styles.hint}>לא מצאתי שם או תאריך תוקף בטקסט.</Text>
            ) : null}
            {ocr.text && ocr.text.trim() ? (
              <>
                <Text style={styles.label}>הטקסט שזוהה</Text>
                <Text style={styles.ocrText} selectable>
                  {ocr.text.trim().slice(0, 1500)}
                </Text>
              </>
            ) : null}
          </>
        )
      ) : null}

      {menu && panel === 'note' ? (
        <>
          <Text style={styles.hint}>הערה חופשית למסמך (למשל מספר פוליסה, טלפון של הסוכן, איפה המקור). אפשר לחפש לפי ההערה.</Text>
          <TextInput
            style={[styles.input, styles.noteInput]}
            value={noteText}
            onChangeText={setNoteText}
            placeholder="כתוב הערה…"
            placeholderTextColor={c.muted}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <TouchableOpacity style={styles.bigBtn} onPress={() => saveNote(menu)}>
            <Text style={styles.bigBtnText}>שמור</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {menu && panel === 'tags' ? (
        <>
          <Text style={styles.hint}>לחץ על תגית כדי לסמן או להסיר. במסך הראשי של המסמכים אפשר לראות את כל המסמכים של תגית.</Text>
          <View style={styles.chipsWrap}>
            {allTags(meta).map(({ tag }) => {
              const on = (m?.tags ?? []).includes(tag);
              return (
                <TouchableOpacity key={tag} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleTag(menu, tag)}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.tagAddRow}>
            <TextInput
              style={[styles.input, styles.flex1]}
              value={newTag}
              onChangeText={setNewTag}
              placeholder="תגית חדשה"
              placeholderTextColor={c.muted}
              onSubmitEditing={() => addTag(menu)}
            />
            <TouchableOpacity style={styles.tagAddBtn} onPress={() => addTag(menu)}>
              <Text style={styles.bigBtnText}>הוסף</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.bigBtn} onPress={() => setPanel('menu')}>
            <Text style={styles.bigBtnText}>סיום</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {menu && panel === 'personal' ? (
        <>
          <Text style={styles.hint}>איזה מסמך זה? הוא יופיע ב"תיק האישי" ותוכל לראות שם מה חסר ומה פג תוקף.</Text>
          {PERSONAL_SLOTS.map((slot) => {
            const on = m?.personal === slot.key;
            const other = !on ? personalState.bySlot.get(slot.key) : undefined;
            return (
              <MenuItem
                key={slot.key}
                styles={styles}
                label={`${on ? '●' : '○'}  ${slot.icon} ${slot.label}${other ? '  (יחליף את הקיים)' : ''}`}
                onPress={async () => {
                  await assignSlot(menu, on ? null : slot.key);
                  setPanel('menu');
                }}
              />
            );
          })}
        </>
      ) : null}

      {menu && panel === 'pages' ? (
        <>
          <Text style={styles.popupHint}>העמודים החדשים יתווספו בסוף הקובץ.</Text>
          <MenuItem styles={styles} label="📷  סרוק עמודים" onPress={() => addPages(menu, 'scan')} />
          <MenuItem styles={styles} label="🖼️  תמונות מהגלריה" onPress={() => addPages(menu, 'gallery')} />
        </>
      ) : null}

      {menu && panel === 'rotate' ? (
        <>
          <Text style={styles.popupHint}>כל העמודים בקובץ יסתובבו.</Text>
          {(
            [
              [90, '↻  90° ימינה'],
              [180, '🔃  180° (דף הפוך)'],
              [270, '↺  90° שמאלה'],
            ] as [number, string][]
          ).map(([deg, label]) => (
            <MenuItem
              key={deg}
              styles={styles}
              label={label}
              onPress={async () => {
                const e = menu;
                closeMenu();
                setScanBusy(true);
                const ok = await GeoAlarm.rotatePdf(e.uri, deg);
                setScanBusy(false);
                if (!ok) Alert.alert('סיבוב', 'לא הצלחתי לסובב את הקובץ.');
                refresh();
              }}
            />
          ))}
        </>
      ) : null}

      {menu && panel === 'protect' ? (
        <>
          <Text style={styles.hint}>
            ישותף עותק של הקובץ שנפתח רק עם הסיסמה. הקובץ אצלך נשאר בלי סיסמה. את הסיסמה כדאי לשלוח בנפרד (למשל בהודעה אחרת).
          </Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="סיסמה (לפחות 4 תווים)"
            placeholderTextColor={c.muted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => shareProtected(menu)}
          />
          <TouchableOpacity style={styles.bigBtn} onPress={() => shareProtected(menu)}>
            <Text style={styles.bigBtnText}>🔐 שתף עם סיסמה</Text>
          </TouchableOpacity>
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
              <MenuItem
                styles={styles}
                label={`${m.renewYearly ? '☑' : '☐'}  🔁 מסמך שמתחדש כל שנה (רישיון רכב, ביטוח…)`}
                onPress={() => toggleRenew(menu)}
              />
              {m.renewYearly ? (
                <>
                  <Text style={styles.hint}>
                    כשתחדש, לחץ "חידשתי" והתוקף והתזכורת יעברו לשנה הבאה ({displayYMD(addYear(m.expiry))}).
                  </Text>
                  <MenuItem styles={styles} label="🔁  חידשתי – העבר לשנה הבאה" onPress={() => renewNow(menu)} />
                </>
              ) : null}
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

  const moveFolder = movePath[movePath.length - 1];
  const moveToPopup = (
    <PopupShell
      visible={!!moveItems}
      title={moveItems && moveItems.length > 1 ? `העברת ${moveItems.length} קבצים` : `העברת "${moveItems?.[0]?.name ?? ''}"`}
      onClose={() => setMoveItems(null)}
      yellow={false}
    >
      {movePath.length ? (
        <TouchableOpacity onPress={() => setMovePath(movePath.slice(0, -1))} style={styles.back}>
          <Text style={styles.backText}>› {movePath.length > 1 ? movePath[movePath.length - 2].name : 'כל התיקיות'}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.section}>{moveFolder ? `📂 ${moveFolder.name}` : 'בחר תיקייה'}</Text>
      {!moveFolder
        ? folders.map((f) => (
            <MenuItem key={f.uri} styles={styles} label={`📁  ${f.name}`} onPress={() => setMovePath([f])} />
          ))
        : moveDirs === null
          ? <ActivityIndicator style={styles.spinner} />
          : moveDirs.map((d) => (
              <MenuItem
                key={d.uri}
                styles={styles}
                label={`📁  ${d.name}  ‹`}
                onPress={() => setMovePath([...movePath, { uri: d.uri, name: d.name }])}
              />
            ))}
      {moveFolder && moveDirs && moveDirs.length === 0 ? <Text style={styles.popupHint}>אין כאן תת-תיקיות.</Text> : null}
      {moveFolder ? (
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionPrimary, { marginTop: 12 }]}
          onPress={() => moveItems && moveTo(moveItems, moveFolder)}
        >
          <Text style={styles.actionPrimaryText}>📥 העבר לכאן</Text>
        </TouchableOpacity>
      ) : null}
    </PopupShell>
  );

  const qualityPopup = (
    <PopupShell visible={qualityPick} title="איכות סריקה" onClose={() => setQualityPick(false)} yellow={false}>
      {(Object.keys(QUALITY_LABEL) as ScanQuality[]).map((q) => (
        <MenuItem
          key={q}
          styles={styles}
          label={`${quality === q ? '●' : '○'}  ${QUALITY_LABEL[q]}`}
          onPress={() => {
            setQuality(q);
            saveScanQuality(q);
            setQualityPick(false);
          }}
        />
      ))}
      <Text style={styles.popupHint}>"מקורי" שומר את ה-PDF של הסורק בלי הניקוי שלי.</Text>
    </PopupShell>
  );

  const qualityLine = (
    <TouchableOpacity onPress={() => setQualityPick(true)} hitSlop={6}>
      <Text style={styles.popupHint}>📷 איכות סריקה: {QUALITY_LABEL[quality]} ▾</Text>
    </TouchableOpacity>
  );

  const ghost = drag ? (
    <View
      pointerEvents="none"
      style={[styles.ghost, { left: Math.max(4, drag.x - rootPos.current.x - 110), top: drag.y - rootPos.current.y - 70 }]}
    >
      <Text style={styles.ghostText} numberOfLines={1}>
        {docIcon(drag.e.mime)} {drag.e.name}
      </Text>
      <Text style={styles.ghostSub}>
        {!hover ? 'גרור אל תיקייה או בין קבצים' : entries.some((x) => x.uri === hover && !x.isDir) ? 'שחרר כדי לסדר כאן' : 'שחרר כדי להעביר'}
      </Text>
    </View>
  ) : null;

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
      {!current && folders.length > 1 ? (
        <>
          <Text style={styles.popupHint}>איפה ליצור?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {folders.map((f) => (
              <TouchableOpacity
                key={f.uri}
                style={[styles.chip, newFolderParent?.uri === f.uri && styles.chipOn]}
                onPress={() => setNewFolderParent(f)}
              >
                <Text style={[styles.chipText, newFolderParent?.uri === f.uri && styles.chipTextOn]}>📁 {f.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionPrimary, !current && !newFolderParent && { opacity: 0.5 }]}
        disabled={!current && !newFolderParent}
        onPress={createFolder}
      >
        <Text style={styles.actionPrimaryText}>צור</Text>
      </TouchableOpacity>
    </PopupShell>
  );

  const foldersPopup = (
    <PopupShell visible={foldersOpen && !folderHelp} title="📁 תיקיות" onClose={() => setFoldersOpen(false)} yellow={false}>
      <Text style={styles.helpText}>המסמכים נשמרים בתיקיות שבטלפון שלך. מה תרצה לעשות?</Text>
      <TouchableOpacity
        style={styles.folderChoice}
        onPress={() => {
          setFoldersOpen(false);
          startNewFolder();
        }}
      >
        <Text style={styles.folderChoiceTitle}>➕ ליצור תיקייה חדשה</Text>
        <Text style={styles.rowSub}>תיקייה ריקה למסמכים, למשל "מסמכים של הבית".</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.folderChoice}
        onPress={() => {
          setFoldersOpen(false);
          connectFolder();
        }}
      >
        <Text style={styles.folderChoiceTitle}>📂 להשתמש בתיקייה שכבר יש בטלפון</Text>
        <Text style={styles.rowSub}>למשל "Documents" או "תמונות". הקבצים נשארים במקום שלהם, שום דבר לא מועתק.</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setFolderHelp(true)} hitSlop={8}>
        <Text style={styles.helpLink}>❓ איך זה עובד</Text>
      </TouchableOpacity>
    </PopupShell>
  );

  const folderHelpPopup = (
    <PopupShell
      visible={folderHelp}
      title="❓ איך עובדות התיקיות"
      onClose={closeFolderHelp}
      yellow={false}
      footer={
        <TouchableOpacity style={styles.bigBtn} onPress={closeFolderHelp}>
          <Text style={styles.bigBtnText}>הבנתי 👍</Text>
        </TouchableOpacity>
      }
    >
      <Text style={styles.helpHead}>➕ תיקייה חדשה</Text>
      <Text style={styles.helpText}>1. לוחצים "ליצור תיקייה חדשה".</Text>
      <Text style={styles.helpText}>2. כותבים שם, למשל "קבלות", ולוחצים "צור".</Text>
      <Text style={styles.helpText}>
        בפעם הראשונה בלבד הטלפון ישאל איפה לשמור. בוחרים "Documents" (מסמכים), ולמטה לוחצים "שימוש בתיקייה הזו" ואז "אישור".
      </Text>

      <Text style={styles.helpHead}>📂 תיקייה שכבר יש בטלפון</Text>
      <Text style={styles.helpText}>1. לוחצים "להשתמש בתיקייה שכבר יש בטלפון".</Text>
      <Text style={styles.helpText}>2. נפתחת רשימת התיקיות של הטלפון. לוחצים על התיקייה שרוצים.</Text>
      <Text style={styles.helpText}>3. למטה לוחצים "שימוש בתיקייה הזו", ואז "אישור".</Text>
      <Text style={styles.helpText}>זהו. התיקייה מופיעה ברשימה כאן.</Text>

      <Text style={styles.helpHead}>💡 טוב לדעת</Text>
      <Text style={styles.helpText}>• לא רואים את התיקייה? לוחצים על ☰ למעלה משמאל ובוחרים את שם הטלפון.</Text>
      <Text style={styles.helpText}>• "נתק" רק מוריד את התיקייה מהרשימה כאן. הקבצים לא נמחקים.</Text>
      <Text style={styles.helpText}>• אפשר לפתוח את ההסבר הזה שוב דרך "📁 תיקיות" ← "❓ איך זה עובד".</Text>
    </PopupShell>
  );

  const trashBytes = trashSize(trash);
  const trashFull = trashBytes > TRASH_WARN_BYTES;
  const trashSummary = trash.length
    ? `${trash.length === 1 ? 'מסמך אחד' : `${trash.length} מסמכים`}, ${sizeText(trashBytes) || '0 KB'}`
    : 'ריק';
  const trashRow = (
    <TouchableOpacity style={[styles.row, trashFull && styles.trashFull]} onPress={() => setTrashOpen(true)}>
      <Text style={styles.folderIcon}>🗑️</Text>
      <View style={styles.flex1}>
        <Text style={styles.rowTitle}>סל מחזור · {trashSummary}</Text>
        <Text style={[styles.rowSub, trashFull && styles.danger]}>
          {trashFull ? '⚠️ הסל תופס הרבה מקום – כדאי לרוקן אותו' : `מסמכים שנמחקו נשמרים כאן ${TRASH_DAYS} יום`}
        </Text>
      </View>
      <Text style={styles.chev}>‹</Text>
    </TouchableOpacity>
  );

  const lockedBar = (count: number) =>
    showLocked ? (
      <TouchableOpacity onPress={() => setShowLocked(false)} hitSlop={6}>
        <Text style={styles.popupHint}>🔓 מוצגים גם המסמכים הנעולים · הסתר אותם</Text>
      </TouchableOpacity>
    ) : count ? (
      <TouchableOpacity onPress={revealLocked} hitSlop={6}>
        <Text style={styles.popupHint}>
          🔒 {count === 1 ? 'מסמך נעול אחד מוסתר' : `${count} מסמכים נעולים מוסתרים`} · הצג (טביעת אצבע)
        </Text>
      </TouchableOpacity>
    ) : null;

  const trashPopup = (
    <PopupShell
      visible={trashOpen}
      title={`🗑️ סל מחזור · ${trashSummary}`}
      onClose={() => setTrashOpen(false)}
      yellow={false}
      footer={
        trash.length ? (
          <TouchableOpacity style={[styles.bigBtn, styles.dangerBtn]} onPress={doEmptyTrash}>
            <Text style={styles.bigBtnText}>🗑️ רוקן סל</Text>
          </TouchableOpacity>
        ) : undefined
      }
    >
      {trashFull ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>הסל עבר 100MB. כדאי לרוקן אותו כדי לפנות מקום בטלפון.</Text>
        </View>
      ) : null}
      {trash.length === 0 ? (
        <Text style={styles.empty}>הסל ריק. מסמך שתמחק יישמר כאן {TRASH_DAYS} יום, ואז יימחק לבד.</Text>
      ) : (
        <Text style={styles.popupHint}>מסמכים נמחקים מכאן לבד אחרי {TRASH_DAYS} יום.</Text>
      )}
      {trash.map((t) => {
        const secret = !!t.meta?.locked && !showLocked;
        const left = daysLeft(t);
        return (
          <View key={t.id} style={styles.trashItem}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {secret ? '🔒 מסמך נעול' : `${docIcon(t.mime)} ${t.name}`}
            </Text>
            <Text style={styles.rowSub}>
              {sizeText(t.size)} · נמחק {new Date(t.deletedAt).toLocaleDateString('he-IL')} ·{' '}
              {left === 0 ? 'יימחק היום' : `יימחק סופית בעוד ${left} ימים`}
            </Text>
            <View style={styles.trashBtns}>
              <TouchableOpacity style={styles.trashBtn} onPress={() => restoreItem(t)}>
                <Text style={styles.actionText}>↩️ שחזר</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.trashBtn} onPress={() => deleteItemForever(t)}>
                <Text style={[styles.actionText, styles.danger]}>✖ מחק לצמיתות</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </PopupShell>
  );

  // ---------- documents stage C popups ----------
  const previewEl = (
    <DocPreview
      entry={preview}
      meta={preview ? meta[preview.uri] : undefined}
      onClose={() => setPreview(null)}
      onOpenExternal={openExternal}
      onShare={(e) => GeoAlarm.shareDocument(e.uri, e.mime)}
      onMenu={openMenu}
    />
  );

  const listPopup = (
    <PopupShell
      visible={!!listView}
      title={listView?.kind === 'archive' ? `🗄️ ארכיון · ${listItems.length}` : `🏷️ ${listView?.kind === 'tag' ? listView.tag : ''} · ${listItems.length}`}
      onClose={() => setListView(null)}
      yellow={false}
    >
      {listView?.kind === 'archive' ? (
        <Text style={styles.popupHint}>
          מסמכים ישנים שלא צריך לראות כל יום. הקבצים נשארים במקומם, רק מוסתרים מהרשימות ובלי תזכורות תוקף. ⋮ ← "הוצא מהארכיון" כדי להחזיר.
        </Text>
      ) : null}
      {listItems.length === 0 ? <Text style={styles.empty}>אין כאן מסמכים.</Text> : null}
      <View>{listItems.map(row)}</View>
    </PopupShell>
  );

  const personalPopup = (
    <PopupShell visible={personalOpen} title="🗂️ תיק אישי" onClose={() => setPersonalOpen(false)} yellow={false}>
      <Text style={styles.popupHint}>
        המסמכים החשובים במקום אחד. מסמך שכבר שמור: ⋮ ליד המסמך ← "הוסף לתיק האישי". מסמך חדש: "📷 סרוק".
      </Text>
      {PERSONAL_SLOTS.filter((sl) => !personalHidden.includes(sl.key)).map((slot) => {
        const d = personalState.bySlot.get(slot.key);
        const dm = d?.[1];
        const secret = !!dm?.locked && !showLocked;
        const ex = dm?.expiry ? expiryText(dm.expiry) : null;
        const renewDue = dm?.renewYearly && dm.expiry && daysUntil(dm.expiry) < 0;
        return (
          <View key={slot.key} style={[styles.slot, !d && styles.slotMissing, ex?.bad && styles.slotBad]}>
            <View style={styles.slotHead}>
              <Text style={styles.slotIcon}>{slot.icon}</Text>
              <View style={styles.flex1}>
                <Text style={styles.rowTitle}>{slot.label}</Text>
                {!d ? (
                  <Text style={[styles.rowSub, styles.danger]}>❌ חסר</Text>
                ) : (
                  <>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      ✅ {secret ? '🔒 מסמך נעול' : dm!.name}
                    </Text>
                    {ex ? (
                      <Text style={[styles.rowSub, ex.bad && styles.danger]}>
                        {renewDue ? '🔁 הגיע זמן החידוש' : `${dm!.renewYearly ? '🔁' : '⏰'} ${ex.text}`}
                      </Text>
                    ) : slot.expires ? (
                      <Text style={styles.rowSub}>⏰ לא הוגדר תוקף (⋮ ← קבע תוקף)</Text>
                    ) : null}
                  </>
                )}
              </View>
              {d ? (
                <TouchableOpacity onPress={() => openMenu(metaEntry(d[0], d[1]))} hitSlop={12} style={styles.moreBtn}>
                  <Text style={styles.moreText}>⋮</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.trashBtns}>
              {d ? (
                <TouchableOpacity style={styles.trashBtn} onPress={() => openEntry(metaEntry(d[0], d[1]))}>
                  <Text style={styles.actionText}>👁️ הצג</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={styles.trashBtn} onPress={() => scanToSlot(slot)}>
                    <Text style={styles.actionText}>{slot.card ? '🪪 סרוק 2 צדדים' : '📷 סרוק'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.trashBtn} onPress={() => toggleSlotHidden(slot.key)}>
                    <Text style={styles.actionText}>לא רלוונטי לי</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );
      })}
      {personalHidden.length ? (
        <>
          <Text style={styles.label}>לא רלוונטי לי</Text>
          <View style={styles.chipsWrap}>
            {PERSONAL_SLOTS.filter((sl) => personalHidden.includes(sl.key)).map((sl) => (
              <TouchableOpacity key={sl.key} style={styles.chip} onPress={() => toggleSlotHidden(sl.key)}>
                <Text style={styles.chipText}>
                  ↩️ {sl.icon} {sl.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
    </PopupShell>
  );

  const dupesCount = (dupes ?? []).reduce((n, g) => n + g.length - 1, 0);
  const dupesBytes = (dupes ?? []).reduce((n, g) => n + (g[0]?.size ?? 0) * (g.length - 1), 0);
  const dupesPopup = (
    <PopupShell
      visible={!!dupes}
      title={dupes && dupes.length ? `🧹 קבצים כפולים · ${dupesCount}` : '🧹 קבצים כפולים'}
      onClose={() => setDupes(null)}
      yellow={false}
    >
      {dupes && dupes.length === 0 ? (
        <Text style={styles.empty}>✓ לא נמצאו קבצים כפולים בתיקיות המחוברות.</Text>
      ) : (
        <Text style={styles.popupHint}>
          קבצים עם תוכן זהה לגמרי (גם אם השם שונה). מחיקה מעבירה לסל המחזור. אפשר לפנות {sizeText(dupesBytes)}.
        </Text>
      )}
      {(dupes ?? []).map((g) => (
        <View key={g[0].uri} style={styles.slot}>
          <Text style={styles.rowTitle}>
            📑 {g.length} עותקים זהים · {sizeText(g[0].size)}
          </Text>
          {g.map((e, i) => {
            const secret = !!meta[e.uri]?.locked && !showLocked;
            return (
              <View key={e.uri} style={styles.dupeItem}>
                <View style={styles.flex1}>
                  <Text style={styles.dupeName} numberOfLines={2}>
                    {i === 0 ? '✅ ' : ''}
                    {secret ? '🔒 מסמך נעול' : `${docIcon(e.mime)} ${e.name}`}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    📂 {e.folder}
                    {e.modified ? ` · ${new Date(e.modified).toLocaleDateString('he-IL')}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => openEntry(e)} hitSlop={8} style={styles.moreBtn}>
                  <Text style={styles.dupeBtn}>👁️</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    confirm('מחיקה', `להעביר את "${e.name}" לסל המחזור?`, 'מחק', () => trashDocs([e]))
                  }
                  hitSlop={8}
                  style={styles.moreBtn}
                >
                  <Text style={styles.dupeBtn}>🗑️</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity style={[styles.trashBtn, { marginTop: 8 }]} onPress={() => dupeKeepFirst(g)}>
            <Text style={styles.actionText}>🧹 השאר את המסומן ✅ ומחק את השאר</Text>
          </TouchableOpacity>
        </View>
      ))}
    </PopupShell>
  );

  const dateBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} keyboardShouldPersistTaps="handled">
      {DATE_FILTERS.map(([k, label]) => (
        <TouchableOpacity key={k} style={[styles.chip, dateFilter === k && styles.chipOn]} onPress={() => setDateFilter(k)}>
          <Text style={[styles.chipText, dateFilter === k && styles.chipTextOn]}>📅 {label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const archivedBar = (count: number) =>
    showArchived ? (
      <TouchableOpacity onPress={() => setShowArchived(false)} hitSlop={6}>
        <Text style={styles.popupHint}>🗄️ מוצגים גם מסמכים מהארכיון · הסתר אותם</Text>
      </TouchableOpacity>
    ) : count ? (
      <TouchableOpacity onPress={() => setShowArchived(true)} hitSlop={6}>
        <Text style={styles.popupHint}>🗄️ {count === 1 ? 'מסמך אחד בארכיון מוסתר' : `${count} מסמכים בארכיון מוסתרים`} · הצג</Text>
      </TouchableOpacity>
    ) : null;

  const stageCPopups = (
    <>
      {listPopup}
      {personalPopup}
      {foldersPopup}
      {folderHelpPopup}
      {dupesPopup}
      {previewEl}
      <DocSign entry={signing} onClose={() => setSigning(null)} onSigned={onSigned} />
    </>
  );

  // ---------- home ----------
  if (!current) {
    const showingSearch = search.trim().length >= 2;
    return (
      <View style={styles.flex1} ref={rootRef} collapsable={false} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!drag}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>מסמכים</Text>
            {viewToggle}
          </View>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={() => scan()}>
              <Text style={styles.actionPrimaryText}>📷 סרוק מסמך</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={openFolders}>
              <Text style={styles.actionText}>📁 תיקיות</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionsRow2}>
            <TouchableOpacity style={styles.actionBtn} onPress={imagesToPdf}>
              <Text style={styles.actionText}>🖼️ תמונות ל-PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => scan(true)}>
              <Text style={styles.actionText}>🪪 כרטיס (2 צדדים)</Text>
            </TouchableOpacity>
          </View>
          {scanBusy ? <Text style={styles.popupHint}>⏳ משפר את הדפים הסרוקים…</Text> : qualityLine}
          <TextInput
            style={styles.input}
            placeholder="🔍 חיפוש בכל התיקיות"
            placeholderTextColor={c.muted}
            value={search}
            onChangeText={setSearch}
          />
          {filterBar}
          {showingSearch ? dateBar : null}
          {lockedBar(Object.values(meta).filter((x) => x.locked).length)}

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
              <TouchableOpacity style={styles.row} onPress={() => setPersonalOpen(true)}>
                <Text style={styles.folderIcon}>🗂️</Text>
                <View style={styles.flex1}>
                  <Text style={styles.rowTitle}>תיק אישי</Text>
                  <Text style={[styles.rowSub, (personalState.missing > 0 || personalState.bad > 0) && styles.danger]}>
                    {[
                      personalState.ok ? `✅ ${personalState.ok} תקינים` : '',
                      personalState.bad ? `⚠️ ${personalState.bad} פג/פג בקרוב` : '',
                      personalState.missing ? `❌ ${personalState.missing} חסרים` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'תעודת זהות, רישיון, דרכון…'}
                  </Text>
                </View>
                <Text style={styles.chev}>‹</Text>
              </TouchableOpacity>
              {tagList.length ? (
                <>
                  <Text style={styles.section}>🏷️ תגיות</Text>
                  <View style={styles.chipsWrap}>
                    {tagList.map(({ tag, count }) => (
                      <TouchableOpacity key={tag} style={styles.chip} onPress={() => setListView({ kind: 'tag', tag })}>
                        <Text style={styles.chipText}>
                          {tag} · {count}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}
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
                  עוד אין תיקיות. לחץ על "📁 תיקיות" למעלה כדי ליצור תיקייה חדשה או להשתמש בתיקייה שכבר יש בטלפון.
                </Text>
              ) : null}
              {folders.map((f) => (
                <View
                  key={f.uri}
                  collapsable={false}
                  ref={(v) => {
                    if (v) targetRefs.current['root:' + f.uri] = v;
                    else delete targetRefs.current['root:' + f.uri];
                  }}
                >
                <TouchableOpacity style={[styles.row, hover === 'root:' + f.uri && styles.dropHover]} onPress={() => setPath([f])} onLongPress={() => disconnect(f)}>
                  <Text style={styles.folderIcon}>📂</Text>
                  <View style={styles.flex1}>
                    <Text style={styles.rowTitle}>{f.name}</Text>
                    <Text style={styles.rowSub}>לחיצה ארוכה לניתוק</Text>
                  </View>
                  <Text style={styles.chev}>‹</Text>
                </TouchableOpacity>
                </View>
              ))}
              <Text style={styles.section}>🧰 כלים</Text>
              <TouchableOpacity style={styles.row} onPress={() => setListView({ kind: 'archive' })}>
                <Text style={styles.folderIcon}>🗄️</Text>
                <View style={styles.flex1}>
                  <Text style={styles.rowTitle}>ארכיון · {archived.length ? `${archived.length} מסמכים` : 'ריק'}</Text>
                  <Text style={styles.rowSub}>מסמכים ישנים, מוסתרים מהרשימות</Text>
                </View>
                <Text style={styles.chev}>‹</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.row} onPress={findDupes}>
                <Text style={styles.folderIcon}>🧹</Text>
                <View style={styles.flex1}>
                  <Text style={styles.rowTitle}>חיפוש קבצים כפולים</Text>
                  <Text style={styles.rowSub}>מוצא קבצים זהים בכל התיקיות המחוברות</Text>
                </View>
                <Text style={styles.chev}>‹</Text>
              </TouchableOpacity>
              {trashRow}
            </>
          )}
        </ScrollView>
        {selectBar}
        {ghost}
        {menuPopup}
        {saver.element}
        {qualityPopup}
        {newFolderPopup}
        {trashPopup}
        {stageCPopups}
      </View>
    );
  }

  // ---------- browsing a folder ----------
  return (
    <View style={styles.flex1} ref={rootRef} collapsable={false} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {drag && path.length > 1 ? (
        <View
          ref={(v) => {
            targetRefs.current.__up = v;
          }}
          collapsable={false}
          onLayout={() =>
            targetRefs.current.__up?.measureInWindow((x, y, w, h) => {
              targetRects.current.__up = { x, y, w, h };
            })
          }
          style={[styles.upBar, hover === '__up' && styles.dropHover]}
        >
          <Text style={styles.upBarText}>⬆ שחרר כאן להעברה ל"{path[path.length - 2].name}"</Text>
        </View>
      ) : null}
      <FlatList
        scrollEnabled={!drag}
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
              <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={() => scan()}>
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
            <View style={styles.actionsRow2}>
              <TouchableOpacity style={styles.actionBtn} onPress={imagesToPdf}>
                <Text style={styles.actionText}>🖼️ תמונות ל-PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => scan(true)}>
                <Text style={styles.actionText}>🪪 כרטיס (2 צדדים)</Text>
              </TouchableOpacity>
            </View>
            {scanBusy ? <Text style={styles.popupHint}>⏳ מעבד את הקובץ…</Text> : qualityLine}
            {entries.some((e) => !e.isDir) ? (
              <Text style={styles.popupHint}>טיפ: לחיצה ארוכה על קובץ וגרירה: אל תיקייה כדי להעביר, או על קובץ אחר כדי לשנות סדר. ⋮ לתפריט.</Text>
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="🔍 חיפוש בתיקייה"
              placeholderTextColor={c.muted}
              value={search}
              onChangeText={setSearch}
            />
            {filterBar}
            {dateBar}
            {lockedBar(entries.filter((e) => meta[e.uri]?.locked).length)}
            {archivedBar(entries.filter((e) => meta[e.uri]?.archived && (showLocked || !meta[e.uri]?.locked)).length)}
            <View style={styles.chipsWrap}>
              {(
                [
                  ['name', 'לפי שם'],
                  ['date', 'לפי תאריך'],
                  ['size', 'לפי גודל'],
                  ['manual', 'ידני'],
                ] as ['name' | 'date' | 'size' | 'manual', string][]
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
      {ghost}
      {menuPopup}
      {saver.element}
      {newFolderPopup}
      {moveToPopup}
      {qualityPopup}
      {trashPopup}
      {stageCPopups}
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
  galleryBtn: { flex: 0, marginBottom: 8 },
  actionsRow2: { flexDirection: 'row' as const, gap: 8, marginBottom: 8 },
  ocrText: { fontSize: 13, color: c.text2, lineHeight: 19, backgroundColor: c.subtle, borderRadius: 10, padding: 10 },
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
  dropHover: { backgroundColor: c.accentSoft, borderColor: c.accent, borderWidth: 2 },
  dragSource: { opacity: 0.35 },
  tileMore: { position: 'absolute' as const, top: 4, left: 4, padding: 4 },
  ghost: {
    position: 'absolute' as const,
    width: 220,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: c.card,
    borderWidth: 2,
    borderColor: c.accent,
    elevation: 8,
  },
  ghostText: { fontSize: 15, fontWeight: '700' as const, color: c.text },
  ghostSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  upBar: { position: 'absolute' as const, top: 8, left: 12, right: 12, zIndex: 10, elevation: 10, padding: 18, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed' as const, borderColor: c.accent, backgroundColor: c.subtle },
  upBarText: { color: c.text, fontWeight: '700' as const, textAlign: 'center' as const },
  helpHead: { fontSize: 16, fontWeight: '800' as const, color: c.text, marginTop: 14, marginBottom: 4 },
  helpText: { fontSize: 15, color: c.text, lineHeight: 23, marginBottom: 4 },
  helpLink: { fontSize: 15, color: c.accent, fontWeight: '700' as const, marginTop: 14, textAlign: 'center' as const },
  folderChoice: { padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, marginTop: 10 },
  folderChoiceTitle: { fontSize: 16, fontWeight: '800' as const, color: c.text, marginBottom: 2 },
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
  tagBadge: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: c.text2,
    backgroundColor: c.subtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden' as const,
  },
  noteLine: { fontSize: 12.5, color: c.text2, marginTop: 4 },
  noteInput: { minHeight: 110, textAlignVertical: 'top' as const },
  tagAddRow: { flexDirection: 'row' as const, gap: 8, marginTop: 12, alignItems: 'center' as const },
  tagAddBtn: { backgroundColor: c.accent, borderRadius: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' as const },
  slot: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, marginTop: 10 },
  slotMissing: { borderStyle: 'dashed' as const },
  slotBad: { borderColor: c.danger },
  slotHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  slotIcon: { fontSize: 28 },
  dupeItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.border },
  dupeName: { fontSize: 14, fontWeight: '700' as const, color: c.text },
  dupeBtn: { fontSize: 20 },
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
  dangerBtn: { backgroundColor: c.danger, marginTop: 0 },
  trashFull: { borderWidth: 1.5, borderColor: c.danger },
  trashItem: { paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.border },
  trashBtns: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  trashBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.subtle,
  },
});

export default React.memo(DocsTab);
