import type { PixApi, PixStoragePaths } from "@shared/pix-api";
import type { GuiSettings, RequestUserInputRequest, RpcCommand } from "@shared/types";
import { LiteSession } from "./lite-session";
import {
  DEFAULT_LIBRARY_ROOT,
  ensureLibrary,
  importFiles,
  listLibrary,
  pickFiles,
  readFile,
  readText,
} from "./virtual-library";
import {
  notesAdd,
  notesDelete,
  notesExport,
  notesExportReport,
  notesLoad,
  notesReset,
  notesRestore,
  notesStat,
  notesUpdate,
  readerStateLoad,
  readerStateSave,
} from "./workspace-data";
import { kvGet, kvSet } from "./kv";

const DEFAULT_SETTINGS: GuiSettings = {
  theme: "light",
  recentProjects: [],
};

function loadSettings(): GuiSettings {
  return { ...DEFAULT_SETTINGS, ...kvGet<Partial<GuiSettings>>("gui-settings", {}) };
}

function saveSettings(settings: GuiSettings): void {
  kvSet("gui-settings", settings);
}

function virtualStoragePaths(): PixStoragePaths {
  return {
    rootDir: "localStorage://pix-read",
    agentDir: "localStorage://pix-read/agent",
    guiSettingsFile: "localStorage://pix-read/pix-settings.json",
    kernelSettingsFile: "localStorage://pix-read/agent/settings.json",
    authJsonFile: "localStorage://pix-read/agent/auth.json",
    modelsJsonFile: "localStorage://pix-read/agent/models.json",
    mcpJsonFile: "localStorage://pix-read/agent/mcp.json",
    sessionsRootDir: "localStorage://pix-read/agent/sessions",
    logsDir: "localStorage://pix-read/logs",
  };
}

async function fetchPdfResource(kind: "cmap" | "font", name: string): Promise<{ success: boolean; data?: Uint8Array; error?: string }> {
  const base = kind === "cmap" ? "./pdfjs/cmaps/" : "./pdfjs/standard_fonts/";
  try {
    const res = await fetch(base + name);
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    return { success: true, data: new Uint8Array(buf) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function createWebPixApi(): PixApi {
  const session = new LiteSession();
  let libraryRoot: string | null = null;
  const userInputListeners = new Set<(request: RequestUserInputRequest) => void>();

  return {
    selectProject: async () => {
      // Mobile/web: import PDFs into a virtual library instead of picking a host folder.
      const files = await pickFiles(".pdf,application/pdf,text/plain,.md,.txt", true);
      if (files.length === 0) return null;
      const root = DEFAULT_LIBRARY_ROOT;
      ensureLibrary(root);
      await importFiles(root, files);
      const settings = loadSettings();
      const existing = settings.recentProjects.find((p) => p.path === root);
      const entry = {
        path: root,
        name: "PiX 资料库",
        lastOpened: Date.now(),
        sessionCount: existing?.sessionCount ?? 0,
      };
      settings.recentProjects = [entry, ...settings.recentProjects.filter((p) => p.path !== root)].slice(0, 12);
      saveSettings(settings);
      return root;
    },

    selectChatFiles: async () => {
      if (!libraryRoot) return [];
      const files = await pickFiles("image/*,.png,.jpg,.jpeg,.webp,.gif,.txt,.md", true);
      if (files.length === 0) return [];
      return importFiles(libraryRoot, files);
    },

    startSession: async (projectDir) => {
      libraryRoot = projectDir;
      ensureLibrary(projectDir);
      return session.start(projectDir);
    },
    stopSession: async () => {
      libraryRoot = null;
      return session.stop();
    },
    isAgentRunning: async () => session.isRunning(),

    sendCommand: async <T = unknown>(command: RpcCommand) => {
      const result = await session.handle(command);
      return result as { success: boolean; data?: T; error?: string };
    },

    getSettings: async () => loadSettings(),
    setSettings: async (partial) => {
      const next = { ...loadSettings(), ...partial };
      saveSettings(next);
      return { success: true };
    },
    getStoragePaths: async () => virtualStoragePaths(),

    onAgentEvent: (cb) => session.onEvent(cb),
    onAgentReady: (cb) => session.onReady(cb),
    onAgentExit: (cb) => session.onExit(cb),
    onAgentError: (cb) => session.onError(cb),
    onUserInputRequest: (cb) => {
      userInputListeners.add(cb);
      return () => userInputListeners.delete(cb);
    },

    listSessions: async (projectDir) => session.listSessions(projectDir),
    deleteSession: async (sessionPath, projectDir) => session.deleteSession(sessionPath, projectDir),

    libraryList: async (dir, depth) => {
      if (!libraryRoot) return { success: false, nodes: [], error: "No workspace." };
      return listLibrary(libraryRoot, dir, depth);
    },
    libraryOpenPath: async () => ({ success: false, error: "系统打开不可用（Android/web）。" }),
    libraryShowInFolder: async () => ({ success: true }),
    libraryReadText: async (targetPath) => {
      if (!libraryRoot) return { success: false, code: "no-root", error: "No workspace." };
      return readText(libraryRoot, targetPath);
    },
    libraryReadFile: async (targetPath) => {
      if (!libraryRoot) return { success: false, code: "no-root", error: "No workspace." };
      return readFile(libraryRoot, targetPath);
    },

    readPdfResource: (kind, name) => fetchPdfResource(kind, name),

    notesLoad: async () => notesLoad(libraryRoot),
    notesAdd: async (draft) => notesAdd(libraryRoot, draft),
    notesUpdate: async (id, comment) => notesUpdate(libraryRoot, id, comment),
    notesDelete: async (id) => notesDelete(libraryRoot, id),
    notesRestore: async (id) => notesRestore(libraryRoot, id),
    notesExport: async () => notesExport(libraryRoot),
    notesExportReport: async (input) => notesExportReport(libraryRoot, input),
    notesReset: async () => notesReset(libraryRoot),
    notesStat: async () => notesStat(libraryRoot),

    readerStateLoad: async () => readerStateLoad(libraryRoot),
    readerStateSave: async (draft) => readerStateSave(libraryRoot, draft),

    windowMinimize: async () => undefined,
    windowMaximize: async () => undefined,
    windowClose: async () => undefined,
    windowIsMaximized: async () => false,
    onWindowMaximizeChange: () => () => undefined,

    mcpGetServers: async () => [],
    mcpGetConfig: async () => ({ configPaths: [], errors: ["MCP is unavailable on Android/web lite runtime."] }),

    checkForUpdates: async () => ({ success: false, error: "Updates are managed by the app store / sideload APK." }),
    downloadUpdate: async () => ({ success: false, error: "Unsupported" }),
    installUpdate: async () => ({ success: false, error: "Unsupported" }),
  };
}
