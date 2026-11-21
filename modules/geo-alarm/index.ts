import { requireOptionalNativeModule } from 'expo';

type SharedTextEvent = { text: string };

type GeoAlarmNative = {
  triggerAlarm(title: string, body: string): void;
  stopAlarm(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  openAutoStartSettings(): boolean;
  openAppSettings(): void;
  getInitialSharedText(): string | null;
  addListener(event: 'onSharedText', cb: (e: SharedTextEvent) => void): { remove(): void };
};

const native = requireOptionalNativeModule<GeoAlarmNative>('GeoAlarm');

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return native ? fn() : fallback;
  } catch {
    return fallback;
  }
}

export const GeoAlarm = {
  available: !!native,
  triggerAlarm: (title: string, body: string) => safe(() => native!.triggerAlarm(title, body), undefined),
  stopAlarm: () => safe(() => native!.stopAlarm(), undefined),
  canUseFullScreenIntent: () => safe(() => native!.canUseFullScreenIntent(), false),
  openFullScreenIntentSettings: () => safe(() => native!.openFullScreenIntentSettings(), undefined),
  isIgnoringBatteryOptimizations: () => safe(() => native!.isIgnoringBatteryOptimizations(), false),
  requestIgnoreBatteryOptimizations: () => safe(() => native!.requestIgnoreBatteryOptimizations(), undefined),
  openAutoStartSettings: () => safe(() => native!.openAutoStartSettings(), false),
  openAppSettings: () => safe(() => native!.openAppSettings(), undefined),
  getInitialSharedText: () => safe(() => native!.getInitialSharedText(), null),
  addSharedTextListener: (cb: (text: string) => void) =>
    safe(() => native!.addListener('onSharedText', (e) => cb(e.text)), { remove() {} }),
};
