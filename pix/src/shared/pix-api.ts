/**
 * Cross-platform host API for the renderer.
 * Electron preload implements this via IPC; web/Android install a runtime adapter.
 */
import type {
  AgentSessionEvent,
  GuiSettings,
  LibraryFileResult,
  LibraryNode,
  McpConfigInfo,
  McpServerInfo,
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
  SessionInfo,
} from "./types.js";

/** PiX-owned storage locations surfaced to Settings. Paths may be virtual on web/Android. */
export interface PixStoragePaths {
  rootDir: string;
  agentDir: string;
  guiSettingsFile: string;
  kernelSettingsFile: string;
  authJsonFile: string;
  modelsJsonFile: string;
  mcpJsonFile: string;
  sessionsRootDir: string;
  logsDir: string;
}

export interface PixApi {
  selectProject: () => Promise<string | null>;
  selectChatFiles: () => Promise<string[]>;

  startSession: (projectDir: string) => Promise<{ success: boolean; error?: string }>;
  stopSession: () => Promise<{ success: boolean }>;
  isAgentRunning: () => Promise<boolean>;

  sendCommand: <T = unknown>(command: RpcCommand) => Promise<{ success: boolean; data?: T; error?: string }>;

  getSettings: () => Promise<GuiSettings>;
  setSettings: (settings: Partial<GuiSettings>) => Promise<{ success: boolean }>;
  getStoragePaths: () => Promise<PixStoragePaths>;

  onAgentEvent: (callback: (event: AgentSessionEvent) => void) => () => void;
  onAgentReady: (callback: () => void) => () => void;
  onAgentExit: (callback: (data: { code: number | null; signal: string | null; stderr: string }) => void) => () => void;
  onAgentError: (callback: (err: { message: string }) => void) => () => void;
  onUserInputRequest: (callback: (request: RequestUserInputRequest) => void) => () => void;

  listSessions: (projectDir: string) => Promise<SessionInfo[]>;
  deleteSession: (sessionPath: string, projectDir?: string) => Promise<{ success: boolean; error?: string }>;

  libraryList: (dir: string, depth?: number) => Promise<{ success: boolean; nodes: LibraryNode[]; error?: string }>;
  libraryOpenPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  libraryShowInFolder: (targetPath: string) => Promise<{ success: boolean }>;
  libraryReadText: (targetPath: string) => Promise<LibraryFileResult & { content?: string; truncated?: boolean }>;
  libraryReadFile: (targetPath: string) => Promise<LibraryFileResult>;

  readPdfResource: (
    kind: "cmap" | "font",
    name: string,
  ) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;

  notesLoad: () => Promise<ReaderNotesLoadResult>;
  notesAdd: (draft: ReaderNoteDraft) => Promise<ReaderNotesMutationResult>;
  notesUpdate: (id: string, comment: string) => Promise<ReaderNotesMutationResult>;
  notesDelete: (id: string) => Promise<ReaderNotesMutationResult>;
  notesRestore: (id: string) => Promise<ReaderNotesMutationResult>;
  notesExport: () => Promise<ReaderNotesExportResult>;
  notesExportReport: (input: ReaderNotesReportInput) => Promise<ReaderNotesReportResult>;
  notesReset: () => Promise<ReaderNotesResetResult>;
  notesStat: () => Promise<ReaderNotesStatResult>;

  readerStateLoad: () => Promise<ReaderStateLoadResult>;
  readerStateSave: (draft: ReaderStateSaveDraft) => Promise<ReaderStateSaveResult>;

  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (callback: (maximized: boolean) => void) => () => void;

  mcpGetServers: () => Promise<McpServerInfo[]>;
  mcpGetConfig: () => Promise<McpConfigInfo>;

  checkForUpdates: () => Promise<{
    success: boolean;
    hasUpdate?: boolean;
    currentVersion?: string;
    latestVersion?: string;
    releaseNotes?: string;
    releaseDate?: string;
    error?: string;
  }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => Promise<{ success: boolean; error?: string }>;
}
