/**
 * IPC communication types for renderer.
 */

import type { PixApi } from "@shared/pix-api";

declare global {
  interface Window {
    pixApi: PixApi;
  }
}

export {};
