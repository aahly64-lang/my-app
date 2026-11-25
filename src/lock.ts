import { Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { loadDocMeta } from './storage';

/**
 * Fingerprint / face / screen-lock check for locked notes, documents and journals.
 * After a successful check everything stays open for UNLOCK_MS, or until the app
 * goes to the background (App calls relock()).
 */
const UNLOCK_MS = 2 * 60 * 1000;
let unlockedUntil = 0;

export function relock() {
  unlockedUntil = 0;
}

/** True when the phone has a fingerprint, PIN, pattern or password set. */
export async function canLock(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      Alert.alert('אין נעילת מסך', 'כדי לנעול צריך להגדיר בטלפון טביעת אצבע, קוד או תבנית.');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Asks for the fingerprint (or the phone's PIN). Resolves true when the user passed. */
export async function authenticate(prompt: string): Promise<boolean> {
  if (!(await canLock())) return false;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: 'ביטול',
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}

/** Like authenticate(), but skips the prompt if unlocked in the last two minutes. */
export async function ensureUnlocked(prompt = 'פתיחת פריט נעול'): Promise<boolean> {
  if (Date.now() < unlockedUntil) return true;
  const ok = await authenticate(prompt);
  if (ok) unlockedUntil = Date.now() + UNLOCK_MS;
  return ok;
}

/** For places outside the documents tab (attached-file chips). */
export async function isDocLocked(uri: string): Promise<boolean> {
  try {
    return !!(await loadDocMeta())[uri]?.locked;
  } catch {
    return false;
  }
}
