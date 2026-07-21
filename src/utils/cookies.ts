const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const isBrowser = typeof window !== 'undefined';

function getKey(key: string): string {
  return `modbus_calibrator_${key}`;
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

export const writeJsonStorage = (key: string, value: JsonValue): void => {
  if (!isBrowser) return;
  try {
    localStorage.setItem(getKey(key), JSON.stringify(value));
  } catch (err) {
    console.warn('Failed to write localStorage item', err);
  }
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
    // Migrate to localStorage
    writeJsonStorage(key, parsed);
    // Clear cookie
    document.cookie = `${key}=; max-age=0; path=/`;
    return parsed;
  } catch (err) {
    console.warn('Failed to parse cookie', err);
    return null;
  }
};

export const writeJsonCookie = (key: string, value: JsonValue): void => {
  writeJsonStorage(key, value);
};
