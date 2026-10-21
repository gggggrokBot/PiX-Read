import { detectPlatform } from "./detect";
import { createWebPixApi } from "./web/create-web-pix-api";

/**
 * Ensure window.pixApi exists before Vue mounts.
 * Electron preload already injected it; Capacitor/browser get the web adapter.
 */
export async function installPlatform(): Promise<void> {
  if (typeof window === "undefined") return;

  if (window.pixApi) {
    document.documentElement.dataset.pixPlatform = detectPlatform();
    return;
  }

  window.pixApi = createWebPixApi();

  try {
    const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.() === true) {
      document.documentElement.classList.add("pix-capacitor");
      document.documentElement.dataset.pixPlatform = "capacitor";
      return;
    }
  } catch {
    // ignore
  }

  document.documentElement.dataset.pixPlatform = "browser";
}
