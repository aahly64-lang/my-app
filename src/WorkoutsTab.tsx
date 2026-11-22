import React, { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Image, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useAppStyles } from './appStyles';
import { useTheme } from './theme';
import { PopupShell, confirm } from './ui';
import {
  WorkoutGroup,
  WorkoutLink,
  WorkoutSub,
  loadBoard,
  loadGroups,
  migrateCategories,
  newId,
  saveGroups,
} from './storage';

export function detectPlatform(url: string): WorkoutLink['platform'] {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  return 'other';
}

function youtubeId(url: string): string | null {
  const m =
    url.match(/youtu\.be\/([\w-]{6,})/) ||
    url.match(/[?&]v=([\w-]{6,})/) ||
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

export const EQUIPMENT = [
  'משקל גוף',
  'משקולות יד',
  'מוט',
  'מוט EZ',
  'פלייט',
  'קטלבל',
  'סמית משין',
  'כבלים',
  'מכונה',
  'ספסל',
  'מתח / מקבילים',
  'גומיות',
  'TRX',
  'כדור פיזיו',
  'חבל קפיצה',
];

/** YouTube video title (no API key needed). */
async function fetchYoutubeTitle(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.title === 'string' ? j.title : null;
  } catch {
    return null;
  }
}

async function openVideo(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('קישור לא תקין', 'לא ניתן לפתוח את הקישור.');
  }
}

export interface SharedLink {
  url: string;
  title: string;
}

interface Props {
  dataVersion: number;
  shared: SharedLink | null;
  onSharedUsed: () => void;
}

type Rename = { kind: 'group' | 'sub'; id: string; name: string } | null;

