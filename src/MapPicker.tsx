import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useScreenFrame } from './ui';
import MapView, { Circle, MapType, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { MAX_RADIUS_M, MIN_RADIUS_M } from './geoTask';

export interface MapSelection {
  lat: number;
  lon: number;
  radius: number;
}

interface Props {
  visible: boolean;
  initial?: MapSelection | null;
  fallbackCenter?: { lat: number; lon: number } | null;
  onClose: () => void;
  onSave: (sel: MapSelection) => void;
}

// Center of Israel, used when there is no point and no known location yet.
const DEFAULT_CENTER = { lat: 31.95, lon: 34.8 };

export const MAP_TYPES: { key: MapType; label: string }[] = [
  { key: 'standard', label: '🗺️ רגילה' },
  { key: 'satellite', label: '🛰️ לוויין' },
  { key: 'hybrid', label: '🛰️ היברידית' },
];

const step = (r: number) => (r < 500 ? 50 : r < 1000 ? 100 : 250);
const fmt = (r: number) => (r >= 1000 ? `${Math.round(r / 10) / 100} ק"מ` : `${r} מטר`);
// Rough zoom so the whole circle fits.
const deltaFor = (radius: number) => Math.max(0.004, (radius * 2.6) / 111000);

interface Result {
  lat: number;
  lon: number;
  name: string;
}

/** Address search with the phone's own geocoder (free - no Places API). */
export async function searchAddress(q: string): Promise<Result[]> {
  const found = await Location.geocodeAsync(q);
  const out: Result[] = [];
  for (const g of found.slice(0, 6)) {
    let name = q;
    try {
      const [a] = await Location.reverseGeocodeAsync({ latitude: g.latitude, longitude: g.longitude });
      if (a) name = [a.name, a.street && a.street !== a.name ? a.street : null, a.city].filter(Boolean).join(', ') || q;
    } catch {
      // keep the query as the name
    }
    out.push({ lat: g.latitude, lon: g.longitude, name });
  }
  return out;
}

export default function MapPicker({ visible, initial, fallbackCenter, onClose, onSave }: Props) {
  const frame = useScreenFrame();
  const mapRef = useRef<MapView>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(250);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [hasLocPerm, setHasLocPerm] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);

  const start = initial ?? fallbackCenter ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!visible) return;
    setCenter(initial ? { lat: initial.lat, lon: initial.lon } : null);
    setRadius(Math.max(MIN_RADIUS_M, initial?.radius ?? 250));
    setQuery('');
    setResults(null);
    Location.getForegroundPermissionsAsync()
      .then((p) => setHasLocPerm(p.granted))
      .catch(() => {});
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const fly = (lat: number, lon: number, r = radius) =>
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lon, latitudeDelta: deltaFor(r), longitudeDelta: deltaFor(r) },
      400
    );

  const myLocation = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('אין הרשאת מיקום', 'אשר הרשאת מיקום כדי להציג את המיקום שלך במפה.');
        return;
      }
      setHasLocPerm(true);
      const last = await Location.getLastKnownPositionAsync();
      const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      fly(pos.coords.latitude, pos.coords.longitude, 300);
    } catch {
      Alert.alert('המיקום לא זמין', 'ודא שה-GPS דלוק ונסה שוב.');
    }
  };

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    setResults([]);
    try {
      setResults(await searchAddress(q));
    } catch {
      Alert.alert('חיפוש', 'החיפוש לא הצליח. בדוק חיבור לאינטרנט.');
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const pick = (lat: number, lon: number, zoom: boolean) => {
    setCenter({ lat, lon });
    setResults(null);
    if (zoom) fly(lat, lon);
  };

  const nextType = () => {
    const i = MAP_TYPES.findIndex((t) => t.key === mapType);
    setMapType(MAP_TYPES[(i + 1) % MAP_TYPES.length].key);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, frame.root]}>
        {visible ? (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            mapType={mapType}
            showsUserLocation={hasLocPerm}
            showsMyLocationButton={false}
            toolbarEnabled={false}
            initialRegion={{
              latitude: start.lat,
              longitude: start.lon,
              latitudeDelta: initial ? deltaFor(initial.radius) : 0.08,
              longitudeDelta: initial ? deltaFor(initial.radius) : 0.08,
            }}
            onPress={(e) => pick(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude, false)}
          >
            {center ? (
              <>
                <Circle
                  center={{ latitude: center.lat, longitude: center.lon }}
                  radius={radius}
                  strokeColor="#CA8A04"
                  strokeWidth={3}
                  fillColor="rgba(250,204,21,0.3)"
                />
                <Marker
                  coordinate={{ latitude: center.lat, longitude: center.lon }}
                  draggable
                  onDragEnd={(e) => pick(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude, false)}
                  pinColor="red"
                />
              </>
            ) : null}
          </MapView>
        ) : null}

        <View style={styles.top}>
          <TextInput
            style={styles.search}
            placeholder="חיפוש כתובת או מקום..."
            placeholderTextColor="#64748B"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={doSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.topBtn} onPress={doSearch}>
            <Text style={styles.topBtnText}>🔍</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={onClose}>
            <Text style={styles.topBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {results ? (
          <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
            {searching ? <ActivityIndicator style={{ margin: 14 }} /> : null}
            {!searching && results.length === 0 ? <Text style={styles.res}>לא נמצאו תוצאות</Text> : null}
            {results.map((r, i) => (
              <TouchableOpacity key={i} onPress={() => pick(r.lat, r.lon, true)}>
                <Text style={styles.res}>📍 {r.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : !center ? (
          <View style={styles.hint}>
            <Text style={styles.hintText}>לחץ על המפה כדי לבחור את מרכז האזור</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.layerBtn} onPress={nextType}>
          <Text style={styles.layerText}>{MAP_TYPES.find((t) => t.key === mapType)?.label}</Text>
        </TouchableOpacity>

        <View style={styles.bottom}>
          <View style={styles.radiusRow}>
            <TouchableOpacity
              style={styles.round}
              onPress={() => {
                const r = Math.min(MAX_RADIUS_M, radius + step(radius));
                setRadius(r);
                if (center) fly(center.lat, center.lon, r);
              }}
            >
              <Text style={styles.roundText}>+</Text>
            </TouchableOpacity>
            <Text style={styles.radiusLabel}>רדיוס: {fmt(radius)}</Text>
            <TouchableOpacity style={styles.round} onPress={() => setRadius(Math.max(MIN_RADIUS_M, radius - step(radius - 1)))}>
              <Text style={styles.roundText}>−</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.small}>אפשר לגרור את הסיכה האדומה כדי לדייק.</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.myloc]} onPress={myLocation}>
              <Text style={styles.mylocText}>📍 המיקום שלי</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.save, !center && styles.saveOff]}
              disabled={!center}
              onPress={() => center && onSave({ lat: center.lat, lon: center.lon, radius: Math.round(radius) })}
            >
              <Text style={styles.saveText}>שמור אזור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const shadow = { elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E5E7EB' },
  top: { position: 'absolute', top: 12, left: 10, right: 10, flexDirection: 'row', gap: 8 },
  search: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0F172A',
    textAlign: 'right',
    ...shadow,
  },
  topBtn: { width: 46, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow },
  topBtnText: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  results: { position: 'absolute', top: 66, left: 10, right: 10, maxHeight: '45%', backgroundColor: '#fff', borderRadius: 12, ...shadow },
  res: { padding: 13, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', fontSize: 15, color: '#0F172A', textAlign: 'right' },
  hint: { position: 'absolute', top: 66, left: 10, right: 10, backgroundColor: 'rgba(15,23,42,0.85)', borderRadius: 12, padding: 10 },
  hintText: { color: '#fff', textAlign: 'center', fontSize: 15 },
  layerBtn: { position: 'absolute', top: 120, left: 10, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, ...shadow },
  layerText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  bottom: { position: 'absolute', bottom: 14, left: 10, right: 10, backgroundColor: '#fff', borderRadius: 16, padding: 12, ...shadow },
  radiusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  round: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  roundText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  radiusLabel: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#0F172A' },
  small: { textAlign: 'center', color: '#64748B', fontSize: 12.5, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  myloc: { flex: 1, backgroundColor: '#E2E8F0' },
  mylocText: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  save: { flex: 2, backgroundColor: '#15803D' },
  saveOff: { backgroundColor: '#94A3B8' },
  saveText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
