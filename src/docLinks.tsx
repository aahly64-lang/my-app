import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { GeoAlarm } from '../modules/geo-alarm';
import { Palette, useThemedStyles } from './theme';
import { DocLink } from './storage';

export function docIcon(mime: string, isDir = false): string {
  if (isDir) return '📁';
  const m = mime || '';
  if (m.includes('pdf')) return '📕';
  if (m.startsWith('image/')) return '🖼️';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return '📊';
  if (m.includes('presentation') || m.includes('powerpoint')) return '📽️';
  if (m.includes('word') || m.includes('document') || m.startsWith('text/')) return '📄';
  if (m.includes('zip') || m.includes('compressed')) return '🗜️';
  return '📎';
}

export function openDoc(d: DocLink) {
  if (!GeoAlarm.openDocument(d.uri, d.mime)) {
    Alert.alert('לא ניתן לפתוח', 'הקובץ לא נמצא (אולי הוזז או נמחק), או שאין אפליקציה שפותחת אותו.');
  }
}

/** Small "📎 file" chips for documents attached to a task or a note. Long press removes. */
export function DocChips({ docs, onRemove }: { docs?: DocLink[]; onRemove?: (d: DocLink) => void }) {
  const styles = useThemedStyles(makeStyles);
  if (!docs || docs.length === 0) return null;
  return (
    <View style={styles.row}>
      {docs.map((d) => (
        <TouchableOpacity
          key={d.uri}
          style={styles.chip}
          onPress={() => openDoc(d)}
          onLongPress={
            onRemove
              ? () =>
                  Alert.alert('מסמך מצורף', `להסיר את "${d.name}" מהרשימה? הקובץ עצמו לא יימחק.`, [
                    { text: 'ביטול', style: 'cancel' },
                    { text: 'הסר', style: 'destructive', onPress: () => onRemove(d) },
                  ])
              : undefined
          }
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {docIcon(d.mime)} {d.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
  chip: {
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: c.subtle,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipText: { fontSize: 12.5, color: c.text, fontWeight: '600' as const },
});
