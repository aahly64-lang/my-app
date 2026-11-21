import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { GeoAlarm } from '../modules/geo-alarm';
import { Palette, cardShadow, useTheme, useThemedStyles } from './theme';
import { PopupShell, confirm } from './ui';
import {
  MyRingtone,
  SoundKind,
  loadRingtones,
  loadSounds,
  newId,
  saveRingtones,
  saveSounds,
} from './storage';

const MAX_MS = 40_000;
const MIN_MS = 1_000;
const FADE_MS = 2_000;

const KINDS: [SoundKind, string][] = [
  ['alarm', '⏰ שעון מעורר'],
  ['geo', '📍 שעון לפי מיקום'],
  ['timer', '⏱️ טיימר'],
  ['reminder', '📝 תזכורות'],
];

function fmt(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

interface Draft {
  src: string;
  name: string;
  duration: number;
  start: number;
  end: number;
  fade: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function RingtonesScreen({ visible, onClose }: Props) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [list, setList] = useState<MyRingtone[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [playPos, setPlayPos] = useState(-1);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<MyRingtone | null>(null);
  const [panel, setPanel] = useState<'menu' | 'app' | 'phone' | 'rename'>('menu');
  const [renameText, setRenameText] = useState('');
  const [usedFor, setUsedFor] = useState<Partial<Record<SoundKind, string>>>({});
  const [canWrite, setCanWrite] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setList(await loadRingtones());
    setUsedFor(await loadSounds());
    setCanWrite(GeoAlarm.canWriteSettings());
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setCanWrite(GeoAlarm.canWriteSettings());
    });
    return () => sub.remove();
  }, [visible, refresh]);

  const stopPlay = useCallback(() => {
    GeoAlarm.stopPreview();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPlayPos(-1);
    setPlayingId(null);
  }, []);

  useEffect(() => () => stopPlay(), [stopPlay]);

  const play = (src: string, start: number, end: number, fadeMs: number, id: string) => {
    stopPlay();
    if (!GeoAlarm.previewAudio(src, start, end, fadeMs)) {
      Alert.alert('השמעה', 'לא הצלחתי להשמיע את הקובץ.');
      return;
    }
    setPlayingId(id);
    pollRef.current = setInterval(() => {
      const p = GeoAlarm.previewPosition();
      if (p < 0) stopPlay();
      else setPlayPos(p);
    }, 100);
  };

  // ---------- new ringtone ----------
  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    const duration = GeoAlarm.audioDuration(a.uri);
    if (!duration) {
      Alert.alert('קובץ שמע', 'לא הצלחתי לקרוא את הקובץ. נסה קובץ אחר (mp3, m4a, wav, ogg).');
      return;
    }
    const base = (a.name || 'צלצול').replace(/\.[^.]+$/, '').slice(0, 30);
    setDraft({ src: a.uri, name: base, duration, start: 0, end: Math.min(30_000, duration), fade: true });
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim() || 'צלצול';
    stopPlay();
    setBusy(true);
    try {
      const id = newId();
      const r = await GeoAlarm.makeRingtone(
        draft.src,
        Math.round(draft.start),
        Math.round(draft.end),
        draft.fade ? FADE_MS : 0,
        id,
        name
      );
      const item: MyRingtone = {
        id,
        name,
        path: r.path,
        mediaUri: r.mediaUri,
        durationMs: Math.round(draft.end - draft.start),
        createdAt: Date.now(),
      };
      const next = [item, ...list];
      setList(next);
      await saveRingtones(next);
      setDraft(null);
      setSelected(item);
      setPanel('menu');
    } catch (e: any) {
      Alert.alert('יצירת צלצול', 'היצירה נכשלה: ' + (e?.message ?? ''));
    } finally {
      setBusy(false);
    }
  };

  // ---------- actions on a saved ringtone ----------
  const soundUriOf = (r: MyRingtone) => r.mediaUri;

  const toggleUse = async (kind: SoundKind) => {
    if (!selected) return;
    const uri = soundUriOf(selected);
    if (!uri) {
      Alert.alert('צלצול', 'בגרסת האנדרואיד הזו אי אפשר להשתמש בצלצול לשעונים.');
      return;
    }
    const next = { ...usedFor };
    if (next[kind] === uri) delete next[kind];
    else next[kind] = uri;
    setUsedFor(next);
    await saveSounds(next);
  };

  const setOnPhone = (type: 'call' | 'notification' | 'alarm', label: string) => {
    if (!selected?.mediaUri) return;
    const ok = GeoAlarm.setPhoneRingtone(selected.mediaUri, type);
    Alert.alert(label, ok ? `"${selected.name}" הוגדר בטלפון ✓` : 'לא הצלחתי להגדיר. בדוק שההרשאה מופעלת.');
  };

  const doRename = async () => {
    if (!selected) return;
    const name = renameText.trim();
    if (!name) return;
    GeoAlarm.renameRingtone(selected.mediaUri, name);
    const next = list.map((r) => (r.id === selected.id ? { ...r, name } : r));
    setList(next);
    await saveRingtones(next);
    setSelected({ ...selected, name });
    setPanel('menu');
  };

  const doDelete = () => {
    if (!selected) return;
    const r = selected;
    confirm('מחיקת צלצול', `למחוק את "${r.name}"? הוא יימחק גם מרשימת הצלצולים של הטלפון.`, 'מחק', async () => {
      stopPlay();
      GeoAlarm.deleteRingtone(r.path, r.mediaUri);
      const next = list.filter((x) => x.id !== r.id);
      setList(next);
      await saveRingtones(next);
      const sounds = { ...usedFor };
      let changed = false;
      for (const k of Object.keys(sounds) as SoundKind[])
        if (sounds[k] === r.mediaUri) {
          delete sounds[k];
          changed = true;
        }
      if (changed) {
        setUsedFor(sounds);
        await saveSounds(sounds);
      }
      setSelected(null);
    });
  };

  const close = () => {
    stopPlay();
    setDraft(null);
    setSelected(null);
    onClose();
  };

  const usedLabels = (r: MyRingtone) =>
    KINDS.filter(([k]) => r.mediaUri && usedFor[k] === r.mediaUri).map(([, l]) => l.split(' ').slice(1).join(' '));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={draft ? () => setDraft(null) : close}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>🎵 הצלצולים שלי</Text>
          <TouchableOpacity onPress={draft ? () => setDraft(null) : close} style={styles.closeBtn} hitSlop={10}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {draft ? (
          <Editor
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            playing={playingId === 'draft'}
            playPos={playingId === 'draft' ? playPos : -1}
            onPlay={() =>
              playingId === 'draft'
                ? stopPlay()
                : play(draft.src, draft.start, draft.end, draft.fade ? FADE_MS : 0, 'draft')
            }
            onSave={save}
            styles={styles}
            c={c}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <TouchableOpacity style={styles.bigBtn} onPress={pickFile}>
              <Text style={styles.bigBtnText}>➕ צלצול חדש מקובץ שמע</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              בחר שיר, הקלטה או הודעה קולית מהטלפון, סמן קטע של עד 40 שניות ושמור. הצלצול יישמר גם ברשימת
              הרינגטונים של הטלפון.
            </Text>

            {list.length === 0 ? <Text style={styles.empty}>עדיין לא יצרת צלצולים.</Text> : null}
            {list.map((r) => {
              const used = usedLabels(r);
              const isPlaying = playingId === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={styles.item}
                  onPress={() => {
                    setSelected(r);
                    setPanel('menu');
                  }}
                >
                  <TouchableOpacity
                    style={styles.playBtn}
                    onPress={() => (isPlaying ? stopPlay() : play(r.path, 0, r.durationMs + 500, 0, r.id))}
                    hitSlop={8}
                  >
                    <Text style={styles.playText}>{isPlaying ? '⏹' : '▶️'}</Text>
                  </TouchableOpacity>
                  <View style={styles.flex1}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={styles.itemSub} numberOfLines={1}>
                      {fmt(r.durationMs)}
                      {used.length ? ` · 🔔 ${used.join(', ')}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.chev}>‹</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <PopupShell visible={!!selected} title={selected?.name ?? ''} onClose={() => setSelected(null)} yellow={false}>
          {selected && panel === 'menu' ? (
            <>
              <MenuItem styles={styles} label="🔔  השתמש באפליקציה (שעונים, טיימר, תזכורות)" onPress={() => setPanel('app')} />
              <MenuItem styles={styles} label="📱  הגדר בטלפון (שיחות, התראות)" onPress={() => setPanel('phone')} />
              <MenuItem
                styles={styles}
                label="✏️  שינוי שם"
                onPress={() => {
                  setRenameText(selected.name);
                  setPanel('rename');
                }}
              />
              <MenuItem styles={styles} label="🗑️  מחיקה" danger onPress={doDelete} />
            </>
          ) : null}

          {selected && panel === 'app' ? (
            <>
              <Text style={styles.hint}>סמן לאילו צלצולים באפליקציה להשתמש בו:</Text>
              {KINDS.map(([k, label]) => {
                const on = !!selected.mediaUri && usedFor[k] === selected.mediaUri;
                return (
                  <TouchableOpacity key={k} style={styles.checkRow} onPress={() => toggleUse(k)}>
                    <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.boxMark}>✓</Text> : null}</View>
                    <Text style={styles.checkLabel}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={styles.bigBtn} onPress={() => setPanel('menu')}>
                <Text style={styles.bigBtnText}>סיום</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {selected && panel === 'phone' ? (
            <>
              {!selected.mediaUri ? (
                <Text style={styles.hint}>בגרסת האנדרואיד הזו אי אפשר לשמור צלצולים בטלפון.</Text>
              ) : !canWrite ? (
                <>
                  <Text style={styles.hint}>
                    כדי שהאפליקציה תוכל להחליף את צלצול השיחות, צריך לאשר פעם אחת את ההרשאה "שינוי הגדרות מערכת".
                    לחץ למטה, הדלק את המתג וחזור לכאן.
                  </Text>
                  <TouchableOpacity style={styles.bigBtn} onPress={() => GeoAlarm.openWriteSettings()}>
                    <Text style={styles.bigBtnText}>🔓 פתח את ההרשאה</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <MenuItem styles={styles} label="📞  צלצול לשיחות נכנסות" onPress={() => setOnPhone('call', 'צלצול שיחות')} />
                  <MenuItem styles={styles} label="💬  צלצול להתראות והודעות" onPress={() => setOnPhone('notification', 'צלצול התראות')} />
                  <MenuItem styles={styles} label="⏰  צלצול לשעון המעורר של הטלפון" onPress={() => setOnPhone('alarm', 'שעון הטלפון')} />
                </>
              )}
              {selected.mediaUri ? (
                <>
                  <Text style={styles.hint}>לאיש קשר מסוים: באנשי הקשר פתח את איש הקשר ← עריכה ← רינגטון, ובחר "{selected.name}".</Text>
                  <MenuItem styles={styles} label="⚙️  פתח את הגדרות הצלילים של הטלפון" onPress={() => GeoAlarm.openSoundSettings()} />
                </>
              ) : null}
            </>
          ) : null}

          {selected && panel === 'rename' ? (
            <>
              <TextInput
                style={styles.input}
                value={renameText}
                onChangeText={setRenameText}
                autoFocus
                placeholderTextColor={c.muted}
              />
              <TouchableOpacity style={styles.bigBtn} onPress={doRename}>
                <Text style={styles.bigBtnText}>שמור</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </PopupShell>
      </View>
    </Modal>
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
      <Text style={[styles.menuText, danger && styles.menuDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------- editor

function Editor({
  draft,
  setDraft,
  busy,
  playing,
  playPos,
  onPlay,
  onSave,
  styles,
  c,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  playing: boolean;
  playPos: number;
  onPlay: () => void;
  onSave: () => void;
  styles: ReturnType<typeof makeStyles>;
  c: Palette;
}) {
  const len = draft.end - draft.start;

  const setStart = (v: number) => {
    let start = Math.max(0, Math.min(v, draft.duration - MIN_MS));
    let end = draft.end;
    if (end - start < MIN_MS) end = Math.min(draft.duration, start + MIN_MS);
    if (end - start > MAX_MS) end = start + MAX_MS;
    setDraft({ ...draft, start, end });
  };
  const setEnd = (v: number) => {
    let end = Math.min(draft.duration, Math.max(v, MIN_MS));
    let start = draft.start;
    if (end - start < MIN_MS) start = Math.max(0, end - MIN_MS);
    if (end - start > MAX_MS) start = end - MAX_MS;
    setDraft({ ...draft, start, end });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>שם הצלצול</Text>
      <TextInput
        style={styles.input}
        value={draft.name}
        onChangeText={(t) => setDraft({ ...draft, name: t })}
        placeholderTextColor={c.muted}
      />

      <Text style={styles.label}>בחר קטע (עד 40 שניות)</Text>
      <RangeBar
        duration={draft.duration}
        start={draft.start}
        end={draft.end}
        playPos={playPos}
        onStart={setStart}
        onEnd={setEnd}
        styles={styles}
      />
      <View style={styles.timesRow}>
        <Text style={styles.timeSmall}>0:00</Text>
        <Text style={styles.timeSmall}>{fmt(draft.duration)}</Text>
      </View>

      <View style={styles.fineRow}>
        <Text style={styles.fineLabel}>🟢 התחלה</Text>
        <TouchableOpacity style={styles.fineBtn} onPress={() => setStart(draft.start - 1000)}>
          <Text style={styles.fineBtnText}>-1</Text>
        </TouchableOpacity>
        <Text style={styles.fineTime}>{fmt(draft.start)}</Text>
        <TouchableOpacity style={styles.fineBtn} onPress={() => setStart(draft.start + 1000)}>
          <Text style={styles.fineBtnText}>+1</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.fineRow}>
        <Text style={styles.fineLabel}>🔴 סוף</Text>
        <TouchableOpacity style={styles.fineBtn} onPress={() => setEnd(draft.end - 1000)}>
          <Text style={styles.fineBtnText}>-1</Text>
        </TouchableOpacity>
        <Text style={styles.fineTime}>{fmt(draft.end)}</Text>
        <TouchableOpacity style={styles.fineBtn} onPress={() => setEnd(draft.end + 1000)}>
          <Text style={styles.fineBtnText}>+1</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.lenText, len >= MAX_MS - 50 && styles.lenMax]}>אורך הקטע: {fmt(len)} (מקסימום 0:40)</Text>

      <View style={styles.switchRow}>
        <View style={styles.flex1}>
          <Text style={styles.switchTitle}>כניסה הדרגתית</Text>
          <Text style={styles.hintTight}>הצלצול מתחיל בשקט ומתגבר בשתי השניות הראשונות.</Text>
        </View>
        <Switch value={draft.fade} onValueChange={(v) => setDraft({ ...draft, fade: v })} />
      </View>

      <TouchableOpacity style={styles.outlineBtn} onPress={onPlay}>
        <Text style={styles.outlineBtnText}>{playing ? '⏹ עצור' : '▶️ השמע את הקטע'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.bigBtn, busy && styles.dim]} onPress={onSave} disabled={busy}>
        {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={styles.bigBtnText}>💾 שמור צלצול</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function RangeBar({
  duration,
  start,
  end,
  playPos,
  onStart,
  onEnd,
  styles,
}: {
  duration: number;
  start: number;
  end: number;
  playPos: number;
  onStart: (v: number) => void;
  onEnd: (v: number) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [width, setWidth] = useState(1);
  const latest = useRef({ start, end, width, duration, onStart, onEnd });
  latest.current = { start, end, width, duration, onStart, onEnd };
  const drag = useRef<{ which: 'start' | 'end'; baseMs: number } | null>(null);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const L = latest.current;
        const x = e.nativeEvent.locationX;
        const sx = (L.start / L.duration) * L.width;
        const ex = (L.end / L.duration) * L.width;
        const which = Math.abs(x - sx) <= Math.abs(x - ex) ? 'start' : 'end';
        const ms = (x / L.width) * L.duration;
        drag.current = { which, baseMs: ms };
        if (which === 'start') L.onStart(ms);
        else L.onEnd(ms);
      },
      onPanResponderMove: (_e, g) => {
        const L = latest.current;
        const d = drag.current;
        if (!d) return;
        const ms = d.baseMs + (g.dx / L.width) * L.duration;
        if (d.which === 'start') L.onStart(ms);
        else L.onEnd(ms);
      },
      onPanResponderRelease: () => {
        drag.current = null;
      },
    })
  ).current;

  const sx = (start / duration) * width;
  const ex = (end / duration) * width;
  const px = playPos >= 0 ? (playPos / duration) * width : -1;

  return (
    <View
      style={styles.rangeWrap}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.rangeTrack} />
      <View pointerEvents="none" style={[styles.rangeSel, { left: sx, width: Math.max(2, ex - sx) }]} />
      {px >= 0 ? <View pointerEvents="none" style={[styles.playhead, { left: px - 1 }]} /> : null}
      <View pointerEvents="none" style={[styles.thumb, styles.thumbStart, { left: sx - 14 }]} />
      <View pointerEvents="none" style={[styles.thumb, styles.thumbEnd, { left: ex - 14 }]} />
    </View>
  );
}

// ---------------------------------------------------------------- styles

const makeStyles = (c: Palette) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '800' as const, color: c.text },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.subtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  closeText: { fontSize: 18, color: c.text, fontWeight: '700' as const },
  content: { padding: 18, paddingBottom: 60 },
  flex1: { flex: 1 },
  hint: { fontSize: 13, color: c.muted, lineHeight: 19, marginVertical: 8 },
  hintTight: { fontSize: 12.5, color: c.muted, lineHeight: 17 },
  empty: { fontSize: 14, color: c.muted, textAlign: 'center' as const, marginTop: 24 },
  bigBtn: {
    backgroundColor: c.accent,
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 12,
  },
  bigBtnText: { color: c.onAccent, fontWeight: '800' as const, fontSize: 16 },
  dim: { opacity: 0.6 },
  outlineBtn: {
    borderWidth: 1.5,
    borderColor: c.border,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 16,
    backgroundColor: c.card,
  },
  outlineBtnText: { color: c.text, fontWeight: '700' as const, fontSize: 15.5 },
  item: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    ...cardShadow(c),
  },
  playBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.subtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  playText: { fontSize: 18 },
  itemName: { fontSize: 16, fontWeight: '700' as const, color: c.text },
  itemSub: { fontSize: 12.5, color: c.muted, marginTop: 2 },
  chev: { fontSize: 22, color: c.muted },
  label: { fontSize: 14, fontWeight: '700' as const, color: c.text, marginTop: 14, marginBottom: 6 },
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
  rangeWrap: { height: 56, justifyContent: 'center' as const, direction: 'ltr' as const, marginHorizontal: 14 },
  rangeTrack: { position: 'absolute' as const, left: 0, right: 0, height: 10, borderRadius: 5, backgroundColor: c.subtle2 },
  rangeSel: { position: 'absolute' as const, height: 10, borderRadius: 5, backgroundColor: c.accent },
  playhead: { position: 'absolute' as const, width: 2, height: 34, backgroundColor: c.text },
  thumb: {
    position: 'absolute' as const,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: c.card,
  },
  thumbStart: { backgroundColor: '#2E9E5B' },
  thumbEnd: { backgroundColor: '#E5484D' },
  timesRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, direction: 'ltr' as const },
  timeSmall: { fontSize: 11.5, color: c.muted },
  fineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 10, gap: 10 },
  fineLabel: { width: 78, fontSize: 14, fontWeight: '700' as const, color: c.text },
  fineBtn: {
    width: 46,
    height: 38,
    borderRadius: 10,
    backgroundColor: c.subtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  fineBtnText: { fontSize: 15, fontWeight: '800' as const, color: c.text },
  fineTime: { minWidth: 64, textAlign: 'center' as const, fontSize: 16, fontWeight: '700' as const, color: c.text },
  lenText: { fontSize: 13.5, color: c.text2, marginTop: 12, fontWeight: '600' as const },
  lenMax: { color: c.danger },
  switchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: c.subtle,
  },
  switchTitle: { fontSize: 15, fontWeight: '700' as const, color: c.text, marginBottom: 2 },
  menuItem: { paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: c.border },
  menuText: { fontSize: 15.5, color: c.text, fontWeight: '500' as const },
  menuDanger: { color: c.danger, fontWeight: '700' as const },
  checkRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 11 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  boxOn: { backgroundColor: c.accent, borderColor: c.accent },
  boxMark: { color: c.onAccent, fontWeight: '900' as const, fontSize: 14 },
  checkLabel: { fontSize: 15.5, color: c.text },
});
