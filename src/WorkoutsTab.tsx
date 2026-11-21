import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
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

  // A link shared from YouTube/Facebook fills the add form once a sub-group is open.
  useEffect(() => {
    if (shared && sub) {
      setVideoUrl(shared.url);
      setVideoTitle(shared.title);
      onSharedUsed();
    }
  }, [shared, sub, onSharedUsed]);

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

  const addVideo = () => {
    if (!group || !sub) return;
    const url = (extractUrl(videoUrl) ?? videoUrl).trim();
    if (!url) {
      Alert.alert('חסר קישור', 'הדבק קישור לסרטון.');
      return;
    }
    const item: WorkoutLink = { id: newId(), title: videoTitle.trim() || 'סרטון כושר', url, platform: detectPlatform(url) };
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
  const openEdit = (v: WorkoutLink) => {
    setEditing(v);
    setEvTitle(v.title);
    setEvUrl(v.url);
    setEvGroup(groupId ?? '');
    setEvSub(subId ?? '');
  };

  const saveVideo = () => {
    if (!editing) return;
    const url = evUrl.trim();
    if (!url) {
      Alert.alert('חסר קישור', 'הדבק קישור לסרטון.');
      return;
    }
    const updated: WorkoutLink = { ...editing, title: evTitle.trim() || 'סרטון כושר', url, platform: detectPlatform(url) };
    const moved = evGroup !== groupId || evSub !== subId;
    persist(
      groups.map((g) => ({
        ...g,
        subs: g.subs.map((s) => {
          let videos = s.videos;
          if (moved) videos = videos.filter((v) => v.id !== updated.id);
          if (!moved && s.id === subId) videos = videos.map((v) => (v.id === updated.id ? updated : v));
          if (moved && g.id === evGroup && s.id === evSub) videos = [...videos, updated];
          return { ...s, videos };
        }),
      }))
    );
    setEditing(null);
  };

  const deleteVideo = () => {
    if (!editing || !group || !sub) return;
    const v = editing;
    confirm('מחיקת סרטון', `למחוק את "${v.title}"?`, 'מחק', () => {
      updateSub(group.id, sub.id, (s) => ({ ...s, videos: s.videos.filter((x) => x.id !== v.id) }));
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

  const renderVideo = ({ item, drag, isActive }: RenderItemParams<WorkoutLink>) => {
    const yt = item.platform === 'youtube' ? youtubeId(item.url) : null;
    return (
      <ScaleDecorator>
        <View style={[styles.listRow, isActive && styles.listRowActive]}>
          <Handle drag={drag} />
          <TouchableOpacity style={styles.videoMain} onPress={() => openVideo(item.url)} onLongPress={drag}>
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
              <Text style={styles.itemSub}>
                {item.platform === 'youtube' ? 'YouTube' : item.platform === 'facebook' ? 'Facebook' : 'קישור'} · לחץ לצפייה
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(item)} hitSlop={8}>
            <Text style={styles.iconBtnText}>✏️</Text>
          </TouchableOpacity>
        </View>
      </ScaleDecorator>
    );
  };

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
          data={sub.videos}
          keyExtractor={(v) => v.id}
          renderItem={renderVideo}
          onDragEnd={({ data }) => updateSub(group.id, sub.id, (s) => ({ ...s, videos: data }))}
          contentContainerStyle={styles.deskContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <TouchableOpacity onPress={() => setSubId(null)} style={styles.backBtn}>
                <Text style={styles.backText}>› {group.name}</Text>
              </TouchableOpacity>
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
                  placeholder="שם התרגיל / הסרטון"
                  placeholderTextColor={c.muted}
                  value={videoTitle}
                  onChangeText={setVideoTitle}
                />
                <TextInput
                  style={styles.input}
                  placeholder="קישור ליוטיוב או פייסבוק"
                  placeholderTextColor={c.muted}
                  value={videoUrl}
                  onChangeText={setVideoUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <TouchableOpacity style={styles.darkBtn} onPress={addVideo}>
                  <Text style={styles.whiteBtnText}>שמור קישור</Text>
                </TouchableOpacity>
                <Text style={styles.hintText}>
                  טיפ: ביוטיוב או בפייסבוק לחץ "שיתוף" ובחר באפליקציה הזו. לסידור מחדש החזק את ☰ וגרור.
                </Text>
              </View>
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
              <TouchableOpacity
                onPress={() => {
                  setGroupId(null);
                  setNewName('');
                }}
                style={styles.backBtn}
              >
                <Text style={styles.backText}>› כל הקבוצות</Text>
              </TouchableOpacity>
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
              <Text style={styles.whiteBtnText}>צפה</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.redBtn} onPress={deleteVideo}>
              <Text style={styles.whiteBtnText}>מחק</Text>
            </TouchableOpacity>
          </View>
        </PopupShell>
      </>
    );
  }
}
