const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const isBrowser = typeof window !== 'undefined';

function getKey(key: string): string {
  return `modbus_logger_${key}`;
}

// Reads the bare-key cookie that writeCookieFallback() below parks values in.
// No migration and no delete: the caller may be a plain read on a machine where
// localStorage still throws, and deleting would destroy the only copy.
function readCookieRaw(key: string): string | null {
  try {
    const entry = document.cookie
      .split('; ')
      .find((candidate) => candidate.startsWith(`${key}=`));
    if (!entry) return null;
    return decodeURIComponent(entry.substring(key.length + 1));
  } catch {
    return null;
  }
}

function parseJson<T extends JsonValue>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('Failed to parse stored value', err);
    return null;
  }
}

export const readJsonStorage = <T extends JsonValue>(key: string): T | null => {
  if (!isBrowser) return null;
  try {
    const raw = localStorage.getItem(getKey(key));
    if (raw !== null) return parseJson<T>(raw);
  } catch (err) {
    console.warn('Failed to read localStorage item', err);
  }
  // The cookie lifeboat. This read used to be missing, which made the fallback
  // write-only: writeRaw() parks a value in a cookie when localStorage throws,
  // but every caller that reads through this function looked only at
  // localStorage — so UI scale, the ScriptRunner code and its backup, the
  // collapsed-section flags and the notification toggle were all lost on reload
  // in exactly the situation the fallback exists for (a browser with site data
  // blocked for the origin, or Safari private mode at its quota).
  const cookie = readCookieRaw(key);
  return cookie === null ? null : parseJson<T>(cookie);
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

// Single chokepoint for every persisted setting.
export const writeJsonStorage = (key: string, value: JsonValue): WriteResult => {
  if (!isBrowser) return 'failed';
  return writeRaw(key, value);
};

// Settings that describe how THIS screen looks — theme, UI scale — rather than
// what the logger is measuring.
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

/**
 * Like readJsonStorage(), plus the one-way migration of a legacy cookie into
 * localStorage. Both functions read cookies now — the difference is only that
 * this one tries to promote and retire the cookie afterwards.
 */
export const readJsonCookie = <T extends JsonValue>(key: string): T | null => {
  if (!isBrowser) return null;

  const value = readJsonStorage<T>(key);
  if (value === null) return null;

  // Nothing to migrate when localStorage already holds it.
  if (readCookieRaw(key) === null) return value;

  // Clear the cookie only once the value is actually in localStorage. The write
  // falls back to this very cookie when localStorage is unavailable — deleting
  // unconditionally, as this used to, threw the setting away in that case.
  if (writeJsonStorage(key, value) === 'storage') {
    document.cookie = `${key}=; max-age=0; path=/`;
  }
  return value;
};

export const writeJsonCookie = (key: string, value: JsonValue): void => {
  writeJsonStorage(key, value);
};
