/**
 * Preload Script
 *
 * Exposes a typed API to the renderer process via contextBridge.
 *
 * Shared types are import type only. CJS emit must stay in dist/preload-tmp
 * so it cannot overwrite ESM dist/main/shared/*.js.
 */

import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSessionEvent,
  GuiSettings,
  LibraryFileResult,
  ReaderNoteDraft,
  ReaderNotesExportResult,
  ReaderNotesLoadResult,
  ReaderNotesMutationResult,
  ReaderNotesReportInput,
  ReaderNotesReportResult,
  ReaderNotesResetResult,
  ReaderNotesStatResult,
  ReaderStateLoadResult,
  ReaderStateSaveDraft,
  ReaderStateSaveResult,
  RequestUserInputRequest,
  RpcCommand,
} from "../shared/types.js";
import type { PixApi } from "../shared/pix-api.js";

export type { PixApi } from "../shared/pix-api.js";

const api: PixApi = {
  selectProject: () => ipcRenderer.invoke("select-project"),
  selectChatFiles: () => ipcRenderer.invoke("select-chat-files"),

  startSession: (projectDir: string) => ipcRenderer.invoke("session-start", projectDir),
  stopSession: () => ipcRenderer.invoke("session-stop"),
  isAgentRunning: () => ipcRenderer.invoke("agent-is-running"),

  sendCommand: <T = unknown>(command: RpcCommand) =>
    ipcRenderer.invoke("rpc-command", command) as Promise<{ success: boolean; data?: T; error?: string }>,

  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (settings: Partial<GuiSettings>) => ipcRenderer.invoke("set-settings", settings),
  getStoragePaths: () => ipcRenderer.invoke("get-storage-paths"),

  onAgentEvent: (callback: (event: AgentSessionEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentSessionEvent) => callback(data);
    ipcRenderer.on("agent-event", handler);
    return () => ipcRenderer.removeListener("agent-event", handler);
  },
  onAgentReady: (callback: () => void) => {
    ipcRenderer.on("agent-ready", callback);
    return () => ipcRenderer.removeListener("agent-ready", callback);
  },
  onAgentExit: (callback: (data: { code: number | null; signal: string | null; stderr: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { code: number | null; signal: string | null; stderr: string }) => callback(data);
    ipcRenderer.on("agent-exit", handler);
    return () => ipcRenderer.removeListener("agent-exit", handler);
  },
  onAgentError: (callback: (err: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data);
    ipcRenderer.on("agent-error", handler);
    return () => ipcRenderer.removeListener("agent-error", handler);
  },
  onUserInputRequest: (callback: (request: RequestUserInputRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RequestUserInputRequest) => callback(data);
    ipcRenderer.on("user-input-request", handler);
    return () => ipcRenderer.removeListener("user-input-request", handler);
  },

  listSessions: (projectDir: string) => ipcRenderer.invoke("list-sessions", projectDir),

  deleteSession: (sessionPath: string, projectDir?: string) =>
    ipcRenderer.invoke("delete-session", sessionPath, projectDir) as Promise<{ success: boolean; error?: string }>,

  libraryList: (dir: string, depth?: number) => ipcRenderer.invoke("library-list", dir, depth),
  libraryOpenPath: (targetPath: string) => ipcRenderer.invoke("library-open-path", targetPath),
  libraryShowInFolder: (targetPath: string) => ipcRenderer.invoke("library-show-in-folder", targetPath),
  libraryReadText: (targetPath: string) => ipcRenderer.invoke("library-read-text", targetPath),
  libraryReadFile: (targetPath: string) => ipcRenderer.invoke("library-read-file", targetPath) as Promise<LibraryFileResult>,

  readPdfResource: (kind: "cmap" | "font", name: string) =>
    ipcRenderer.invoke("pdf-read-resource", kind, name) as Promise<{
      success: boolean;
      data?: Uint8Array;
      error?: string;
    }>,

  notesLoad: () => ipcRenderer.invoke("notes-load") as Promise<ReaderNotesLoadResult>,
  notesAdd: (draft: ReaderNoteDraft) => ipcRenderer.invoke("notes-add", draft) as Promise<ReaderNotesMutationResult>,
  notesUpdate: (id: string, comment: string) =>
    ipcRenderer.invoke("notes-update", id, comment) as Promise<ReaderNotesMutationResult>,
  notesDelete: (id: string) => ipcRenderer.invoke("notes-delete", id) as Promise<ReaderNotesMutationResult>,
  notesRestore: (id: string) => ipcRenderer.invoke("notes-restore", id) as Promise<ReaderNotesMutationResult>,
  notesExport: () => ipcRenderer.invoke("notes-export") as Promise<ReaderNotesExportResult>,
  notesExportReport: (input: ReaderNotesReportInput) =>
    ipcRenderer.invoke("notes-export-report", input) as Promise<ReaderNotesReportResult>,
  notesReset: () => ipcRenderer.invoke("notes-reset") as Promise<ReaderNotesResetResult>,
  notesStat: () => ipcRenderer.invoke("notes-stat") as Promise<ReaderNotesStatResult>,

  readerStateLoad: () => ipcRenderer.invoke("reader-state-load") as Promise<ReaderStateLoadResult>,
  readerStateSave: (draft: ReaderStateSaveDraft) =>
    ipcRenderer.invoke("reader-state-save", draft) as Promise<ReaderStateSaveResult>,

  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowMaximizeChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on("window-maximize-change", handler);
    return () => ipcRenderer.removeListener("window-maximize-change", handler);
  },

  mcpGetServers: () => ipcRenderer.invoke("mcp-get-servers"),
  mcpGetConfig: () => ipcRenderer.invoke("mcp-get-config"),

  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
};

contextBridge.exposeInMainWorld("pixApi", api);
