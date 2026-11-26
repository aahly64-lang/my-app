import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { GeoAlarm } from '../modules/geo-alarm';
import { Palette, useTheme, useThemedStyles } from './theme';
import { PopupShell } from './ui';
import { docIcon } from './docLinks';
import {
  DocFolder,
  DocLink,
  loadDocFolders,
  loadDocSaveFolder,
  loadScanQuality,
  saveDocFolders,
  saveDocSaveFolder,
} from './storage';

/** A file waiting to be saved into a connected folder (a scan, a merged PDF, a file shared into the app). */
export interface PendingFile {
  src: string;
  name: string; // with extension
  mime: string;
}

export interface SaveRequest {
  title: string;
  files: PendingFile[];
  /** fixed destination (browsing a folder); otherwise the user picks one of the connected folders */
  folder?: DocFolder;
  /** several PDFs / images: offer "one PDF" */
  mergeable?: boolean;
}

/** Quick names for a new document (tap one, then add to it if needed). */
const QUICK_NAMES = ['תעודת זהות', 'רישיון נהיגה', 'רישיון רכב', 'ביטוח', 'קבלה', 'חשבונית', 'חוזה', 'אחריות', 'מרשם', 'בדיקות'];

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const extOf = (n: string) => (/\.[^.]+$/.test(n) ? n.slice(n.lastIndexOf('.')) : '');
const cleanName = (n: string) => n.trim().replace(/[\\/:*?"<>|]/g, '').trim();
const isPdfOrImage = (mime: string) => mime.includes('pdf') || mime.startsWith('image/');

export function scanName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `סריקה ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

/**
 * The "where and under which name to save" dialog, shared by the documents tab, tasks and notes.
 * ask() resolves with the saved documents, or null if cancelled. busy() shows a small "working…" popup.
 */
export function useSaveDocs() {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [req, setReq] = useState<SaveRequest | null>(null);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [folder, setFolder] = useState<DocFolder | null>(null);
  const [name, setName] = useState('');
  const [merge, setMerge] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const resolver = useRef<((r: DocLink[] | null) => void) | null>(null);

  const finish = (r: DocLink[] | null) => {
    const res = resolver.current;
    resolver.current = null;
    setReq(null);
    setSaving(false);
    res?.(r);
  };

  const ask = async (r: SaveRequest): Promise<DocLink[] | null> => {
    resolver.current?.(null);
    const list = await loadDocFolders();
    setFolders(list);
    if (r.folder) setFolder(r.folder);
    else {
      const last = await loadDocSaveFolder();
      setFolder(list.find((f) => f.uri === last) ?? (list.length === 1 ? list[0] : null));
    }
    setName(r.files.length === 1 ? baseName(r.files[0].name) : baseName(r.files[0]?.name ?? '') + ' - מאוחד');
    setMerge(false);
    setSaving(false);
    setReq(r);
    return new Promise((res) => (resolver.current = res));
  };

  const connect = async () => {
    try {
      const r = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!r.granted) return;
      if (folders.some((f) => f.uri === r.directoryUri)) return;
      const f = { uri: r.directoryUri, name: GeoAlarm.documentFolderName(r.directoryUri) };
      const next = [...folders, f];
      await saveDocFolders(next);
      setFolders(next);
      setFolder(f);
    } catch {
      Alert.alert('שגיאה', 'לא הצלחתי לחבר את התיקייה.');
    }
  };

  const save = async () => {
    if (!req || !folder || saving) return;
    const files = req.files;
    const single = files.length === 1 || merge;
    const typed = cleanName(name);
    if (single && !typed) {
      Alert.alert('שם הקובץ', 'כתוב שם לקובץ.');
      return;
    }
    setSaving(true);
    const out: DocLink[] = [];
    const failed: string[] = [];
    if (merge && files.length > 1) {
      const quality = await loadScanQuality();
      const pdf = await GeoAlarm.combinePdf(files.map((f) => f.src), files.map((f) => f.mime), quality === 'original' ? 'normal' : quality);
      if (!pdf) failed.push('האיחוד ל-PDF');
      else {
        const n = typed + '.pdf';
        const uri = await GeoAlarm.copyIntoFolder(pdf, folder.uri, n, 'application/pdf');
        if (uri) out.push({ uri, name: n, mime: 'application/pdf' });
        else failed.push(n);
      }
    } else {
      for (const f of files) {
        const n = files.length === 1 ? typed + (extOf(typed) ? '' : extOf(f.name)) : f.name;
        const uri = await GeoAlarm.copyIntoFolder(f.src, folder.uri, n, f.mime || 'application/octet-stream');
        if (uri) out.push({ uri, name: n, mime: f.mime });
        else failed.push(n);
      }
    }
    if (!req.folder) saveDocSaveFolder(folder.uri);
    if (failed.length) {
      setSaving(false);
      Alert.alert(
        'שמירה',
        `לא הצלחתי לשמור בתיקייה "${folder.name}": ${failed.join(', ')}.\nייתכן שאין הרשאת כתיבה – נתק וחבר אותה שוב.`
      );
      if (!out.length) return;
    }
    finish(out);
  };

  const busy = async <T,>(text: string, fn: () => Promise<T>): Promise<T> => {
    setBusyText(text);
    try {
      return await fn();
    } finally {
      setBusyText(null);
    }
  };

  const files = req?.files ?? [];
  const canMerge = !!req?.mergeable && files.length > 1 && files.every((f) => isPdfOrImage(f.mime));
  const showName = files.length === 1 || merge;

  const element = (
    <>
      <PopupShell
        visible={!!req}
        title={req?.title ?? ''}
        onClose={() => !saving && finish(null)}
        yellow={false}
        footer={
          <TouchableOpacity
            style={[styles.saveBtn, (!folder || saving) && { opacity: 0.5 }]}
            disabled={!folder || saving}
            onPress={save}
          >
            {saving ? <ActivityIndicator color={c.onAccent} /> : <Text style={styles.saveText}>💾 שמור</Text>}
          </TouchableOpacity>
        }
      >
        {files.length > 1 ? (
          <View style={styles.fileList}>
            {files.slice(0, 8).map((f, i) => (
              <Text key={i} style={styles.fileLine} numberOfLines={1}>
                {docIcon(f.mime)} {f.name}
              </Text>
            ))}
            {files.length > 8 ? <Text style={styles.hint}>ועוד {files.length - 8}…</Text> : null}
          </View>
        ) : null}

        {canMerge ? (
          <View style={styles.chipsWrap}>
            {(
              [
                [false, `📎 ${files.length} קבצים נפרדים`],
                [true, '📕 קובץ PDF אחד'],
              ] as [boolean, string][]
            ).map(([k, label]) => (
              <TouchableOpacity key={String(k)} style={[styles.chip, merge === k && styles.chipOn]} onPress={() => setMerge(k)}>
                <Text style={[styles.chipText, merge === k && styles.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {showName ? (
          <>
            <Text style={styles.label}>שם הקובץ</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              selectTextOnFocus
              placeholder="שם הקובץ"
              placeholderTextColor={c.muted}
            />
            <View style={styles.chipsWrap}>
              {QUICK_NAMES.map((q) => (
                <TouchableOpacity key={q} style={styles.chip} onPress={() => setName(q)}>
                  <Text style={styles.chipText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>איפה לשמור</Text>
        {req?.folder ? (
          <Text style={styles.fileLine}>📂 {req.folder.name}</Text>
        ) : folders.length === 0 ? (
          <>
            <Text style={styles.hint}>עוד לא חוברה תיקייה. חבר תיקייה מהטלפון (למשל "מסמכים"), ואז אפשר לשמור.</Text>
            <TouchableOpacity style={styles.chip} onPress={connect}>
              <Text style={styles.chipText}>+ חבר תיקייה</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.chipsWrap}>
              {folders.map((f) => (
                <TouchableOpacity key={f.uri} style={[styles.chip, folder?.uri === f.uri && styles.chipOn]} onPress={() => setFolder(f)}>
                  <Text style={[styles.chipText, folder?.uri === f.uri && styles.chipTextOn]}>📂 {f.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!folder ? <Text style={styles.hint}>בחר תיקייה.</Text> : null}
          </>
        )}
      </PopupShell>

      <PopupShell visible={!!busyText} title="רגע…" onClose={() => {}} yellow={false}>
        <View style={styles.busyRow}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.fileLine}>{busyText}</Text>
        </View>
      </PopupShell>
    </>
  );

  return { ask, busy, element };
}

type SaveDocs = ReturnType<typeof useSaveDocs>;

/**
 * Scan with Google's scanner, then ask for a name and a folder.
 * Returns the saved document, or null (cancelled / no folder / scanner not available).
 */
export async function scanAndSave(s: SaveDocs, folder?: DocFolder): Promise<DocLink | null> {
  const quality = await loadScanQuality();
  let r: { uri: string; pages: number } | null = null;
  try {
    r = await s.busy('⏳ משפר את הדפים הסרוקים…', () => GeoAlarm.scanDocument(quality));
  } catch (e: any) {
    Alert.alert('סריקת מסמך', 'הסורק לא זמין בטלפון: ' + (e?.message ?? ''));
    return null;
  }
  if (!r) return null;
  const saved = await s.ask({
    title: '📷 שמירת הסריקה',
    files: [{ src: r.uri, name: scanName() + '.pdf', mime: 'application/pdf' }],
    folder,
  });
  return saved?.[0] ?? null;
}

const makeStyles = (c: Palette) => ({
  label: { fontSize: 14, fontWeight: '800' as const, color: c.text, marginTop: 12, marginBottom: 6 },
  hint: { fontSize: 13, color: c.muted, marginBottom: 8 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    paddingHorizontal: 12,
    fontSize: 16,
    color: c.text,
    textAlign: 'right' as const,
  },
  chipsWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: c.subtle,
    borderWidth: 1,
    borderColor: c.border,
    alignSelf: 'flex-start' as const,
  },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontSize: 13.5, color: c.text, fontWeight: '600' as const },
  chipTextOn: { color: c.onAccent },
  fileList: { gap: 4, marginBottom: 6 },
  fileLine: { fontSize: 14, color: c.text },
  saveBtn: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: c.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  saveText: { fontSize: 16, fontWeight: '800' as const, color: c.onAccent },
  busyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
});
