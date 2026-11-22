import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

const KEY = '@avi_last_crash_v1';

export function saveCrash(where: string, e: unknown) {
  const err = e as Error;
  const text = `${where}: ${String(err?.message ?? e)}\n${String(err?.stack ?? '').split('\n').slice(0, 6).join('\n')}`;
  return AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), text })).catch(() => {});
}

/** Records fatal JS errors before the app closes, so the next launch can show what happened. */
export function installCrashLog() {
  const g = global as any;
  const prev = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((e: Error, isFatal?: boolean) => {
    saveCrash(isFatal ? 'fatal' : 'error', e).finally(() => prev?.(e, isFatal));
  });
}

export async function showLastCrash() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(KEY);
    const { text } = JSON.parse(raw);
    Alert.alert('האפליקציה נסגרה בפעם הקודמת', `צלם את המסך הזה ושלח ל-Claude:\n\n${text}`);
  } catch {
    // ignore
  }
}
