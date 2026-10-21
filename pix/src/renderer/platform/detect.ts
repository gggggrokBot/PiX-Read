export type PixRuntimePlatform = "electron" | "capacitor" | "browser";

function capacitorNative(): boolean {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

function electronUa(): boolean {
  return typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
}

/**
 * Resolve the host shell. Prefer explicit markers over "pixApi exists",
 * because the web/Android adapter also installs window.pixApi.
 */
export function detectPlatform(): PixRuntimePlatform {
  if (typeof window === "undefined") return "browser";
  if (capacitorNative()) return "capacitor";
  if (electronUa()) return "electron";
  const marked = document.documentElement.dataset.pixPlatform;
  if (marked === "electron" || marked === "capacitor" || marked === "browser") return marked;
  // Preload injects pixApi before Vue boots; without Electron UA treat as browser.
  return "browser";
}

export function isNativeShell(): boolean {
  const platform = detectPlatform();
  return platform === "electron" || platform === "capacitor";
}