export default function WorkoutsTab({ dataVersion, shared, onSharedUsed }: Props) {
  const styles = useAppStyles();
  const c = useTheme();
  const [groups, setGroups] = useState<WorkoutGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [rename, setRename] = useState<Rename>(null);
  const [editing, setEditing] = useState<WorkoutLink | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evGroup, setEvGroup] = useState('');
  const [evSub, setEvSub] = useState('');
  const [evNote, setEvNote] = useState('');
  const [evTags, setEvTags] = useState<string[]>([]);
  const [evFav, setEvFav] = useState(false);
  const [origin, setOrigin] = useState<{ g: string; s: string } | null>(null); // where the edited video lives
  const [filter, setFilter] = useState<string | null>(null); // 'fav' or an equipment tag (top level)
  const [subFilter, setSubFilter] = useState<string | null>(null); // equipment tag inside a sub-group
  const [titleBusy, setTitleBusy] = useState(false);

  useEffect(() => {
    (async () => {
      let g = await loadGroups();
      if (!g) {
        const board = await loadBoard();
        g = migrateCategories(board?.categories);
        await saveGroups(g);
      }
      setGroups(g);
    })();
  }, [dataVersion]);

  const persist = useCallback((next: WorkoutGroup[]) => {
    setGroups(next);
    saveGroups(next);
  }, []);

  const group = groups.find((g) => g.id === groupId) ?? null;
  const sub = group?.subs.find((s) => s.id === subId) ?? null;

  const goGroup = (id: string | null) => {
    setGroupId(id);
    setSubId(null);
    setNewName('');
  };

  // The phone's back button goes up one level instead of leaving the app.
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (filter && !groupId) {
        setFilter(null);
        return true;
      }
      if (subId) {
        setSubId(null);
        return true;
      }
      if (groupId) {
        goGroup(null);
        return true;
      }
      return false;
    });
    return () => h.remove();
  }, [groupId, subId, filter]);

  /** Group chips + clickable path, shown at the top of levels 2 and 3. */
  const navBar = () => (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navChips} keyboardShouldPersistTaps="handled">
        {groups.map((g) => (
          <TouchableOpacity
            key={g.id}
            style={[styles.chip, styles.chipSpaced, g.id === groupId && styles.chipActive]}
            onPress={() => goGroup(g.id)}
          >
            <Text style={[styles.chipText, g.id === groupId && styles.chipTextActive]}>{g.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.crumbRow}>
        <TouchableOpacity onPress={() => goGroup(null)} hitSlop={6}>
          <Text style={styles.crumbLink}>כל הקבוצות</Text>
        </TouchableOpacity>
        {group ? (
          <>
            <Text style={styles.crumbSep}> › </Text>
            {sub ? (
              <TouchableOpacity onPress={() => setSubId(null)} hitSlop={6}>
                <Text style={styles.crumbLink}>{group.name}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.crumbCurrent}>{group.name}</Text>
            )}
          </>
        ) : null}
        {sub ? (
          <>
            <Text style={styles.crumbSep}> › </Text>
            <Text style={styles.crumbCurrent}>{sub.name}</Text>
          </>
        ) : null}
      </View>
      {group && sub && group.subs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navChips} keyboardShouldPersistTaps="handled">
          {group.subs.map((x) => (
            <TouchableOpacity
              key={x.id}
              style={[styles.chip, styles.chipSpaced, styles.chipSmall, x.id === subId && styles.chipActive]}
              onPress={() => setSubId(x.id)}
            >
              <Text style={[styles.chipText, x.id === subId && styles.chipTextActive]}>{x.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  // A link shared from YouTube/Facebook fills the add form once a sub-group is open.
  useEffect(() => {
    if (shared && sub) {
      setVideoUrl(shared.url);
      setVideoTitle(shared.title);
      onSharedUsed();
    }
  }, [shared, sub, onSharedUsed]);

  // Pasting a YouTube link fills in the video's name.
  useEffect(() => {
    const url = extractUrl(videoUrl);
    if (!url || videoTitle.trim() || detectPlatform(url) !== 'youtube') return;
    let live = true;
    setTitleBusy(true);
    const t = setTimeout(async () => {
      const title = await fetchYoutubeTitle(url);
      if (live) {
        setTitleBusy(false);
        if (title) setVideoTitle((cur) => cur || title);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
      setTitleBusy(false);
    };
  }, [videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSubFilter(null), [subId]);

  const updateGroup = (id: string, fn: (g: WorkoutGroup) => WorkoutGroup) =>
    persist(groups.map((g) => (g.id === id ? fn(g) : g)));

  const updateSub = (gid: string, sid: string, fn: (s: WorkoutSub) => WorkoutSub) =>
    updateGroup(gid, (g) => ({ ...g, subs: g.subs.map((s) => (s.id === sid ? fn(s) : s)) }));

  // ---------- add ----------
  const addGroup = () => {
    const name = newName.trim();
    if (!name) return;
    persist([...groups, { id: newId(), name, subs: [] }]);
    setNewName('');
  };

  const addSub = () => {
    const name = newName.trim();
    if (!name || !group) return;
    updateGroup(group.id, (g) => ({ ...g, subs: [...g.subs, { id: newId(), name, videos: [] }] }));
    setNewName('');
  };

  const addVideo = async () => {
    if (!group || !sub) return;
    const url = (extractUrl(videoUrl) ?? videoUrl).trim();
    if (!url) {
      Alert.alert('חסר קישור', 'הדבק קישור לסרטון.');
      return;
    }
    const platform = detectPlatform(url);
    let title = videoTitle.trim();
    if (!title && platform === 'youtube') title = (await fetchYoutubeTitle(url)) ?? '';
    const item: WorkoutLink = { id: newId(), title: title || 'סרטון כושר', url, platform };
    updateSub(group.id, sub.id, (s) => ({ ...s, videos: [...s.videos, item] }));
    setVideoTitle('');
    setVideoUrl('');
  };

  // ---------- rename / delete ----------
  const saveRename = () => {
    if (!rename) return;
    const name = rename.name.trim();
    if (!name) return;
    if (rename.kind === 'group') updateGroup(rename.id, (g) => ({ ...g, name }));
    else if (group) updateSub(group.id, rename.id, (s) => ({ ...s, name }));
    setRename(null);
  };

  const deleteGroup = (g: WorkoutGroup) => {
    const count = g.subs.reduce((n, s) => n + s.videos.length, 0);
    confirm(
      'מחיקת קבוצה',
      `למחוק את "${g.name}"${count ? ` ואת ${count} הסרטונים שבה` : ''}?`,
      'מחק',
      () => {
        persist(groups.filter((x) => x.id !== g.id));
        setGroupId(null);
        setSubId(null);
      }
    );
  };

  const deleteSub = (s: WorkoutSub) => {
    if (!group) return;
    confirm(
      'מחיקת תת-קבוצה',
      `למחוק את "${s.name}"${s.videos.length ? ` ואת ${s.videos.length} הסרטונים שבה` : ''}?`,
      'מחק',
      () => {
        updateGroup(group.id, (g) => ({ ...g, subs: g.subs.filter((x) => x.id !== s.id) }));
        setSubId(null);
      }
    );
  };

  // ---------- video edit ----------
  const locate = (id: string) => {
    for (const g of groups) for (const s of g.subs) if (s.videos.some((v) => v.id === id)) return { g: g.id, s: s.id };
    return null;
  };

  const openEdit = (v: WorkoutLink) => {
    const at = locate(v.id);
    setOrigin(at);
    setEditing(v);
    setEvTitle(v.title);
    setEvUrl(v.url);
    setEvGroup(at?.g ?? '');
    setEvSub(at?.s ?? '');
    setEvNote(v.note ?? '');
    setEvTags(v.tags ?? []);
    setEvFav(!!v.fav);
  };

  /** Changes one video wherever it is. */
  const patchVideo = (id: string, fn: (v: WorkoutLink) => WorkoutLink) =>
    persist(
      groups.map((g) => ({
        ...g,
        subs: g.subs.map((s) => (s.videos.some((v) => v.id === id) ? { ...s, videos: s.videos.map((v) => (v.id === id ? fn(v) : v)) } : s)),
      }))
    );

  const toggleFav = (v: WorkoutLink) => patchVideo(v.id, (x) => ({ ...x, fav: !x.fav }));

  const saveVideo = () => {
    if (!editing) return;
    const url = evUrl.trim();
    if (!url) {
      Alert.alert('חסר קישור', 'הדבק קישור לסרטון.');
      return;
    }
    const updated: WorkoutLink = {
      ...editing,
      title: evTitle.trim() || 'סרטון כושר',
      url,
      platform: detectPlatform(url),
      note: evNote.trim() || undefined,
      tags: evTags.length ? evTags : undefined,
      fav: evFav || undefined,
    };
    const fromG = origin?.g ?? '';
    const fromS = origin?.s ?? '';
    const moved = !!evSub && (evGroup !== fromG || evSub !== fromS);
    persist(
      groups.map((g) => ({
        ...g,
        subs: g.subs.map((s) => {
          let videos = s.videos;
          if (moved) videos = videos.filter((v) => v.id !== updated.id);
          if (!moved && s.id === fromS) videos = videos.map((v) => (v.id === updated.id ? updated : v));
          if (moved && g.id === evGroup && s.id === evSub) videos = [...videos, updated];
          return { ...s, videos };
        }),
      }))
    );
    setEditing(null);
  };

  const deleteVideo = () => {
    if (!editing) return;
    const v = editing;
    confirm('מחיקת סרטון', `למחוק את "${v.title}"?`, 'מחק', () => {
      persist(groups.map((g) => ({ ...g, subs: g.subs.map((s) => ({ ...s, videos: s.videos.filter((x) => x.id !== v.id) })) })));
      setEditing(null);
    });
  };

  // ---------- rows ----------
  const Handle = ({ drag }: { drag: () => void }) => (
    <TouchableOpacity onLongPress={drag} delayLongPress={150} hitSlop={10} style={styles.dragHandle}>
      <Text style={styles.dragHandleText}>☰</Text>
    </TouchableOpacity>
  );

  const renderGroup = ({ item, drag, isActive }: RenderItemParams<WorkoutGroup>) => {
    const count = item.subs.reduce((n, s) => n + s.videos.length, 0);
    return (
      <ScaleDecorator>
        <TouchableOpacity
          style={[styles.listRow, isActive && styles.listRowActive]}
          onPress={() => {
            setGroupId(item.id);
            setNewName('');
          }}
          onLongPress={drag}
        >
          <Handle drag={drag} />
          <View style={styles.flex1}>
            <Text style={styles.listRowTitle}>{item.name}</Text>
            <Text style={styles.itemSub}>
              {item.subs.length} תת-קבוצות · {count} סרטונים
            </Text>
          </View>
          <Text style={styles.chevron}>‹</Text>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  const renderSub = ({ item, drag, isActive }: RenderItemParams<WorkoutSub>) => (
    <ScaleDecorator>
      <TouchableOpacity
        style={[styles.listRow, isActive && styles.listRowActive]}
        onPress={() => setSubId(item.id)}
        onLongPress={drag}
      >
        <Handle drag={drag} />
        <View style={styles.flex1}>
          <Text style={styles.listRowTitle}>{item.name}</Text>
          <Text style={styles.itemSub}>{item.videos.length} סרטונים</Text>
        </View>
        <Text style={styles.chevron}>‹</Text>
      </TouchableOpacity>
    </ScaleDecorator>
  );

  const videoRow = (item: WorkoutLink, drag: (() => void) | null, isActive: boolean, where?: string) => {
    const yt = item.platform === 'youtube' ? youtubeId(item.url) : null;
    return (
        <View style={[styles.listRow, isActive && styles.listRowActive]}>
          {drag ? <Handle drag={drag} /> : null}
          <TouchableOpacity style={styles.videoMain} onPress={() => openVideo(item.url)} onLongPress={drag ?? (() => openEdit(item))}>
            {yt ? (
              <Image source={{ uri: `https://img.youtube.com/vi/${yt}/mqdefault.jpg` }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={styles.thumbIcon}>{item.platform === 'facebook' ? 'f' : '▶'}</Text>
              </View>
            )}
            <View style={styles.flex1}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.itemSub} numberOfLines={1}>
                {where ?? (item.platform === 'youtube' ? 'YouTube' : item.platform === 'facebook' ? 'Facebook' : 'קישור')}
                {item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}
              </Text>
              {item.note ? (
                <Text style={[styles.itemSub, { color: c.text2 }]} numberOfLines={2}>
                  📝 {item.note}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
          <View>
            <TouchableOpacity style={styles.iconBtn} onPress={() => toggleFav(item)} hitSlop={6}>
              <Text style={[styles.iconBtnText, !item.fav && { opacity: 0.35 }]}>{item.fav ? '⭐' : '☆'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(item)} hitSlop={6}>
              <Text style={styles.iconBtnText}>✏️</Text>
            </TouchableOpacity>
          </View>
        </View>
    );
  };

  const renderVideo = ({ item, drag, isActive }: RenderItemParams<WorkoutLink>) => (
    <ScaleDecorator>{videoRow(item, drag, isActive)}</ScaleDecorator>
  );

  // All videos with their place, for favorites and equipment filters.
  const allVideos = groups.flatMap((g) => g.subs.flatMap((s) => s.videos.map((v) => ({ v, where: `${g.name} › ${s.name}` }))));
  const usedTags = EQUIPMENT.filter((t) => allVideos.some(({ v }) => v.tags?.includes(t)));
  const favCount = allVideos.filter(({ v }) => v.fav).length;

  const filterChips = () =>
    favCount || usedTags.length ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navChips} keyboardShouldPersistTaps="handled">
        {favCount ? (
          <TouchableOpacity
            style={[styles.chip, styles.chipSpaced, filter === 'fav' && styles.chipActive]}
            onPress={() => setFilter(filter === 'fav' ? null : 'fav')}
          >
            <Text style={[styles.chipText, filter === 'fav' && styles.chipTextActive]}>⭐ מועדפים ({favCount})</Text>
          </TouchableOpacity>
        ) : null}
        {usedTags.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, styles.chipSpaced, filter === t && styles.chipActive]}
            onPress={() => setFilter(filter === t ? null : t)}
          >
            <Text style={[styles.chipText, filter === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    ) : null;

  const sharedBanner = shared ? (
    <View style={styles.sharedBanner}>
      <Text style={styles.sharedBannerText}>
        התקבל קישור ששיתפת. בחר קבוצה ותת-קבוצה, והקישור יחכה לך בטופס ההוספה.
      </Text>
    </View>
  ) : null;

  const addRow = (placeholder: string, onAdd: () => void) => (
    <View style={styles.row}>
      <TextInput
        style={[styles.input, styles.flex1, styles.noMargin]}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        value={newName}
        onChangeText={setNewName}
        onSubmitEditing={onAdd}
      />
      <TouchableOpacity style={styles.darkBtn} onPress={onAdd}>
        <Text style={styles.whiteBtnText}>הוסף</Text>
      </TouchableOpacity>
    </View>
  );

  // ---------- level 3: videos of a sub-group ----------
  if (group && sub) {
    return (
      <View style={styles.flex1}>
        <DraggableFlatList
          data={subFilter ? sub.videos.filter((v) => v.tags?.includes(subFilter)) : sub.videos}
          keyExtractor={(v) => v.id}
          renderItem={renderVideo}
          onDragEnd={({ data }) => !subFilter && updateSub(group.id, sub.id, (s) => ({ ...s, videos: data }))}
          contentContainerStyle={styles.deskContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {navBar()}
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionTitle}>
                  {group.name} · {sub.name}
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity onPress={() => setRename({ kind: 'sub', id: sub.id, name: sub.name })} hitSlop={8}>
                    <Text style={styles.iconBtnText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteSub(sub)} hitSlop={8}>
                    <Text style={styles.iconBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.card}>
                <TextInput
                  style={styles.input}
                  placeholder="קישור ליוטיוב או פייסבוק"
                  placeholderTextColor={c.muted}
                  value={videoUrl}
                  onChangeText={setVideoUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <TextInput
                  style={styles.input}
                  placeholder={titleBusy ? 'מביא את שם הסרטון…' : 'שם התרגיל / הסרטון (ביוטיוב מתמלא לבד)'}
                  placeholderTextColor={c.muted}
                  value={videoTitle}
                  onChangeText={setVideoTitle}
                />
                <TouchableOpacity style={styles.darkBtn} onPress={addVideo}>
                  <Text style={styles.whiteBtnText}>שמור קישור</Text>
                </TouchableOpacity>
                <Text style={styles.hintText}>
                  טיפ: ביוטיוב או בפייסבוק לחץ "שיתוף" ובחר באפליקציה הזו. לסידור מחדש החזק את ☰ וגרור.
                </Text>
              </View>
              {(() => {
                const tags = EQUIPMENT.filter((t) => sub.videos.some((v) => v.tags?.includes(t)));
                return tags.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navChips} keyboardShouldPersistTaps="handled">
                    {tags.map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chip, styles.chipSpaced, styles.chipSmall, subFilter === t && styles.chipActive]}
                        onPress={() => setSubFilter(subFilter === t ? null : t)}
                      >
                        <Text style={[styles.chipText, subFilter === t && styles.chipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : null;
              })()}
              {sub.videos.length === 0 ? <Text style={styles.emptyText}>עדיין אין סרטונים כאן.</Text> : null}
            </View>
          }
        />
        {renderPopups()}
      </View>
    );
  }

  // ---------- level 2: sub-groups of a group ----------
  if (group) {
    return (
      <View style={styles.flex1}>
        <DraggableFlatList
          data={group.subs}
          keyExtractor={(s) => s.id}
          renderItem={renderSub}
          onDragEnd={({ data }) => updateGroup(group.id, (g) => ({ ...g, subs: data }))}
          contentContainerStyle={styles.deskContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {navBar()}
              {sharedBanner}
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionTitle}>{group.name}</Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    onPress={() => setRename({ kind: 'group', id: group.id, name: group.name })}
                    hitSlop={8}
                  >
                    <Text style={styles.iconBtnText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteGroup(group)} hitSlop={8}>
                    <Text style={styles.iconBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {addRow('תת-קבוצה חדשה', addSub)}
              {group.subs.length === 0 ? <Text style={styles.emptyText}>אין עדיין תת-קבוצות.</Text> : null}
            </View>
          }
        />
        {renderPopups()}
      </View>
    );
  }

  // ---------- level 1: favorites / equipment filter ----------
  const filterLive = filter === 'fav' ? favCount > 0 : !!filter && usedTags.includes(filter);
  if (filter && filterLive) {
    const list = allVideos.filter(({ v }) => (filter === 'fav' ? v.fav : v.tags?.includes(filter)));
    return (
      <View style={styles.flex1}>
        <ScrollView contentContainerStyle={styles.deskContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>קבוצות שרירים</Text>
          {filterChips()}
          <Text style={styles.label}>
            {filter === 'fav' ? '⭐ מועדפים' : `ציוד: ${filter}`} · {list.length} סרטונים
          </Text>
          {list.map(({ v, where }) => (
            <View key={v.id}>{videoRow(v, null, false, where)}</View>
          ))}
          {list.length === 0 ? <Text style={styles.emptyText}>אין סרטונים.</Text> : null}
        </ScrollView>
        {renderPopups()}
      </View>
    );
  }

  // ---------- level 1: groups ----------
  return (
    <View style={styles.flex1}>
      <DraggableFlatList
        data={groups}
        keyExtractor={(g) => g.id}
        renderItem={renderGroup}
        onDragEnd={({ data }) => persist(data)}
        contentContainerStyle={styles.deskContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={styles.sectionTitle}>קבוצות שרירים</Text>
            {filterChips()}
            {sharedBanner}
            {addRow('קבוצה חדשה', addGroup)}
            <Text style={styles.hintText}>לסידור מחדש: החזק את ☰ וגרור למקום הרצוי.</Text>
          </View>
        }
      />
      {renderPopups()}
    </View>
  );

  function renderPopups() {
    const targetGroup = groups.find((g) => g.id === evGroup);
    return (
      <>
        <PopupShell
          visible={!!rename}
          title={rename?.kind === 'group' ? 'שינוי שם קבוצה' : 'שינוי שם תת-קבוצה'}
          onClose={() => setRename(null)}
          yellow={false}
        >
          {rename ? (
            <>
              <TextInput
                style={styles.input}
                value={rename.name}
                onChangeText={(t) => setRename({ ...rename, name: t })}
                placeholderTextColor={c.muted}
                autoFocus
              />
              <TouchableOpacity style={styles.greenBtnWide} onPress={saveRename}>
                <Text style={styles.whiteBtnText}>שמור</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </PopupShell>

        <PopupShell visible={!!editing} title="עריכת סרטון" onClose={() => setEditing(null)} yellow={false}>
          <TextInput style={styles.input} value={evTitle} onChangeText={setEvTitle} placeholder="שם הסרטון" placeholderTextColor={c.muted} />
          <TextInput
            style={styles.input}
            value={evUrl}
            onChangeText={setEvUrl}
            placeholder="קישור"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TextInput
            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            value={evNote}
            onChangeText={setEvNote}
            placeholder="הערה אישית (משקל, סטים, דגשים...)"
            placeholderTextColor={c.muted}
            multiline
          />
          <TouchableOpacity style={[styles.chip, styles.chipSpaced, { alignSelf: 'flex-start' }, evFav && styles.chipActive]} onPress={() => setEvFav(!evFav)}>
            <Text style={[styles.chipText, evFav && styles.chipTextActive]}>{evFav ? '⭐ במועדפים' : '☆ הוסף למועדפים'}</Text>
          </TouchableOpacity>
          <Text style={styles.label}>ציוד:</Text>
          <View style={styles.chipsWrapRow}>
            {EQUIPMENT.map((t) => {
              const on = evTags.includes(t);
              return (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, styles.chipSpaced, styles.chipSmall, on && styles.chipActive]}
                  onPress={() => setEvTags(on ? evTags.filter((x) => x !== t) : [...evTags, t])}
                >
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.label}>קבוצה:</Text>
          <View style={styles.chipsWrapRow}>
            {groups.map((g) => (
              <TouchableOpacity
                key={g.id}
                style={[styles.chip, styles.chipSpaced, g.id === evGroup && styles.chipActive]}
                onPress={() => {
                  setEvGroup(g.id);
                  setEvSub(g.subs[0]?.id ?? '');
                }}
              >
                <Text style={[styles.chipText, g.id === evGroup && styles.chipTextActive]}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>תת-קבוצה:</Text>
          <View style={styles.chipsWrapRow}>
            {(targetGroup?.subs ?? []).map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.chip, styles.chipSpaced, s.id === evSub && styles.chipActive]}
                onPress={() => setEvSub(s.id)}
              >
                <Text style={[styles.chipText, s.id === evSub && styles.chipTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.greenBtn} onPress={saveVideo}>
              <Text style={styles.whiteBtnText}>שמור</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.blueBtnFlex} onPress={() => editing && openVideo(editing.url)}>
              <Text style={styles.softBtnText}>צפה</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.redBtn} onPress={deleteVideo}>
              <Text style={styles.dangerBtnText}>מחק</Text>
            </TouchableOpacity>
          </View>
        </PopupShell>
      </>
    );
  }
}
