import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, PixelRatio, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { DocEntry, GeoAlarm, PreviewPic } from '../modules/geo-alarm';
import { Palette, useThemedStyles } from './theme';

const SAVED_SIG = (FileSystem.documentDirectory ?? '') + 'signature.png';
const TEMP_SIG = (FileSystem.cacheDirectory ?? '') + 'signature-temp.png';

/** A drawing pad in a WebView; sends back a cropped, transparent PNG (data URL). */
const PAD_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%}
.line{position:absolute;left:8%;right:8%;bottom:28%;border-bottom:2px dashed #bbb;pointer-events:none}</style></head>
<body><div class="line"></div><canvas id="c"></canvas><script>
var c=document.getElementById('c'),x=c.getContext('2d'),r=window.devicePixelRatio||1,drawn=false,last=null,box=null;
function size(){c.width=c.clientWidth*r;c.height=c.clientHeight*r;x.scale(r,r);x.lineCap='round';x.lineJoin='round';x.strokeStyle='#0b2a7a';x.lineWidth=3;}
size();
function pt(e){var b=c.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top};}
function grow(p){if(!box)box={a:p.x,b:p.y,c:p.x,d:p.y};box.a=Math.min(box.a,p.x);box.b=Math.min(box.b,p.y);box.c=Math.max(box.c,p.x);box.d=Math.max(box.d,p.y);}
c.addEventListener('pointerdown',function(e){last=pt(e);grow(last);x.beginPath();x.arc(last.x,last.y,1.4,0,6.3);x.fillStyle='#0b2a7a';x.fill();drawn=true;});
c.addEventListener('pointermove',function(e){if(!last)return;var p=pt(e);x.beginPath();x.moveTo(last.x,last.y);x.lineTo(p.x,p.y);x.stroke();last=p;grow(p);});
['pointerup','pointercancel','pointerleave'].forEach(function(n){c.addEventListener(n,function(){last=null;});});
window.clearPad=function(){x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,c.width,c.height);x.scale(r,r);drawn=false;box=null;};
window.savePad=function(){if(!drawn||!box){window.ReactNativeWebView.postMessage('empty');return;}
var p=8,sx=Math.max(0,(box.a-p)*r),sy=Math.max(0,(box.b-p)*r),sw=Math.min(c.width-sx,(box.c-box.a+2*p)*r),sh=Math.min(c.height-sy,(box.d-box.b+2*p)*r);
var o=document.createElement('canvas');o.width=sw;o.height=sh;o.getContext('2d').drawImage(c,sx,sy,sw,sh,0,0,sw,sh);
window.ReactNativeWebView.postMessage(o.toDataURL('image/png'));};
</script></body></html>`;

/**
 * Signing a document: draw (or reuse a saved) signature, place it on a page, and get a new signed PDF.
 * onSigned gets the signed file (in the cache); the caller saves it where the user wants.
 */
export default function DocSign({
  entry,
  onClose,
  onSigned,
}: {
  entry: DocEntry | null;
  onClose: () => void;
  onSigned: (file: string, e: DocEntry) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const web = useRef<WebView>(null);
  const [step, setStep] = useState<'pad' | 'place'>('pad');
  const [hasSaved, setHasSaved] = useState(false);
  const [keep, setKeep] = useState(false);
  const [sig, setSig] = useState<{ uri: string; ratio: number } | null>(null);
  // placing
  const [pdf, setPdf] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [pic, setPic] = useState<PreviewPic | null>(null);
  const [pos, setPos] = useState({ x: 0.55, y: 0.8, w: 0.3 }); // fractions of the page, from top-left
  const [busy, setBusy] = useState(false);
  const start = useRef(pos);

  useEffect(() => {
    if (!entry) return;
    setStep('pad');
    setSig(null);
    setPdf(null);
    setPic(null);
    setPage(0);
    setKeep(false);
    setPos({ x: 0.55, y: 0.8, w: 0.3 });
    FileSystem.getInfoAsync(SAVED_SIG).then((i) => setHasSaved(i.exists));
  }, [entry?.uri]);

  // the page to sign (pictures become a PDF first)
  useEffect(() => {
    if (step !== 'place' || !entry || pdf) return;
    (async () => {
      const src = entry.mime.includes('pdf') ? entry.uri : await GeoAlarm.combinePdf([entry.uri], [entry.mime], 'high');
      if (!src) {
        Alert.alert('חתימה', 'לא הצלחתי לפתוח את הקובץ.');
        onClose();
        return;
      }
      const n = await GeoAlarm.pdfPageCount(src);
      if (n <= 0) {
        Alert.alert('חתימה', 'לא ניתן לחתום על הקובץ הזה (אולי הוא מוגן בסיסמה).');
        onClose();
        return;
      }
      setPdf(src);
      setPages(n);
      setPage(n - 1); // signatures usually go on the last page
    })();
  }, [step, pdf]);

  useEffect(() => {
    if (!pdf) return;
    setPic(null);
    GeoAlarm.renderPdfPage(pdf, page, Math.min(1600, width * PixelRatio.get()), Date.now()).then(setPic);
  }, [pdf, page]);

  if (!entry) return null;

  const useSig = (uri: string) =>
    Image.getSize(
      uri,
      (w, h) => {
        setSig({ uri, ratio: h / w });
        setStep('place');
      },
      () => Alert.alert('חתימה', 'לא הצלחתי לקרוא את החתימה.')
    );

  const onPad = async (data: string) => {
    if (data === 'empty') {
      Alert.alert('חתימה', 'קודם חתום באצבע במסגרת הלבנה.');
      return;
    }
    const b64 = data.split('base64,')[1] ?? '';
    const path = keep ? SAVED_SIG : TEMP_SIG;
    try {
      await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
    } catch {
      Alert.alert('חתימה', 'לא הצלחתי לשמור את החתימה.');
      return;
    }
    useSig(path + '?t=' + Date.now());
  };

  const deleteSaved = async () => {
    await FileSystem.deleteAsync(SAVED_SIG, { idempotent: true });
    setHasSaved(false);
  };

  // page box on screen
  const boxW = width - 32;
  const boxH = pic ? (boxW * pic.height) / pic.width : boxW * 1.414;
  const maxH = height - 260;
  const scale = boxH > maxH ? maxH / boxH : 1;
  const pw = boxW * scale;
  const ph = boxH * scale;
  const sw = pos.w * pw;
  const sh = sig ? sw * sig.ratio : 0;

  const drag = Gesture.Pan()
    .runOnJS(true)
    .onStart(() => (start.current = pos))
    .onUpdate((e) => {
      const s = start.current;
      setPos({
        w: s.w,
        x: Math.max(0, Math.min(1 - s.w, s.x + e.translationX / pw)),
        y: Math.max(0, Math.min(1 - (sh / ph || 0), s.y + e.translationY / ph)),
      });
    });

  const resize = (f: number) =>
    setPos((p) => {
      const w = Math.max(0.08, Math.min(0.9, p.w * f));
      return { w, x: Math.min(p.x, 1 - w), y: p.y };
    });

  const finish = async () => {
    if (!pdf || !sig) return;
    setBusy(true);
    const out = await GeoAlarm.signPdf(pdf, page, sig.uri.split('?')[0], pos.x, pos.y, pos.w);
    setBusy(false);
    if (!out) {
      Alert.alert('חתימה', 'לא הצלחתי לחתום על הקובץ.');
      return;
    }
    onSigned(out, entry);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.hBtn}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            ✍️ חתימה · {entry.name}
          </Text>
        </View>

        {step === 'pad' ? (
          <View style={styles.body}>
            {hasSaved ? (
              <View style={styles.savedBox}>
                <Image source={{ uri: SAVED_SIG + '?t=' + Date.now() }} style={styles.savedImg} resizeMode="contain" />
                <TouchableOpacity style={styles.bigBtn} onPress={() => useSig(SAVED_SIG + '?t=' + Date.now())}>
                  <Text style={styles.bigBtnText}>השתמש בחתימה השמורה</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={deleteSaved} hitSlop={6}>
                  <Text style={styles.link}>🗑️ מחק את החתימה השמורה</Text>
                </TouchableOpacity>
                <Text style={styles.label}>או חתום מחדש:</Text>
              </View>
            ) : (
              <Text style={styles.hint}>חתום באצבע בתוך המסגרת.</Text>
            )}
            <View style={styles.pad}>
              <WebView
                ref={web}
                source={{ html: PAD_HTML }}
                originWhitelist={['*']}
                onMessage={(e) => onPad(e.nativeEvent.data)}
                scrollEnabled={false}
                overScrollMode="never"
                style={{ backgroundColor: '#fff' }}
              />
            </View>
            <TouchableOpacity style={styles.checkRow} onPress={() => setKeep(!keep)}>
              <Text style={styles.checkText}>{keep ? '☑' : '☐'}  לשמור את החתימה לפעם הבאה (רק בטלפון)</Text>
            </TouchableOpacity>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.flex1]} onPress={() => web.current?.injectJavaScript('clearPad();true;')}>
                <Text style={styles.btnText}>נקה</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bigBtn, styles.flex1, { marginTop: 0 }]} onPress={() => web.current?.injectJavaScript('savePad();true;')}>
                <Text style={styles.bigBtnText}>המשך ‹</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.hint}>גרור את החתימה למקום הנכון. ➖ ➕ לגודל.</Text>
            <View style={[styles.row, { justifyContent: 'center' }]}>
              {pages > 1 ? (
                <>
                  <TouchableOpacity style={styles.btn} disabled={page >= pages - 1} onPress={() => setPage(page + 1)}>
                    <Text style={styles.btnText}>עמוד הבא ›</Text>
                  </TouchableOpacity>
                  <Text style={styles.pageText}>
                    עמוד {page + 1}/{pages}
                  </Text>
                  <TouchableOpacity style={styles.btn} disabled={page <= 0} onPress={() => setPage(page - 1)}>
                    <Text style={styles.btnText}>‹ הקודם</Text>
                  </TouchableOpacity>
                </>
              ) : null}
              <TouchableOpacity style={styles.btn} onPress={() => resize(1 / 1.15)}>
                <Text style={styles.btnText}>➖</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => resize(1.15)}>
                <Text style={styles.btnText}>➕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ alignItems: 'center', marginTop: 10 }}>
              <View style={[styles.page, { width: pw, height: ph }]}>
                {pic ? (
                  <Image source={{ uri: pic.uri }} style={{ width: pw, height: ph }} resizeMode="contain" />
                ) : (
                  <ActivityIndicator style={{ marginTop: 40 }} />
                )}
                {sig && pic ? (
                  <GestureDetector gesture={drag}>
                    <View
                      collapsable={false}
                      style={[styles.sig, { left: pos.x * pw, top: pos.y * ph, width: sw, height: sh }]}
                    >
                      <Image source={{ uri: sig.uri }} style={{ width: sw, height: sh }} resizeMode="contain" />
                    </View>
                  </GestureDetector>
                ) : null}
              </View>
            </View>
            <TouchableOpacity style={[styles.bigBtn, busy && { opacity: 0.6 }]} disabled={busy || !pic} onPress={finish}>
              <Text style={styles.bigBtnText}>{busy ? '⏳ חותם…' : '✍️ חתום ושמור כקובץ חדש'}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>הקובץ המקורי לא משתנה. נשמר עותק חתום.</Text>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const makeStyles = (c: Palette) => ({
  root: { flex: 1, backgroundColor: c.bg },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 12,
    backgroundColor: c.card,
    borderBottomWidth: 0.5,
    borderBottomColor: c.border,
  },
  hBtn: { fontSize: 22, color: c.text, fontWeight: '800' as const },
  title: { flex: 1, fontSize: 16, fontWeight: '800' as const, color: c.text },
  body: { padding: 16 },
  hint: { fontSize: 13, color: c.muted, marginVertical: 8, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '800' as const, color: c.text, marginTop: 14 },
  link: { fontSize: 13.5, color: c.danger, marginTop: 10, textAlign: 'center' as const },
  savedBox: { alignItems: 'stretch' as const },
  savedImg: { height: 90, backgroundColor: '#fff', borderRadius: 12 },
  pad: { height: 230, borderRadius: 14, overflow: 'hidden' as const, borderWidth: 1.5, borderColor: c.border, backgroundColor: '#fff', marginTop: 8 },
  checkRow: { paddingVertical: 12 },
  checkText: { fontSize: 14.5, color: c.text },
  row: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const, flexWrap: 'wrap' as const },
  btn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
  },
  btnText: { fontSize: 14.5, fontWeight: '700' as const, color: c.text },
  pageText: { fontSize: 14, color: c.text, fontWeight: '700' as const },
  page: { backgroundColor: '#fff', borderWidth: 0.5, borderColor: c.border, overflow: 'hidden' as const },
  sig: { position: 'absolute' as const, borderWidth: 1.5, borderColor: c.accent, borderStyle: 'dashed' as const },
  bigBtn: {
    backgroundColor: c.accent,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  bigBtnText: { color: c.onAccent, fontWeight: '800' as const, fontSize: 16 },
});
