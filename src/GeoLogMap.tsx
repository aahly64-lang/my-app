import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useScreenFrame } from './ui';
import MapView, { Circle, MapType, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { AlarmArea, GeoLogEntry } from './storage';
import { MAP_TYPES } from './MapPicker';

const COLORS: Record<GeoLogEntry['kind'], string> = {
  enter: 'green',
  exit: 'orange',
  start: 'azure',
  problem: 'red',
};

/** The location log on a map: every entry where the phone was, plus the alarm areas. */
export default function GeoLogMap({
  visible,
  entries,
  areas,
  onClose,
}: {
  visible: boolean;
  entries: GeoLogEntry[];
  areas: AlarmArea[];
  onClose: () => void;
}) {
  const frame = useScreenFrame();
  const [mapType, setMapType] = useState<MapType>('standard');
  const pts = entries.filter((e) => e.lat != null && e.lon != null);
  const all = [
    ...pts.map((e) => ({ lat: e.lat!, lon: e.lon! })),
    ...areas.map((a) => ({ lat: a.latitude, lon: a.longitude })),
  ];
  const lat = all.length ? all.reduce((s, p) => s + p.lat, 0) / all.length : 31.95;
  const lon = all.length ? all.reduce((s, p) => s + p.lon, 0) / all.length : 34.8;
  const span = all.length
    ? Math.max(0.02, ...all.map((p) => Math.abs(p.lat - lat) * 2.4), ...all.map((p) => Math.abs(p.lon - lon) * 2.4))
    : 0.5;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[{ flex: 1 }, frame.root]}>
        {visible ? (
          <MapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            mapType={mapType}
            toolbarEnabled={false}
            initialRegion={{ latitude: lat, longitude: lon, latitudeDelta: span, longitudeDelta: span }}
          >
            {areas.map((a) => (
              <Circle
                key={a.id}
                center={{ latitude: a.latitude, longitude: a.longitude }}
                radius={a.radiusMeters}
                strokeColor="#CA8A04"
                strokeWidth={2}
                fillColor="rgba(250,204,21,0.2)"
              />
            ))}
            {pts.map((e, i) => {
              const d = new Date(e.at);
              const when = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              return (
                <Marker
                  key={i}
                  coordinate={{ latitude: e.lat!, longitude: e.lon! }}
                  pinColor={e.ok === false ? 'red' : COLORS[e.kind]}
                  title={`${when} · ${e.label}`}
                  description={e.text}
                />
              );
            })}
          </MapView>
        ) : null}
        <View style={styles.top}>
          <Text style={styles.title}>🗺️ יומן מיקום על המפה</Text>
          <TouchableOpacity style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.layer}
          onPress={() => setMapType(MAP_TYPES[(MAP_TYPES.findIndex((t) => t.key === mapType) + 1) % MAP_TYPES.length].key)}
        >
          <Text style={styles.layerText}>{MAP_TYPES.find((t) => t.key === mapType)?.label}</Text>
        </TouchableOpacity>
        <View style={styles.legend}>
          <Text style={styles.legendText}>
            {pts.length
              ? '🟢 כניסה  🟠 יציאה  🔵 מעקב  🔴 לא צלצל/בעיה · לחיצה על סיכה מציגה שעה'
              : 'עדיין אין אירועים עם מיקום. מעכשיו כל אירוע חדש יישמר עם המיקום.'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const shadow = { elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } };
const styles = StyleSheet.create({
  top: { position: 'absolute', top: 12, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 11, fontSize: 16, fontWeight: '800', color: '#0F172A', textAlign: 'right', ...shadow },
  btn: { width: 46, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow },
  btnText: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  layer: { position: 'absolute', top: 68, left: 10, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, ...shadow },
  layerText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  legend: { position: 'absolute', bottom: 16, left: 10, right: 10, backgroundColor: '#fff', borderRadius: 12, padding: 10, ...shadow },
  legendText: { fontSize: 13, color: '#0F172A', textAlign: 'center' },
});
