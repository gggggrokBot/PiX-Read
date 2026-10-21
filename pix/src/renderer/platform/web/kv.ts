/** Tiny JSON persistence for the web/Android host (localStorage). */

const PREFIX = "pix-read:";

export function kvGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function kvSet(key: string, value: unknown): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export function kvRemove(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

export function workspaceKey(root: string, suffix: string): string {
  return `ws:${encodeURIComponent(root)}:${suffix}`;
}
