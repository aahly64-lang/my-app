import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { DocEntry, GeoAlarm } from '../modules/geo-alarm';
import { useAppStyles } from './appStyles';
import { useTheme } from './theme';
import { confirm } from './ui';
import { DocFolder, loadDocFolders, saveDocFolders } from './storage';

function iconFor(e: DocEntry): string {
  if (e.isDir) return '📁';
  const m = e.mime;
  if (m.includes('pdf')) return '📕';
  if (m.startsWith('image/')) return '🖼️';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return '📊';
  if (m.includes('word') || m.includes('document') || m.startsWith('text/')) return '📄';
  if (m.includes('zip') || m.includes('compressed')) return '🗜️';
  return '📎';
}

function sizeText(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  dataVersion: number;
}

export default function DocsTab({ dataVersion }: Props) {
  const styles = useAppStyles();
  const c = useTheme();
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [path, setPath] = useState<DocFolder[]>([]); // browsing stack: [root folder, sub, sub...]
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [broken, setBroken] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');

  useEffect(() => {
    loadDocFolders().then(setFolders);
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
    refresh();
  }, [refresh]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter((e) => !e.name.startsWith('.') && (!q || e.name.toLowerCase().includes(q)));
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sortBy === 'date') return b.modified - a.modified;
      return a.name.localeCompare(b.name, 'he');
    });
  }, [entries, search, sortBy]);

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

  const disconnect = (f: DocFolder) => {
    confirm('ניתוק תיקייה', `לנתק את "${f.name}"? הקבצים עצמם לא יימחקו.`, 'נתק', () => {
      GeoAlarm.releaseFolder(f.uri);
      const next = folders.filter((x) => x.uri !== f.uri);
      setFolders(next);
      saveDocFolders(next);
      setPath([]);
    });
  };

  const openEntry = (e: DocEntry) => {
    if (e.isDir) {
      setPath([...path, { uri: e.uri, name: e.name }]);
      return;
    }
    if (!GeoAlarm.openDocument(e.uri, e.mime)) {
      Alert.alert('לא ניתן לפתוח', 'אין בטלפון אפליקציה שפותחת קובץ מהסוג הזה.');
    }
  };

  // ---------- folder list ----------
  if (!current) {
    return (
      <FlatList
        data={folders}
        keyExtractor={(f) => f.uri}
        contentContainerStyle={styles.deskContent}
        ListHeaderComponent={
          <View>
            <Text style={styles.sectionTitle}>מסמכים</Text>
            <Text style={styles.hintText}>
              חבר תיקייה מהטלפון (למשל "מסמכים" או "הורדות"). הטאב מציג את הקבצים שבה כמו שהם עכשיו, בלי להעתיק אותם.
            </Text>
            <TouchableOpacity style={[styles.darkBtn, styles.bigBtn]} onPress={connectFolder}>
              <Text style={styles.whiteBtnTextBig}>+ חבר תיקייה</Text>
            </TouchableOpacity>
            {folders.length === 0 ? <Text style={styles.emptyText}>עדיין לא חוברו תיקיות.</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.listRow} onPress={() => setPath([item])} onLongPress={() => disconnect(item)}>
            <Text style={styles.docIcon}>📂</Text>
            <View style={styles.flex1}>
              <Text style={styles.listRowTitle}>{item.name}</Text>
              <Text style={styles.itemSub}>לחיצה ארוכה לניתוק</Text>
            </View>
            <Text style={styles.chevron}>‹</Text>
          </TouchableOpacity>
        )}
      />
    );
  }

  // ---------- browsing a folder ----------
  return (
    <FlatList
      data={shown}
      keyExtractor={(e) => e.uri}
      contentContainerStyle={styles.deskContent}
      keyboardShouldPersistTaps="handled"
      onRefresh={refresh}
      refreshing={false}
      ListHeaderComponent={
        <View>
          <TouchableOpacity onPress={() => setPath(path.slice(0, -1))} style={styles.backBtn}>
            <Text style={styles.backText}>› {path.length > 1 ? path[path.length - 2].name : 'כל התיקיות'}</Text>
          </TouchableOpacity>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              📂 {current.name}
            </Text>
            {path.length === 1 ? (
              <TouchableOpacity onPress={() => disconnect(current)} hitSlop={8}>
                <Text style={styles.linkText}>נתק</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TextInput
            style={styles.input}
            placeholder="🔍 חיפוש לפי שם"
            placeholderTextColor={c.muted}
            value={search}
            onChangeText={setSearch}
          />
          <View style={styles.chipsWrapRow}>
            {(
              [
                ['name', 'מיון לפי שם'],
                ['date', 'מיון לפי תאריך'],
              ] as ['name' | 'date', string][]
            ).map(([k, label]) => (
              <TouchableOpacity
                key={k}
                style={[styles.chip, styles.chipSpaced, sortBy === k && styles.chipActive]}
                onPress={() => setSortBy(k)}
              >
                <Text style={[styles.chipText, sortBy === k && styles.chipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {loading ? <ActivityIndicator style={styles.spinner} /> : null}
          {broken ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                אין גישה לתיקייה. ייתכן שהיא הוזזה או ששמה שונה. נתק אותה וחבר שוב.
              </Text>
            </View>
          ) : null}
          {!loading && !broken && shown.length === 0 ? <Text style={styles.emptyText}>אין קבצים כאן.</Text> : null}
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.listRow} onPress={() => openEntry(item)}>
          <Text style={styles.docIcon}>{iconFor(item)}</Text>
          <View style={styles.flex1}>
            <Text style={styles.listRowTitle} numberOfLines={2}>
              {item.name}
            </Text>
            {!item.isDir ? (
              <Text style={styles.itemSub}>
                {[sizeText(item.size), item.modified ? new Date(item.modified).toLocaleDateString('he-IL') : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>
          {item.isDir ? (
            <Text style={styles.chevron}>‹</Text>
          ) : (
            <TouchableOpacity onPress={() => GeoAlarm.shareDocument(item.uri, item.mime)} hitSlop={10}>
              <Text style={styles.iconBtnText}>📤</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}
    />
  );
}
