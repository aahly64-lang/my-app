import React from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAppStyles } from './appStyles';
import { DAY_LETTERS, displayYMD, hhmm, parseHHMM, pickDate, pickTimeWheels } from './pickers';
import { localDateString } from './storage';

export function confirm(title: string, message: string, confirmText: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'ביטול', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}

export function PopupShell({
  visible,
  title,
  onClose,
  children,
  yellow = true,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  yellow?: boolean;
  actions?: React.ReactNode; // extra buttons in the header, before the ✕
}) {
  const styles = useAppStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.popup, yellow ? styles.popupYellow : styles.popupWhite]}>
          <View style={styles.popupHeader}>
            <Text style={[styles.popupTitle, !yellow && styles.popupTitlePlain, { flex: 1 }]} numberOfLines={1}>
              {title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {actions}
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Text style={[styles.closeX, !yellow && styles.popupTitlePlain]}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export type ReminderMode = 'ring' | 'silent';

export interface ReminderValue {
  enabled: boolean;
  type: 'once' | 'repeat';
  date: string; // once: YYYY-MM-DD
  time: string; // HH:MM
  days: number[]; // repeat
  endDate: string; // repeat: YYYY-MM-DD
  mode: ReminderMode;
}

export function emptyReminder(): ReminderValue {
  const end = new Date();
  end.setMonth(end.getMonth() + 1);
  return {
    enabled: false,
    type: 'once',
    date: localDateString(),
    time: '09:00',
    days: [],
    endDate: localDateString(end),
    mode: 'ring',
  };
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  const styles = useAppStyles();
  return (
    <View style={styles.row}>
      {options.map(([v, label]) => (
        <TouchableOpacity key={v} style={[styles.segment, value === v && styles.segmentOn]} onPress={() => onChange(v)}>
          <Text style={[styles.segmentText, value === v && styles.segmentTextOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** "⏰ הוסף תזכורת" button that expands into once / repeating reminder settings. */
export function ReminderEditor({
  value,
  onChange,
  allowRepeat = true,
}: {
  value: ReminderValue;
  onChange: (v: ReminderValue) => void;
  allowRepeat?: boolean;
}) {
  const styles = useAppStyles();
  const set = (patch: Partial<ReminderValue>) => onChange({ ...value, ...patch });
  const [h, m] = parseHHMM(value.time);

  if (!value.enabled) {
    return (
      <TouchableOpacity style={styles.addReminderBtn} onPress={() => set({ enabled: true })}>
        <Text style={styles.addReminderText}>⏰ הוסף תזכורת</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.advancedBox}>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>⏰ תזכורת</Text>
        <TouchableOpacity onPress={() => set({ enabled: false })} hitSlop={8}>
          <Text style={styles.removeReminderText}>הסר תזכורת</Text>
        </TouchableOpacity>
      </View>

      {allowRepeat ? (
        <Segment
          options={[
            ['once', 'פעם אחת'],
            ['repeat', 'חוזרת'],
          ]}
          value={value.type}
          onChange={(t) => set({ type: t })}
        />
      ) : null}

      {value.type === 'once' || !allowRepeat ? (
        <View style={styles.row}>
          <TouchableOpacity style={[styles.pickerBtn, styles.flex1]} onPress={() => pickDate(value.date, (d) => set({ date: d }))}>
            <Text style={styles.pickerBtnText}>📅 {displayYMD(value.date)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pickerBtn, styles.flex1]}
            onPress={() => pickTimeWheels(h, m, (hh, mm) => set({ time: hhmm(hh, mm) }))}
          >
            <Text style={styles.pickerBtnText}>🕘 {value.time}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.reminderLabel}>בימים:</Text>
          <View style={styles.daysRow}>
            {DAY_LETTERS.map((letter, d) => {
              const on = value.days.includes(d);
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                  onPress={() =>
                    set({ days: on ? value.days.filter((x) => x !== d) : [...value.days, d].sort() })
                  }
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{letter}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.pickerBtn, styles.flex1]}
              onPress={() => pickTimeWheels(h, m, (hh, mm) => set({ time: hhmm(hh, mm) }))}
            >
              <Text style={styles.pickerBtnText}>🕘 {value.time}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickerBtn, styles.flex1]}
              onPress={() => pickDate(value.endDate, (d) => set({ endDate: d }))}
            >
              <Text style={styles.pickerBtnText}>עד {displayYMD(value.endDate)}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Segment
        options={[
          ['ring', '🔔 צלצול'],
          ['silent', '🔕 התראה שקטה'],
        ]}
        value={value.mode}
        onChange={(md) => set({ mode: md })}
      />
    </View>
  );
}
