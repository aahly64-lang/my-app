import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { saveCrash } from './crashLog';
import { NoteColorPicker, NoteEditor, noteBg } from './richNote';
import { ReminderEditor, ReminderValue } from './ui';
import { Palette, useTheme, useThemedStyles } from './theme';

/**
 * Full-screen note editor: header and toolbar stay fixed, only the text scrolls.
 * Color, reminder and the other actions live under "⋯".
 */
export default function NoteScreen({
  visible,
  isNew,
  editorKey,
  title,
  onTitle,
  initialHtml,
  onHtml,
  color,
  onColor,
  reminder,
  onReminder,
  onSave,
  onClose,
  onShare,
  extra,
}: {
  visible: boolean;
  isNew: boolean;
  editorKey: string;
  title: string;
  onTitle: (t: string) => void;
  initialHtml: string;
  onHtml: (h: string) => void;
  color: string;
  onColor: (k: string) => void;
  reminder: ReminderValue;
  onReminder: (r: ReminderValue) => void;
  onSave: () => void;
  onClose: () => void;
  onShare?: () => void;
  extra?: React.ReactNode; // buttons for an existing note (done / to task / delete)
}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [options, setOptions] = useState(false);

  useEffect(() => {
    if (!visible) setOptions(false);
  }, [visible]);

  const bg = noteBg(color, c) ?? c.bg;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (options ? setOptions(false) : onClose())}>
      <View style={[styles.root, { backgroundColor: bg }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.iconText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headTitle}>{isNew ? 'פתק חדש' : 'פתק'}</Text>
          {onShare ? (
            <TouchableOpacity onPress={onShare} hitSlop={8} style={styles.iconBtn}>
              <Feather name="share-2" size={18} color={c.text} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.iconBtn, options && styles.moreBtnOn]}
            hitSlop={8}
            onPress={() => {
              Keyboard.dismiss();
              setOptions(!options);
            }}
          >
            <Text style={[styles.iconText, options && { color: c.onAccent }]}>⋯</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSave} hitSlop={8} style={styles.saveBtn}>
            <Text style={styles.saveText}>✓ שמור</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={onTitle}
          placeholder="כותרת"
          placeholderTextColor={c.muted}
        />

        {options ? (
          <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>צבע הפתק</Text>
            <NoteColorPicker value={color} onChange={onColor} />
            <ReminderEditor value={reminder} onChange={onReminder} />
            {extra}
          </ScrollView>
        ) : null}

        <View style={styles.flex1}>
          {visible ? (
            <EditorGuard onClose={onClose}>
            <NoteEditor
              key={editorKey}
              fill
              initialHtml={initialHtml}
              onChange={onHtml}
            />
            </EditorGuard>
          ) : null}
        </View>

      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => ({
  root: { flex: 1 },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  headTitle: { flex: 1, fontSize: 18, fontWeight: '800' as const, color: c.noteText },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.subtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconText: { fontSize: 16, fontWeight: '700' as const, color: c.text },
  saveBtn: { backgroundColor: c.accent, borderRadius: 18, paddingHorizontal: 16, height: 36, justifyContent: 'center' as const },
  saveText: { color: c.onAccent, fontWeight: '800' as const, fontSize: 15 },
  titleInput: {
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: c.noteInput,
    color: c.noteText,
    fontSize: 17,
    fontWeight: '700' as const,
    textAlign: 'right' as const,
  },
  moreBtn: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  moreBtnOn: { backgroundColor: c.accent },
  moreText: { fontSize: 22, fontWeight: '900' as const, color: c.text },
  sheet: { maxHeight: '50%' as const, backgroundColor: c.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  sheetContent: { padding: 14, paddingBottom: 24 },
  label: { fontSize: 13, fontWeight: '700' as const, color: c.muted, marginBottom: 2 },
});

/** A JavaScript error inside the editor shows a message instead of closing the whole app. */
class EditorGuard extends React.Component<{ onClose: () => void; children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: String(e?.message ?? e) };
  }
  componentDidCatch(e: Error) {
    saveCrash('note-editor', e);
  }
  render() {
    if (this.state.error)
      return (
        <View style={{ padding: 20 }}>
          <Text style={{ fontSize: 16, marginBottom: 8 }}>העורך נתקל בשגיאה:</Text>
          <Text selectable style={{ fontSize: 13, color: '#D70015' }}>
            {this.state.error}
          </Text>
          <TouchableOpacity onPress={this.props.onClose} style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>סגור</Text>
          </TouchableOpacity>
        </View>
      );
    return this.props.children;
  }
}
