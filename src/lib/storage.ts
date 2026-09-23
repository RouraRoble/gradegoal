/** Tiny, safe localStorage wrapper (never throws; private mode / quota safe). */
const PREFIX = 'gradegoal:';

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
