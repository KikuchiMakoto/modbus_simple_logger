const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const isBrowser = typeof document !== 'undefined';

export const readJsonCookie = <T extends JsonValue>(key: string): T | null => {
  if (!isBrowser) return null;
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${key}=`));
  if (!cookie) return null;
  const value = cookie.split('=')[1];
  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch (err) {
    console.warn('Failed to parse cookie', err);
    return null;
  }
};

export const writeJsonCookie = (key: string, value: JsonValue, maxAgeSeconds = ONE_YEAR_SECONDS) => {
  if (!isBrowser) return;
  const encoded = encodeURIComponent(JSON.stringify(value));
  document.cookie = `${key}=${encoded}; max-age=${maxAgeSeconds}; path=/`;
};
