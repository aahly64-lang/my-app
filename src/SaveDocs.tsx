import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { GeoAlarm, PreviewPic } from '../modules/geo-alarm';
import { Palette, useTheme, useThemedStyles } from './theme';
import { PopupShell } from './ui';
import { docIcon } from './docLinks';
import { OcrSuggestion, suggestFromText } from './ocrSuggest';
import {
  DocFolder,
  DocLink,
  loadDocFolders,
  loadDocSaveFolder,
  loadScanQuality,
  isDriveUri,
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
  /** a fresh scan (one PDF): show its pages, a tap turns a page upside down. turned = pages already set right automatically */
  pagesFlip?: { turned: number; diag?: string };
}

/** Pages shown in the save window of a scan (tap to turn). */
const FLIP_PAGES = 12;

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
  const [thumbs, setThumbs] = useState<(PreviewPic | null)[]>([]);
  const [turns, setTurns] = useState<number[]>([]);
  const [thumbDiag, setThumbDiag] = useState('');
  // card scan: after the front side, offer (not force) the back side
  const [sideAsk, setSideAsk] = useState<((back: boolean) => void) | null>(null);
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
    // Drive-provider folders are read-only for apps: not offered as a place to save
    const list = (await loadDocFolders()).filter((f) => !isDriveUri(f.uri));
    setFolders(list);
    if (r.folder) setFolder(r.folder);
    else {
      const last = await loadDocSaveFolder();
      setFolder(list.find((f) => f.uri === last) ?? (list.length === 1 ? list[0] : null));
    }
    setName(r.files.length === 1 ? baseName(r.files[0].name) : baseName(r.files[0]?.name ?? '') + ' - מאוחד');
    setMerge(false);
    setSaving(false);
    setThumbs([]);
    setTurns([]);
    setThumbDiag('');
    setReq(r);
    const f0 = r.files[0];
    if (r.pagesFlip && r.files.length === 1 && f0.mime.includes('pdf')) {
      (async () => {
        const count = await GeoAlarm.pdfPageCount(f0.src);
        const n = Math.min(count, FLIP_PAGES);
        const pics: (PreviewPic | null)[] = [];
        for (let i = 0; i < n; i++) pics.push(await GeoAlarm.renderPdfPage(f0.src, i, 220, Date.now()));
        setThumbDiag(`עמודים: ${count}, תמונות: ${pics.filter(Boolean).length}`);
        setThumbs(pics);
        setTurns(pics.map(() => 0));
      })();
    }
    return new Promise((res) => (resolver.current = res));
  };

  const connect = async () => {
    try {
      const r = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
        'content://com.android.externalstorage.documents/tree/primary%3ADocuments'
      );
      if (!r.granted) return;
      if (isDriveUri(r.directoryUri)) {
        GeoAlarm.releaseFolder(r.directoryUri);
        Alert.alert('☁️ תיקייה בגוגל דרייב', 'בתיקייה בגוגל דרייב הטלפון לא מרשה לשמור. בחר תיקייה בטלפון.');
        return;
      }
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
    const single = req.files.length === 1 || merge;
    const typed = cleanName(name);
    if (single && !typed) {
      Alert.alert('שם הקובץ', 'כתוב שם לקובץ.');
      return;
    }
    setSaving(true);
    const out: DocLink[] = [];
    const failed: string[] = [];
    let files = req.files;
    if (turns.some((t) => t)) {
      const turned = await GeoAlarm.rotatePdfPages(files[0].src, turns);
      if (!turned) {
        setSaving(false);
        Alert.alert('הפיכת עמודים', 'לא הצלחתי להפוך את העמודים. אפשר לשמור בלי, ולהפוך אחר כך ב"🔄 סובב עמודים".');
        setTurns(turns.map(() => 0));
        return;
      }
      files = [{ ...files[0], src: turned }];
    }
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

  /** Card scan: the front side is in; asks whether to photograph the back side too. Closing = one side only. */
  const askSecondSide = () =>
    new Promise<boolean>((resolve) => setSideAsk(() => (back: boolean) => {
      setSideAsk(null);
      resolve(back);
    }));

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

        {req?.pagesFlip?.diag !== undefined ? (
          <Text style={styles.diag}>
            🧪 בדיקת היפוך – {req.pagesFlip.diag || 'אין תוצאה'}
            {thumbDiag ? ` · ${thumbDiag}` : ' · טוען תמונות…'}
          </Text>
        ) : null}

        {thumbs.length ? (
          <>
            <Text style={styles.label}>העמודים</Text>
            <Text style={styles.hint}>
              {req?.pagesFlip?.turned
                ? `🔄 ${req.pagesFlip.turned === 1 ? 'עמוד אחד היה הפוך ותוקן' : `${req.pagesFlip.turned} עמודים היו הפוכים ותוקנו`} לבד. `
                : ''}
              עמוד הפוך? הקש עליו כדי להפוך אותו.
            </Text>
            <View style={styles.chipsWrap}>
              {thumbs.map((t, i) =>
                t ? (
                  <TouchableOpacity
                    key={i}
                    style={styles.thumbBox}
                    onPress={() => setTurns((a) => a.map((v, j) => (j === i ? (v ? 0 : 180) : v)))}
                  >
                    <Image
                      source={{ uri: t.uri }}
                      style={{ width: 70, height: Math.round((70 * t.height) / t.width), transform: [{ rotate: turns[i] ? '180deg' : '0deg' }] }}
                    />
                    <Text style={styles.thumbText}>{turns[i] ? '🔄 יתהפך' : `${i + 1} · 🔄 הפוך`}</Text>
                  </TouchableOpacity>
                ) : null
              )}
            </View>
          </>
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

      <PopupShell
        visible={!!sideAsk}
        title="🪪 הצד הקדמי צולם ✓"
        onClose={() => sideAsk?.(false)}
        yellow={false}
        footer={
          <View style={styles.sideBtns}>
            <TouchableOpacity style={styles.saveBtn} onPress={() => sideAsk?.(true)}>
              <Text style={styles.saveText}>📷 צלם את הצד השני</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.oneSideBtn} onPress={() => sideAsk?.(false)}>
              <Text style={styles.chipText}>שמור צד אחד</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.sideText}>
          יש למסמך צד אחורי (למשל תעודת זהות)? הפוך את הכרטיס ולחץ "צלם את הצד השני". שני הצדדים יישמרו יחד בעמוד אחד.
        </Text>
        <Text style={styles.hint}>אין צד שני? לחץ "שמור צד אחד".</Text>
      </PopupShell>

      <PopupShell visible={!!busyText} title="רגע…" onClose={() => {}} yellow={false}>
        <View style={styles.busyRow}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.fileLine}>{busyText}</Text>
        </View>
      </PopupShell>
    </>
  );

  return { ask, busy, askSecondSide, element };
}

