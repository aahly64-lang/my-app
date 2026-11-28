import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  PixelRatio,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { DocEntry, GeoAlarm, PreviewPic } from '../modules/geo-alarm';
import { Palette, useThemedStyles } from './theme';
import { DocMeta } from './storage';

/** In-app quick preview for PDFs and pictures (documents stage C). */
export default function DocPreview({
  entry,
  meta,
  onClose,
  onOpenExternal,
  onShare,
  onMenu,
}: {
  entry: DocEntry | null;
  meta?: DocMeta;
  onClose: () => void;
  onOpenExternal: (e: DocEntry) => void;
  onShare: (e: DocEntry) => void;
  onMenu: (e: DocEntry) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const isPdf = !!entry && entry.mime.includes('pdf');
  const [pages, setPages] = useState<number | null>(null); // null = loading, -1 = can't show
  const [image, setImage] = useState<PreviewPic | null | undefined>(undefined);
  const [zoomPage, setZoomPage] = useState<number | null>(null);
  const [zoomPic, setZoomPic] = useState<PreviewPic | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const stamp = entry?.modified || 0;

  useEffect(() => {
    setPages(null);
    setImage(undefined);
    setZoomPage(null);
    setZoomPic(null);
    if (!entry) return;
    let alive = true;
    if (entry.mime.includes('pdf')) GeoAlarm.pdfPageCount(entry.uri).then((n) => alive && setPages(n));
    else GeoAlarm.previewImage(entry.uri, 2400, stamp).then((p) => alive && setImage(p));
    return () => {
      alive = false;
    };
  }, [entry?.uri, stamp]);

  // a sharper picture of one page for zooming
  useEffect(() => {
    if (zoomPage === null || !entry) return;
    let alive = true;
    setZoomPic(null);
    GeoAlarm.renderPdfPage(entry.uri, zoomPage, Math.min(2600, width * PixelRatio.get() * 2), stamp).then(
      (p) => alive && setZoomPic(p)
    );
    return () => {
      alive = false;
    };
  }, [zoomPage]);

  if (!entry) return null;
  const pageW = width - 24;
  const pxW = Math.min(1600, pageW * PixelRatio.get());
  const bodyH = height - 120;

  const cantShow = (
    <View style={styles.center}>
      <Text style={styles.msg}>
        {isPdf ? 'לא ניתן להציג את הקובץ כאן (אולי הוא מוגן בסיסמה).' : 'לא ניתן להציג את התמונה.'}
      </Text>
      <TouchableOpacity style={styles.bigBtn} onPress={() => onOpenExternal(entry)}>
        <Text style={styles.bigBtnText}>↗️ פתח באפליקציה אחרת</Text>
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;
  if (isPdf) {
    if (pages === null) body = <ActivityIndicator size="large" style={styles.spinner} />;
    else if (pages <= 0) body = cantShow;
    else if (zoomPage !== null)
      body = zoomPic ? (
        <ZoomView pic={zoomPic} w={width} h={bodyH} />
      ) : (
        <ActivityIndicator size="large" style={styles.spinner} />
      );
    else
      body = (
        <FlatList
          data={Array.from({ length: pages }, (_, i) => i)}
          keyExtractor={(i) => String(i)}
          initialNumToRender={2}
          windowSize={5}
          contentContainerStyle={{ padding: 12, paddingBottom: 60 }}
          renderItem={({ item }) => (
            <PdfPage
              uri={entry.uri}
              page={item}
              pages={pages}
              w={pageW}
              pxW={pxW}
              stamp={stamp}
              ratio={ratio}
              onRatio={setRatio}
              onPress={() => setZoomPage(item)}
              styles={styles}
            />
          )}
        />
      );
  } else {
    if (image === undefined) body = <ActivityIndicator size="large" style={styles.spinner} />;
    else if (!image) body = cantShow;
    else body = <ZoomView pic={image} w={width} h={bodyH} />;
  }

  return (
    <Modal visible animationType="fade" onRequestClose={() => (zoomPage !== null ? setZoomPage(null) : onClose())}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (zoomPage !== null ? setZoomPage(null) : onClose())} hitSlop={12} style={styles.hBtn}>
            <Text style={styles.hBtnText}>{zoomPage !== null ? '›' : '✕'}</Text>
          </TouchableOpacity>
          <View style={styles.flex1}>
            <Text style={styles.title} numberOfLines={1}>
              {entry.name}
            </Text>
            {isPdf && pages && pages > 0 ? (
              <Text style={styles.sub}>
                {zoomPage !== null ? `עמוד ${zoomPage + 1} מתוך ${pages} · צביטה להגדלה` : `${pages} עמודים · לחיצה על עמוד להגדלה`}
              </Text>
            ) : !isPdf && image ? (
              <Text style={styles.sub}>צביטה או לחיצה כפולה להגדלה</Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => onShare(entry)} hitSlop={8} style={styles.hBtn}>
            <Text style={styles.hBtnText}>📤</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onOpenExternal(entry)} hitSlop={8} style={styles.hBtn}>
            <Text style={styles.hBtnText}>↗️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onMenu(entry)} hitSlop={8} style={styles.hBtn}>
            <Text style={styles.hBtnText}>⋮</Text>
          </TouchableOpacity>
        </View>
        {meta?.note || meta?.tags?.length ? (
          <View style={styles.noteBox}>
            {meta.tags?.length ? <Text style={styles.tags}>{meta.tags.map((t) => '🏷️ ' + t).join('   ')}</Text> : null}
            {meta.note ? (
              <Text style={styles.note} numberOfLines={4}>
                📝 {meta.note}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.flex1}>{body}</View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function PdfPage({
  uri,
  page,
  pages,
  w,
  pxW,
  stamp,
  ratio,
  onRatio,
  onPress,
  styles,
}: {
  uri: string;
  page: number;
  pages: number;
  w: number;
  pxW: number;
  stamp: number;
  ratio: number;
  onRatio: (r: number) => void;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [pic, setPic] = useState<PreviewPic | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    GeoAlarm.renderPdfPage(uri, page, pxW, stamp).then((p) => {
      if (!alive) return;
      setPic(p);
      if (p && page === 0) onRatio(p.height / p.width);
    });
    return () => {
      alive = false;
    };
  }, [uri, page, pxW, stamp]);
  const h = pic ? (w * pic.height) / pic.width : w * ratio;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.page, { width: w, height: h }]}>
      {pic ? (
        <Image source={{ uri: pic.uri }} style={{ width: w, height: h }} resizeMode="contain" />
      ) : pic === null ? (
        <Text style={styles.msg}>לא הצלחתי להציג את עמוד {page + 1}</Text>
      ) : (
        <ActivityIndicator />
      )}
      {pages > 1 ? <Text style={styles.pageNum}>{page + 1}</Text> : null}
    </TouchableOpacity>
  );
}

/** A picture that can be pinched, dragged and double-tapped. */
function ZoomView({ pic, w, h }: { pic: PreviewPic; w: number; h: number }) {
  const fit = Math.min(w / pic.width, h / pic.height);
  const fw = pic.width * fit;
  const fh = pic.height * fit;
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, x: 0, y: 0 });
  const start = useRef({ s: 1, x: 0, y: 0 });

  const clampV = (s: number, x: number, y: number) => {
    const mx = Math.max(0, (fw * s - w) / 2);
    const my = Math.max(0, (fh * s - h) / 2);
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  const apply = (v: { s: number; x: number; y: number }) => {
    cur.current = v;
    scale.setValue(v.s);
    tx.setValue(v.x);
    ty.setValue(v.y);
  };
  useEffect(() => apply({ s: 1, x: 0, y: 0 }), [pic.uri]);

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => (start.current = { ...cur.current }))
    .onUpdate((e) => {
      const s0 = start.current;
      const s = Math.min(6, Math.max(1, s0.s * e.scale));
      // keep the point between the fingers in place
      const fx = e.focalX - w / 2;
      const fy = e.focalY - h / 2;
      apply(clampV(s, fx - (fx - s0.x) * (s / s0.s), fy - (fy - s0.y) * (s / s0.s)));
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .onStart(() => (start.current = { ...cur.current }))
    .onUpdate((e) => apply(clampV(cur.current.s, start.current.x + e.translationX, start.current.y + e.translationY)));
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd((e) => {
      if (cur.current.s > 1.05) apply({ s: 1, x: 0, y: 0 });
      else {
        const s = 2.5;
        const fx = e.x - w / 2;
        const fy = e.y - h / 2;
        apply(clampV(s, -fx * (s - 1), -fy * (s - 1)));
      }
    });

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} collapsable={false}>
        <Animated.Image
          source={{ uri: pic.uri }}
          style={{ width: fw, height: fh, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}
          resizeMode="contain"
        />
      </View>
    </GestureDetector>
  );
}

const makeStyles = (c: Palette) => ({
  root: { flex: 1, backgroundColor: c.bg },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: c.border,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderColor: c.cardEdge,
  },
  hBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  hBtnText: { fontSize: 22, color: c.text, fontWeight: '800' as const },
  title: { fontSize: 16, fontWeight: '800' as const, color: c.text },
  sub: { fontSize: 12, color: c.muted, marginTop: 2 },
  noteBox: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.subtle },
  tags: { fontSize: 13, color: c.text2, fontWeight: '700' as const },
  note: { fontSize: 14, color: c.text, marginTop: 2, lineHeight: 20 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 24 },
  msg: { fontSize: 15, color: c.muted, textAlign: 'center' as const, lineHeight: 22 },
  spinner: { marginTop: 60 },
  page: {
    backgroundColor: '#fff',
    marginBottom: 12,
    borderRadius: 4,
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 0.5,
    borderColor: c.border,
  },
  pageNum: {
    position: 'absolute' as const,
    bottom: 6,
    start: 6,
    fontSize: 12,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden' as const,
  },
  bigBtn: {
    backgroundColor: c.accent,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  bigBtnText: { color: c.onAccent, fontWeight: '800' as const, fontSize: 16 },
});
