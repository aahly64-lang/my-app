import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  I18nManager,
  LayoutChangeEvent,
  Modal,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useScreenFrame } from './ui';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
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

/** In right-to-left layout the timeline starts at the right edge. */
const RTL = I18nManager.isRTL;
const DEFAULT_MAX_MS = 40_000;
const MIN_MS = 1_000;
const WAVE_BUCKETS = 1500;
const MAX_CHOICES: [number, string][] = [
  [30_000, '30 שנ\''],
  [40_000, '40 שנ\''],
  [60_000, 'דקה'],
  [120_000, '2 דק\''],
  [Number.MAX_SAFE_INTEGER, 'ללא הגבלה'],
];

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
  maxMs: number;
  fadeIn: boolean;
  fadeInSec: number;
  fadeOut: boolean;
  fadeOutSec: number;
}

const fadeInMs = (d: Draft) => (d.fadeIn ? d.fadeInSec * 1000 : 0);
const fadeOutMs = (d: Draft) => (d.fadeOut ? d.fadeOutSec * 1000 : 0);

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function RingtonesScreen({ visible, onClose }: Props) {
  const frame = useScreenFrame();
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [list, setList] = useState<MyRingtone[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [wave, setWave] = useState<number[] | null>(null);
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

  const play = (src: string, start: number, end: number, fadeMs: number, id: string, fadeOut = 0, fadeBase = start) => {
    stopPlay();
    if (!GeoAlarm.previewAudio(src, start, end, fadeBase, fadeMs, fadeOut)) {
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
    setWave(null);
    setDraft({
      src: a.uri,
      name: base,
      duration,
      start: 0,
      end: Math.min(30_000, duration),
      maxMs: DEFAULT_MAX_MS,
      fadeIn: true,
      fadeInSec: 2,
      fadeOut: false,
      fadeOutSec: 2,
    });
    const w = await GeoAlarm.audioWaveform(a.uri, WAVE_BUCKETS);
    setWave(w && w.peaks.some((x) => x > 0) ? w.peaks : []);
    // The real length measured while decoding (some mp3 files report a wrong length).
    if (w && w.durationMs > 1000 && Math.abs(w.durationMs - duration) > 300) {
      const real = w.durationMs;
      setDraft((d) => {
        if (!d || d.src !== a.uri) return d;
        const end = Math.min(d.end, real);
        const start = Math.min(d.start, Math.max(0, end - MIN_MS));
        return { ...d, duration: real, start, end };
      });
    }
  };

  const save = () => {
    if (!draft) return;
    const len = draft.end - draft.start;
    if (len > draft.maxMs) {
      const label = MAX_CHOICES.find(([ms]) => ms === draft.maxMs)?.[1] ?? '';
      Alert.alert('הקטע ארוך מהמקסימום', `הקטע באורך ${fmt(len)}, והאורך המקסימלי שבחרת הוא ${label}.`, [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'שמור כמו שהוא',
          onPress: () => doSave(draft),
        },
        {
          text: `כווץ ל-${label}`,
          onPress: () => {
            const mid = (draft.start + draft.end) / 2;
            let start = Math.max(0, mid - draft.maxMs / 2);
            let end = Math.min(draft.duration, start + draft.maxMs);
            start = Math.max(0, end - draft.maxMs);
            const d = { ...draft, start, end };
            setDraft(d);
            doSave(d);
          },
        },
      ]);
      return;
    }
    doSave(draft);
  };

  const doSave = async (draft: Draft) => {
    const name = draft.name.trim() || 'צלצול';
    stopPlay();
    setBusy(true);
    try {
      const id = newId();
      const r = await GeoAlarm.makeRingtone(
        draft.src,
        Math.round(draft.start),
        Math.round(draft.end),
        fadeInMs(draft),
        fadeOutMs(draft),
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
      <GestureHandlerRootView style={[styles.screen, frame.root]}>
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
            wave={wave}
            busy={busy}
            playing={playingId === 'draft'}
            playPos={playingId === 'draft' ? playPos : -1}
            onPlayFrom={(from) =>
              play(draft.src, from, draft.end, fadeInMs(draft), 'draft', fadeOutMs(draft), draft.start)
            }
            onStop={stopPlay}
            onSave={save}
            styles={styles}
            c={c}
          />
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: frame.bottomSpace }]}>
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
      </GestureHandlerRootView>
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
  wave,
  busy,
  playing,
  playPos,
  onPlayFrom,
  onStop,
  onSave,
  styles,
  c,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  wave: number[] | null;
  busy: boolean;
  playing: boolean;
  playPos: number;
  onPlayFrom: (fromMs: number) => void;
  onStop: () => void;
  onSave: () => void;
  styles: ReturnType<typeof makeStyles>;
  c: Palette;
}) {
  const [view, setView] = useState<{ from: number; to: number } | null>(null); // zoom window
  const [editTime, setEditTime] = useState<'start' | 'end' | null>(null);
  const [cursor, setCursor] = useState(draft.start); // white marker
  const [warn, setWarn] = useState(false);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const len = draft.end - draft.start;
  const from = view?.from ?? 0;
  const to = view?.to ?? draft.duration;
  const shownPos = playing && playPos >= 0 ? playPos : cursor;

  // Keep the latest values for gesture callbacks.
  const ref = useRef(draft);
  ref.current = draft;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // While playing, the white marker follows the music.
  useEffect(() => {
    if (playing && playPos >= 0) setCursor(playPos);
  }, [playing, playPos]);

  const showWarn = () => {
    setWarn(true);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    warnTimer.current = setTimeout(() => setWarn(false), 2500);
  };
  useEffect(() => () => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
  }, []);

  /** Moves one marker only. The other marker never moves; the maximum only warns. */
  const apply = (which: 'start' | 'end', v: number) => {
    const d = ref.current;
    let start = d.start;
    let end = d.end;
    if (which === 'start') start = Math.max(0, Math.min(v, end - MIN_MS));
    else end = Math.min(d.duration, Math.max(v, start + MIN_MS));
    if (end - start > d.maxMs && d.end - d.start <= d.maxMs) showWarn();
    const next = { ...d, start, end };
    ref.current = next;
    setDraft(next);
  };

  // Scrubbing pauses the music; letting go resumes it from the new point.
  const wasPlaying = useRef(false);
  const scrubStart = () => {
    if (playingRef.current) {
      wasPlaying.current = true;
      onStop();
    }
  };

  const moveCursor = (ms: number, restart: boolean) => {
    const d = ref.current;
    const v = Math.max(0, Math.min(ms, d.duration));
    setCursor(v);
    if (restart && (playingRef.current || wasPlaying.current)) {
      wasPlaying.current = false;
      if (v < d.end - 200) onPlayFrom(v);
      else onStop();
    }
  };

  const playFrom = (ms: number) => {
    const v = ms >= draft.start && ms < draft.end - 200 ? ms : draft.start;
    setCursor(v);
    onPlayFrom(v);
  };

  /** Choosing a maximum shrinks a longer selection equally from both sides. */
  const setMax = (m: number) => {
    const d = { ...draft, maxMs: m };
    if (d.end - d.start > m) {
      const mid = (d.start + d.end) / 2;
      let start = mid - m / 2;
      let end = mid + m / 2;
      if (start < 0) {
        end -= start;
        start = 0;
      }
      if (end > d.duration) {
        start -= end - d.duration;
        end = d.duration;
      }
      d.start = Math.max(0, start);
      d.end = end;
    }
    ref.current = d;
    setDraft(d);
  };

  const toggleZoom = () => {
    if (view) {
      setView(null);
      return;
    }
    const pad = Math.max(1500, len * 0.25);
    setView({ from: Math.max(0, draft.start - pad), to: Math.min(draft.duration, draft.end + pad) });
  };

  const fadeChips = (value: number, on: boolean, set: (n: number) => void) => (
    <View style={styles.chipsRow}>
      {[1, 2, 3].map((n) => (
        <TouchableOpacity
          key={n}
          disabled={!on}
          style={[styles.chip, n === value && on && styles.chipOn, !on && styles.dim]}
          onPress={() => set(n)}
        >
          <Text style={[styles.chipText, n === value && on && styles.chipTextOn]}>{n} שנ'</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const maxLabel = MAX_CHOICES.find(([ms]) => ms === draft.maxMs)?.[1] ?? '';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>שם הצלצול</Text>
      <TextInput
        style={styles.input}
        value={draft.name}
        onChangeText={(t) => setDraft({ ...draft, name: t })}
        placeholderTextColor={c.muted}
      />

      <View style={styles.waveHeader}>
        <Text style={styles.label}>בחר קטע</Text>
        <TouchableOpacity style={styles.zoomBtn} onPress={toggleZoom}>
          <Text style={styles.zoomText}>{view ? '↔️ כל השיר' : '🔍 הגדל'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hintTight}>גע בגל או גרור עליו כדי להזיז את הסמן הלבן, גם בזמן ניגון. גרור את הלשוניות כדי לקבוע התחלה וסוף.</Text>
      <Wave
        wave={wave}
        duration={draft.duration}
        from={from}
        to={to}
        start={draft.start}
        end={draft.end}
        cursor={shownPos}
        fadeIn={fadeInMs(draft)}
        fadeOut={fadeOutMs(draft)}
        warn={warn}
        onMove={apply}
        onCursor={moveCursor}
        onScrubStart={scrubStart}
        styles={styles}
      />
      <View style={styles.timesRow}>
        <Text style={styles.timeSmall}>
          {view ? 'תחילת התצוגה' : 'תחילת השיר'} {fmt(from)}
        </Text>
        <Text style={styles.timeSmall}>
          {view ? 'סוף התצוגה' : 'סוף השיר'} {fmt(to)}
        </Text>
      </View>

      {warn || len > draft.maxMs ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>
            הקטע ({fmt(len)}) ארוך מהאורך המקסימלי ({maxLabel}). אפשר להמשיך, או ללחוץ שוב על "{maxLabel}" למטה כדי
            לכווץ אותו באופן שווה משני הצדדים.
          </Text>
        </View>
      ) : null}

      <View style={styles.playBar}>
        <TouchableOpacity style={styles.playMain} onPress={() => (playing ? onStop() : playFrom(cursor))}>
          <Text style={styles.playMainText}>{playing ? '⏸' : '▶️'}</Text>
        </TouchableOpacity>
        <View style={styles.flex1}>
          <Text style={styles.clock}>{fmt(shownPos)}</Text>
          <Text style={styles.clockSub}>
            בקטע: {fmt(Math.max(0, Math.min(shownPos, draft.end) - draft.start))} / {fmt(len)}
          </Text>
        </View>
      </View>
      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => playFrom(draft.start)}>
          <Text style={styles.quickText}>⏮ מתחילת הקטע</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => playFrom(Math.max(draft.start, draft.end - 5000))}>
          <Text style={styles.quickText}>⏭ 5 שנ' לפני הסוף</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.fineRow}>
        <Text style={styles.fineLabel}>🟢 התחלה</Text>
        <TouchableOpacity style={styles.fineBtn} onPress={() => apply('start', draft.start - 1000)}>
          <Text style={styles.fineBtnText}>-1</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.timeBox} onPress={() => setEditTime('start')}>
          <Text style={styles.fineTime}>{fmt(draft.start)}</Text>
          <Text style={styles.timeEditHint}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fineBtn} onPress={() => apply('start', draft.start + 1000)}>
          <Text style={styles.fineBtnText}>+1</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.fineRow}>
        <Text style={styles.fineLabel}>🔴 סוף</Text>
        <TouchableOpacity style={styles.fineBtn} onPress={() => apply('end', draft.end - 1000)}>
          <Text style={styles.fineBtnText}>-1</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.timeBox} onPress={() => setEditTime('end')}>
          <Text style={styles.fineTime}>{fmt(draft.end)}</Text>
          <Text style={styles.timeEditHint}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fineBtn} onPress={() => apply('end', draft.end + 1000)}>
          <Text style={styles.fineBtnText}>+1</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.lenText}>אורך הקטע: {fmt(len)}</Text>
      <Text style={styles.label}>אורך מקסימלי</Text>
      <View style={styles.chipsRow}>
        {MAX_CHOICES.map(([ms, label]) => (
          <TouchableOpacity
            key={label}
            style={[styles.chip, draft.maxMs === ms && styles.chipOn]}
            onPress={() => setMax(ms)}
          >
            <Text style={[styles.chipText, draft.maxMs === ms && styles.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.switchRow}>
        <View style={styles.flex1}>
          <Text style={styles.switchTitle}>כניסה הדרגתית</Text>
          <Text style={styles.hintTight}>הצלצול מתחיל בשקט ומתגבר.</Text>
          {fadeChips(draft.fadeInSec, draft.fadeIn, (n) => setDraft({ ...draft, fadeInSec: n }))}
        </View>
        <Switch value={draft.fadeIn} onValueChange={(v) => setDraft({ ...draft, fadeIn: v })} />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.flex1}>
          <Text style={styles.switchTitle}>יציאה הדרגתית</Text>
          <Text style={styles.hintTight}>הצלצול נחלש לאט בסוף הקטע.</Text>
          {fadeChips(draft.fadeOutSec, draft.fadeOut, (n) => setDraft({ ...draft, fadeOutSec: n }))}
        </View>
        <Switch value={draft.fadeOut} onValueChange={(v) => setDraft({ ...draft, fadeOut: v })} />
      </View>

      <TouchableOpacity style={[styles.bigBtn, busy && styles.dim]} onPress={onSave} disabled={busy}>
        {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={styles.bigBtnText}>💾 שמור צלצול</Text>}
      </TouchableOpacity>

      <TimeEditor
        which={editTime}
        value={editTime === 'start' ? draft.start : draft.end}
        onClose={() => setEditTime(null)}
        onSave={(ms) => {
          if (editTime) apply(editTime, ms);
          setEditTime(null);
        }}
        styles={styles}
        c={c}
      />
    </ScrollView>
  );
}

/** Popup to type a time as minutes : seconds . tenths */
function TimeEditor({
  which,
  value,
  onClose,
  onSave,
  styles,
  c,
}: {
  which: 'start' | 'end' | null;
  value: number;
  onClose: () => void;
  onSave: (ms: number) => void;
  styles: ReturnType<typeof makeStyles>;
  c: Palette;
}) {
  const [m, setM] = useState('0');
  const [sec, setSec] = useState('0');
  const [t, setT] = useState('0');
  useEffect(() => {
    if (!which) return;
    const tenths = Math.round(value / 100);
    setM(String(Math.floor(tenths / 600)));
    setSec(String(Math.floor((tenths % 600) / 10)));
    setT(String(tenths % 10));
  }, [which, value]);

  const num = (x: string) => Math.max(0, parseInt(x || '0', 10) || 0);
  const total = () => num(m) * 60_000 + Math.min(59, num(sec)) * 1000 + Math.min(9, num(t)) * 100;
  const bump = (field: 'm' | 's' | 't', d: number) => {
    let ms = total();
    ms += field === 'm' ? d * 60_000 : field === 's' ? d * 1000 : d * 100;
    ms = Math.max(0, ms);
    const tenths = Math.round(ms / 100);
    setM(String(Math.floor(tenths / 600)));
    setSec(String(Math.floor((tenths % 600) / 10)));
    setT(String(tenths % 10));
  };
  const field = (label: string, v: string, set: (x: string) => void, f: 'm' | 's' | 't', w: number) => (
    <View style={styles.tfCol}>
      <TouchableOpacity style={styles.tfBump} onPress={() => bump(f, 1)}>
        <Text style={styles.fineBtnText}>+</Text>
      </TouchableOpacity>
      <TextInput
        style={[styles.tfInput, { width: w }]}
        value={v}
        onChangeText={(x) => set(x.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        maxLength={f === 't' ? 1 : 2}
        selectTextOnFocus
        placeholderTextColor={c.muted}
      />
      <TouchableOpacity style={styles.tfBump} onPress={() => bump(f, -1)}>
        <Text style={styles.fineBtnText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.tfLabel}>{label}</Text>
    </View>
  );

  return (
    <PopupShell visible={!!which} title={which === 'start' ? '🟢 זמן התחלה' : '🔴 זמן סוף'} onClose={onClose} yellow={false}>
      <View style={styles.tfRow}>
        {field('דקות', m, setM, 'm', 56)}
        <Text style={styles.tfSep}>:</Text>
        {field('שניות', sec, setSec, 's', 56)}
        <Text style={styles.tfSep}>.</Text>
        {field('עשיריות', t, setT, 't', 44)}
      </View>
      <TouchableOpacity style={styles.bigBtn} onPress={() => onSave(total())}>
        <Text style={styles.bigBtnText}>אישור</Text>
      </TouchableOpacity>
    </PopupShell>
  );
}

const WAVE_H = 96;
const BAR_W = 3;
const BAR_GAP = 1;
const TOP_SPACE = 30; // room above the wave for the white marker's time pill

function Wave({
  wave,
  duration,
  from,
  to,
  start,
  end,
  cursor,
  fadeIn,
  fadeOut,
  warn,
  onMove,
  onCursor,
  onScrubStart,
  styles,
}: {
  wave: number[] | null;
  duration: number;
  from: number;
  to: number;
  start: number;
  end: number;
  cursor: number;
  fadeIn: number;
  fadeOut: number;
  warn: boolean;
  onMove: (which: 'start' | 'end', ms: number) => void;
  onCursor: (ms: number, restart: boolean) => void;
  onScrubStart: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [width, setWidth] = useState(1);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [dragCur, setDragCur] = useState<number | null>(null); // white marker while dragged
  const span = Math.max(1, to - from);
  const xOf = (ms: number) => ((ms - from) / span) * width;

  // Gesture state lives in refs so the gestures can be created once.
  const live = useRef({ start, end, cursor, width, span, from, onMove, onCursor, onScrubStart });
  live.current = { start, end, cursor, width, span, from, onMove, onCursor, onScrubStart };
  const base = useRef(0);

  const makePan = (which: 'start' | 'end') =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .hitSlop({ horizontal: 18, vertical: 12 })
      .onBegin(() => {
        base.current = which === 'start' ? live.current.start : live.current.end;
        setDragging(which);
      })
      .onUpdate((e) => {
        const L = live.current;
        const dx = RTL ? -e.translationX : e.translationX;
        L.onMove(which, base.current + (dx / L.width) * L.span);
      })
      .onFinalize(() => setDragging(null));

  const panStart = useRef(makePan('start')).current;
  const panEnd = useRef(makePan('end')).current;
  const cursorBase = useRef(0);
  const panCursor = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .hitSlop({ horizontal: 12, vertical: 8 })
      .onBegin(() => {
        cursorBase.current = live.current.cursor;
        live.current.onScrubStart();
      })
      .onUpdate((e) => {
        const L = live.current;
        const dx = RTL ? -e.translationX : e.translationX;
        const v = Math.max(0, cursorBase.current + (dx / L.width) * L.span);
        setDragCur(v);
        L.onCursor(v, false);
      })
      .onFinalize((e) => {
        const L = live.current;
        const dx = RTL ? -e.translationX : e.translationX;
        L.onCursor(Math.max(0, cursorBase.current + (dx / L.width) * L.span), true);
        setDragCur(null);
      })
  ).current;
  // Absolute position on the wave -> time.
  const msAtX = (ex: number) => {
    const L = live.current;
    const x = Math.max(0, Math.min(L.width, RTL ? L.width - ex : ex));
    return L.from + (x / L.width) * L.span;
  };
  const lastScrub = useRef(0);
  const scrubbing = useRef(false);
  const scrubWave = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart((e) => {
      scrubbing.current = true;
      live.current.onScrubStart();
      lastScrub.current = msAtX(e.x);
      setDragCur(lastScrub.current);
      live.current.onCursor(lastScrub.current, false);
    })
    .onUpdate((e) => {
      lastScrub.current = msAtX(e.x);
      setDragCur(lastScrub.current);
      live.current.onCursor(lastScrub.current, false);
    })
    .onFinalize(() => {
      if (scrubbing.current) live.current.onCursor(lastScrub.current, true);
      scrubbing.current = false;
      setDragCur(null);
    });
  const tapWave = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      live.current.onCursor(msAtX(e.x), true);
    });
  const waveGesture = useRef(Gesture.Race(scrubWave, tapWave)).current;

  // Bars for the visible window
  const bars = Math.max(10, Math.floor(width / (BAR_W + BAR_GAP)));
  const heights: number[] = [];
  if (wave && wave.length) {
    for (let i = 0; i < bars; i++) {
      const t0 = from + (i / bars) * span;
      const t1 = from + ((i + 1) / bars) * span;
      const b0 = Math.floor((t0 / duration) * wave.length);
      const b1 = Math.max(b0 + 1, Math.ceil((t1 / duration) * wave.length));
      let peak = 0;
      for (let b = b0; b < b1 && b < wave.length; b++) if (wave[b] > peak) peak = wave[b];
      heights.push(peak);
    }
  }

  const sx = xOf(start);
  const ex = xOf(end);
  const curShown = dragCur ?? cursor;
  const cx = xOf(curShown);

  const gainAt = (t: number) => {
    if (t < start || t > end) return 1;
    const gi = fadeIn > 0 ? Math.min(1, (t - start) / fadeIn) : 1;
    const go = fadeOut > 0 ? Math.min(1, (end - t) / fadeOut) : 1;
    return Math.max(0.08, Math.min(gi, go));
  };

  return (
    <View style={styles.waveOuter}>
      <GestureDetector gesture={waveGesture}>
        <View style={styles.waveBox} onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width))}>
          {wave === null ? (
            <View style={styles.waveLoading}>
              <ActivityIndicator />
              <Text style={styles.hintTight}>טוען גל קול…</Text>
            </View>
          ) : (
            <View style={styles.barsRow} pointerEvents="none">
              {(heights.length ? heights : new Array(bars).fill(0.25)).map((h, i) => {
                const t = from + ((i + 0.5) / bars) * span;
                const inSel = t >= start && t <= end;
                const hh = Math.max(2, h * (WAVE_H - 8) * (inSel ? gainAt(t) : 1));
                return <View key={i} style={[styles.bar, { height: hh }, inSel ? styles.barOn : styles.barOff]} />;
              })}
            </View>
          )}
          <View pointerEvents="none" style={[styles.selShade, { left: sx, width: Math.max(1, ex - sx) }]} />
        </View>
      </GestureDetector>

      {/* white marker: line over the wave + time pill above it (drag the pill) */}
      {cx >= -1 && cx <= width + 1 ? (
        <>
          <View pointerEvents="none" style={[styles.playhead, { left: cx - 1 }]} />
          <GestureDetector gesture={panCursor}>
            <View style={[styles.cursorPill, { left: Math.min(Math.max(-20, cx - 32), width - 44) }]}>
              <Text style={styles.cursorText}>{fmt(curShown)}</Text>
            </View>
          </GestureDetector>
        </>
      ) : null}

      {/* start / end markers: a line over the wave and a grip below it */}
      {sx >= -1 && sx <= width + 1 ? (
        <GestureDetector gesture={panStart}>
          <View style={[styles.handle, { left: sx - 22 }]}>
            <View style={[styles.handleLine, styles.handleStart]} />
            <View style={[styles.grip, styles.handleStart]}>
              <Text style={styles.gripText}>⟷</Text>
            </View>
          </View>
        </GestureDetector>
      ) : null}
      {ex >= -1 && ex <= width + 1 ? (
        <GestureDetector gesture={panEnd}>
          <View style={[styles.handle, { left: ex - 22 }]}>
            <View style={[styles.handleLine, styles.handleEnd]} />
            <View style={[styles.grip, styles.handleEnd]}>
              <Text style={styles.gripText}>⟷</Text>
            </View>
          </View>
        </GestureDetector>
      ) : null}
      {dragging ? (
        <View
          pointerEvents="none"
          style={[
            styles.bubble,
            warn && styles.bubbleWarn,
            { left: Math.min(Math.max(-10, (dragging === 'start' ? sx : ex) - 36), width - 62) },
          ]}
        >
          <Text style={styles.bubbleText}>{fmt(dragging === 'start' ? start : end)}</Text>
        </View>
      ) : null}
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
  waveHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  zoomBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: c.subtle, marginTop: 8 },
  zoomText: { fontSize: 13.5, fontWeight: '700' as const, color: c.text },
  waveOuter: { marginHorizontal: 22, marginTop: 10, paddingTop: TOP_SPACE, height: TOP_SPACE + WAVE_H + 78 },
  waveBox: { height: WAVE_H, borderRadius: 12, backgroundColor: c.subtle, overflow: 'hidden' as const },
  waveLoading: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6 },
  barsRow: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const },
  bar: { width: BAR_W, marginRight: BAR_GAP, borderRadius: 2 },
  barOn: { backgroundColor: c.accent },
  barOff: { backgroundColor: c.muted, opacity: 0.55 },
  selShade: { position: 'absolute' as const, top: 0, bottom: 0, backgroundColor: c.accent, opacity: 0.12 },
  playhead: { position: 'absolute' as const, top: TOP_SPACE - 4, height: WAVE_H + 4, width: 2, backgroundColor: c.text },
  cursorPill: {
    position: 'absolute' as const,
    top: 0,
    width: 64,
    height: 26,
    borderRadius: 13,
    backgroundColor: c.text,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cursorText: { color: c.bg, fontWeight: '800' as const, fontSize: 12.5 },
  bubbleWarn: { backgroundColor: c.danger },
  warnBox: { backgroundColor: c.dangerSoft, borderRadius: 10, padding: 10, marginTop: 8 },
  warnText: { color: c.danger, fontWeight: '700' as const, fontSize: 13.5 },
  playBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
  },
  playMain: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: c.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  playMainText: { fontSize: 24 },
  clock: { fontSize: 28, fontWeight: '800' as const, color: c.text, fontVariant: ['tabular-nums' as const] },
  clockSub: { fontSize: 13, color: c.muted, fontVariant: ['tabular-nums' as const] },
  quickRow: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  quickBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: c.subtle,
    alignItems: 'center' as const,
  },
  quickText: { fontSize: 13.5, fontWeight: '700' as const, color: c.text },
  handle: { position: 'absolute' as const, top: TOP_SPACE, width: 44, height: WAVE_H + 40, alignItems: 'center' as const },
  handleLine: { width: 3, height: WAVE_H, borderRadius: 2 },
  grip: {
    width: 40,
    height: 34,
    borderRadius: 10,
    marginTop: 4,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  gripText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' as const },
  handleStart: { backgroundColor: '#2E9E5B' },
  handleEnd: { backgroundColor: '#E5484D' },
  bubble: {
    position: 'absolute' as const,
    top: TOP_SPACE + WAVE_H + 42,
    width: 72,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: c.primary,
    alignItems: 'center' as const,
  },
  bubbleText: { color: c.onPrimary, fontWeight: '800' as const, fontSize: 14 },
  timeBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  timeEditHint: { fontSize: 12 },
  chipsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontSize: 13.5, color: c.text, fontWeight: '600' as const },
  chipTextOn: { color: c.onAccent, fontWeight: '800' as const },
  tfRow: {
    flexDirection: RTL ? ('row-reverse' as const) : ('row' as const),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginVertical: 8,
  },
  tfCol: { alignItems: 'center' as const, gap: 4 },
  tfBump: { width: 44, height: 32, borderRadius: 8, backgroundColor: c.subtle, alignItems: 'center' as const, justifyContent: 'center' as const },
  tfInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.card,
    textAlign: 'center' as const,
    fontSize: 22,
    fontWeight: '700' as const,
    color: c.text,
  },
  tfLabel: { fontSize: 12, color: c.muted },
  tfSep: { fontSize: 26, fontWeight: '800' as const, color: c.text, marginBottom: 20 },
  timesRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginHorizontal: 8 },
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