type SaveDocs = ReturnType<typeof useSaveDocs>;

/**
 * Scan with Google's scanner, then ask for a name and a folder.
 * Returns the saved document, or null (cancelled / no folder / scanner not available).
 */
export type ScannedDoc = DocLink & { suggest: OcrSuggestion };

/**
 * Scan with Google's scanner, read the text on the phone (to suggest a name and an expiry date),
 * then ask for a name and a folder. card = front and back of a card on one page.
 * Returns the saved document with the suggestions, or null (cancelled / no folder / scanner not available).
 */
export async function scanAndSave(
  s: SaveDocs,
  folder?: DocFolder,
  name?: string,
  opts?: { card?: boolean }
): Promise<ScannedDoc | null> {
  const quality = await loadScanQuality();
  const scanOnce = async (limit: number) => {
    try {
      return await s.busy('⏳ משפר את הדפים הסרוקים…', () => GeoAlarm.scanDocument(quality, limit));
    } catch (e: any) {
      Alert.alert('סריקת מסמך', 'הסורק לא זמין בטלפון: ' + (e?.message ?? ''));
      return undefined;
    }
  };
  // card: front side first, then the back side only if the user wants it
  let r = await scanOnce(opts?.card ? 1 : 30);
  if (!r) return null;
  if (opts?.card && (await s.askSecondSide())) {
    const back = await scanOnce(1);
    if (back) {
      const both = await s.busy('⏳ מחבר את שני הצדדים…', () =>
        GeoAlarm.combinePdf([r!.uri, back.uri], ['application/pdf', 'application/pdf'], quality === 'original' ? 'normal' : quality)
      );
      if (both) r = { uri: both, pages: 2 };
    }
  }
  // Google's scanner sometimes turns Hebrew pages upside down: set them right by reading them both ways.
  const up = await s.busy('⏳ בודק שאין עמודים הפוכים…', () => GeoAlarm.uprightScan(r!.uri));
  const base = up.uri ?? r.uri;
  let src = base;
  if (opts?.card && r.pages >= 2) {
    const one = await s.busy('⏳ מסדר את שני הצדדים בעמוד אחד…', () => GeoAlarm.cardOnePage(base));
    if (one) src = one;
    else Alert.alert('סריקת כרטיס', 'לא הצלחתי לסדר את הצדדים בעמוד אחד, נשמרה הסריקה הרגילה.');
  }
  const text = await s.busy('⏳ קורא את הטקסט שבסריקה…', () => GeoAlarm.readText(base, 'application/pdf', 2));
  const suggest = suggestFromText(text);
  const saved = await s.ask({
    title: opts?.card ? '🪪 שמירת הכרטיס' : '📷 שמירת הסריקה',
    files: [{ src, name: (name || suggest.name || (opts?.card ? 'כרטיס' : scanName())) + '.pdf', mime: 'application/pdf' }],
    folder,
    pagesFlip: { turned: up.turned, diag: up.diag },
  });
  const d = saved?.[0];
  return d ? { ...d, suggest } : null;
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
  thumbBox: {
    alignItems: 'center' as const,
    padding: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  diag: { fontSize: 12, color: c.text, backgroundColor: c.subtle, padding: 6, borderRadius: 8, marginTop: 6 },
  thumbText: { fontSize: 11.5, color: c.text, marginTop: 4 },
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
  sideBtns: { gap: 8 },
  sideText: { fontSize: 16, color: c.text, lineHeight: 24, marginBottom: 8 },
  oneSideBtn: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.subtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  busyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 10 },
});
