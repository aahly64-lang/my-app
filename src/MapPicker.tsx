import React, { useMemo, useRef } from 'react';
import { Alert, Modal, SafeAreaView, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { buildMapHtml } from './mapHtml';
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

export default function MapPicker({ visible, initial, fallbackCenter, onClose, onSave }: Props) {
  const webRef = useRef<WebView>(null);

  const html = useMemo(() => {
    const center = initial ?? fallbackCenter ?? DEFAULT_CENTER;
    return buildMapHtml({
      lat: center.lat,
      lon: center.lon,
      radius: Math.max(MIN_RADIUS_M, initial?.radius ?? 250),
      hasPoint: !!initial,
      minRadius: MIN_RADIUS_M,
      maxRadius: MAX_RADIUS_M,
    });
    // Rebuild only when the picker is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sendMyLocation = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('אין הרשאת מיקום', 'אשר הרשאת מיקום כדי להציג את המיקום שלך במפה.');
        return;
      }
      const last = await Location.getLastKnownPositionAsync();
      const pos =
        last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const js = `window.setMyLocation(${pos.coords.latitude}, ${pos.coords.longitude}); true;`;
      webRef.current?.injectJavaScript(js);
      if (last) {
        // Refine with a fresh fix in the background.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((p) =>
            webRef.current?.injectJavaScript(
              `window.setMyLocation(${p.coords.latitude}, ${p.coords.longitude}); true;`
            )
          )
          .catch(() => {});
      }
    } catch {
      Alert.alert('המיקום לא זמין', 'ודא שה-GPS דלוק ונסה שוב.');
    }
  };

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type: string; lat?: number; lon?: number; radius?: number };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'close') onClose();
    else if (msg.type === 'myLocation') sendMyLocation();
    else if (msg.type === 'save' && msg.lat != null && msg.lon != null && msg.radius != null) {
      onSave({ lat: msg.lat, lon: msg.lon, radius: Math.round(msg.radius) });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        {visible ? (
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html, baseUrl: 'https://avi-board.local/' }}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            applicationNameForUserAgent="AviBoardApp/1.0"
            setSupportMultipleWindows={false}
            style={styles.web}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F172A' },
  web: { flex: 1 },
});
