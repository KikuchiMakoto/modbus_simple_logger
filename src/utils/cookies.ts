import { isViewerMode } from './appMode';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const isBrowser = typeof window !== 'undefined';

function getKey(key: string): string {
  return `modbus_logger_${key}`;
}

export const readJsonStorage = <T extends JsonValue>(key: string): T | null => {
  if (!isBrowser) return null;
  try {
    const raw = localStorage.getItem(getKey(key));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('Failed to parse localStorage item', err);
    return null;
  }
};

// Where a write actually landed. The read path needs this: it may only delete a
// legacy cookie once the value is safely somewhere else.
type WriteResult = 'storage' | 'cookie' | 'failed';

// A cookie carrying more than this is not worth writing: cookies go out on
// every request to the launcher's own HTTP server, and browsers cap them at
// ~4 KB anyway (a silently truncated setting is worse than an unsaved one).
const COOKIE_FALLBACK_MAX_BYTES = 3500;

// Written under the bare key — the same name the migration reader below looks
// for, so a value parked here is picked up again as soon as localStorage works.
function writeCookieFallback(key: string, serialized: string): boolean {
  const encoded = encodeURIComponent(serialized);
  if (encoded.length > COOKIE_FALLBACK_MAX_BYTES) return false;
  try {
    document.cookie = `${key}=${encoded}; max-age=${ONE_YEAR_SECONDS}; path=/; SameSite=Lax`;
    // Read back: with site data blocked the assignment above is silently
    // ignored, and the caller has to know the value went nowhere.
    return document.cookie.split('; ').some((entry) => entry.startsWith(`${key}=`));
  } catch {
    return false;
  }
}

// localStorage is the store; the cookie is only a lifeboat for the case where
// it throws — Safari private mode at its quota, or a browser configured to
// block site data for the origin. Not a mirror: writing both every time would
// put the calibration blob on the wire with every asset request.
function writeRaw(key: string, value: JsonValue): WriteResult {
  const serialized = JSON.stringify(value);
  try {
    localStorage.setItem(getKey(key), serialized);
    return 'storage';
  } catch (err) {
    console.warn('Failed to write localStorage item, falling back to a cookie', err);
  }
  return writeCookieFallback(key, serialized) ? 'cookie' : 'failed';
}

// Single chokepoint for every persisted setting, which is why the viewer guard
// lives at this level rather than being repeated at each call site: a remote
// monitor is fed the host's labels, calibration and voltage modes about once a
// second, and letting those land in the viewer PC's localStorage would silently
// overwrite that machine's own logger settings with someone else's.
export const writeJsonStorage = (key: string, value: JsonValue): WriteResult => {
  if (!isBrowser || isViewerMode) return 'failed';
  return writeRaw(key, value);
};

// Settings that describe how THIS screen looks — theme, UI scale — rather than
// what the logger is measuring. Nothing in the host feed writes them, so the
// viewer guard above does not apply: a remote monitor on a 4K panel has to be
// able to keep its own zoom and its own light/dark choice across reloads, which
// the guard would otherwise silently discard.
export const writeLocalPreference = (key: string, value: JsonValue): WriteResult => {
  if (!isBrowser) return 'failed';
  return writeRaw(key, value);
};

export const removeJsonStorage = (key: string): void => {
  if (!isBrowser) return;
  try {
    localStorage.removeItem(getKey(key));
  } catch (err) {
    console.warn('Failed to remove localStorage item', err);
  }
};

// Backwards-compatible migration: read from cookie if storage is empty
export const readJsonCookie = <T extends JsonValue>(key: string): T | null => {
  if (!isBrowser) return null;

  // Try localStorage first
  const storageValue = readJsonStorage<T>(key);
  if (storageValue !== null) return storageValue;

  // Fallback to cookie for migration
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${key}=`));
  if (!cookie) return null;
  const value = cookie.substring(key.length + 1);
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as T;
    // Clear the cookie only once the value is actually in localStorage. The
    // write is a no-op in viewer mode and falls back to this very cookie when
    // localStorage is unavailable — deleting unconditionally, as this used to,
    // threw the setting away in both cases.
    if (writeJsonStorage(key, parsed) === 'storage') {
      document.cookie = `${key}=; max-age=0; path=/`;
    }
    return parsed;
  } catch (err) {
    console.warn('Failed to parse cookie', err);
    return null;
  }
};

export const writeJsonCookie = (key: string, value: JsonValue): void => {
  writeJsonStorage(key, value);
};
