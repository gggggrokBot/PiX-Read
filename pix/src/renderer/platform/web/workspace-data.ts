import type {
  ReaderNote,
  ReaderNoteDraft,
  ReaderNotesExportResult,
  ReaderNotesFile,
  ReaderNotesLoadResult,
  ReaderNotesMutationResult,
  ReaderNotesReportInput,
  ReaderNotesReportResult,
  ReaderNotesResetResult,
  ReaderNotesStatResult,
  ReaderStateFile,
  ReaderStateLoadResult,
  ReaderStateSaveDraft,
  ReaderStateSaveResult,
} from "@shared/types";
import { kvGet, kvSet, workspaceKey } from "./kv";

const EMPTY_STATE: ReaderStateFile = { version: 1, lastDocPath: null, documents: {} };

function notesStoreKey(root: string): string {
  return workspaceKey(root, "notes");
}

function readerStoreKey(root: string): string {
  return workspaceKey(root, "reader-state");
}

function docPathKey(docPath: string): string {
  return docPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function toRelativeDocPath(absPath: string, root: string): string | null {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = absPath.replace(/\\/g, "/");
  if (p === r) return null;
  if (!p.startsWith(r + "/")) return null;
  return p.slice(r.length + 1);
}

function loadNotesFile(root: string): ReaderNotesFile {
  return kvGet<ReaderNotesFile>(notesStoreKey(root), { version: 1, notes: [] });
}

function saveNotesFile(root: string, file: ReaderNotesFile): void {
  kvSet(notesStoreKey(root), file);
}

function loadReaderFile(root: string): ReaderStateFile {
  return kvGet<ReaderStateFile>(readerStoreKey(root), EMPTY_STATE);
}

function saveReaderFile(root: string, file: ReaderStateFile): void {
  kvSet(readerStoreKey(root), file);
}

function newId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function notesLoad(root: string | null): ReaderNotesLoadResult {
  if (!root) return { success: false, notes: [], filePath: "", code: "no-root", error: "No workspace." };
  const file = loadNotesFile(root);
  return { success: true, notes: file.notes, filePath: `${root}/.pix-read/notes.json` };
}

export function notesAdd(root: string | null, draft: ReaderNoteDraft): ReaderNotesMutationResult {
  if (!root) return { success: false, notes: [], code: "no-root", error: "No workspace." };
  const docPath = toRelativeDocPath(draft.docFilePath, root);
  if (!docPath) return { success: false, notes: [], code: "outside", error: "Outside workspace." };
  const text = draft.text.trim();
  if (!text) return { success: false, notes: [], code: "invalid-input", error: "Empty note." };
  const file = loadNotesFile(root);
  const dup = file.notes.find(
    (n) => docPathKey(n.docPath) === docPathKey(docPath) && n.page === draft.page && n.kind === draft.kind && n.text === text,
  );
  if (dup) return { success: true, notes: file.notes, note: dup, duplicateOf: dup.id };
  const now = Date.now();
  const note: ReaderNote = {
    id: newId(),
    kind: draft.kind,
    docPath,
    page: draft.page,
    text,
    comment: "",
    createdAt: now,
    updatedAt: now,
  };
  file.notes.unshift(note);
  saveNotesFile(root, file);
  return { success: true, notes: file.notes, note };
}

export function notesUpdate(root: string | null, id: string, comment: string): ReaderNotesMutationResult {
  if (!root) return { success: false, notes: [], code: "no-root", error: "No workspace." };
  const file = loadNotesFile(root);
  const note = file.notes.find((n) => n.id === id);
  if (!note) return { success: false, notes: file.notes, code: "not-found", error: "Not found." };
  note.comment = comment;
  note.updatedAt = Date.now();
  saveNotesFile(root, file);
  return { success: true, notes: file.notes, note };
}

let deletedSlot: { root: string; note: ReaderNote } | null = null;

export function notesDelete(root: string | null, id: string): ReaderNotesMutationResult {
  if (!root) return { success: false, notes: [], code: "no-root", error: "No workspace." };
  const file = loadNotesFile(root);
  const idx = file.notes.findIndex((n) => n.id === id);
  if (idx < 0) return { success: false, notes: file.notes, code: "not-found", error: "Not found." };
  const [removed] = file.notes.splice(idx, 1);
  deletedSlot = { root, note: removed };
  saveNotesFile(root, file);
  return { success: true, notes: file.notes };
}

export function notesRestore(root: string | null, id: string): ReaderNotesMutationResult {
  if (!root) return { success: false, notes: [], code: "no-root", error: "No workspace." };
  if (!deletedSlot || deletedSlot.root !== root || deletedSlot.note.id !== id) {
    return { success: false, notes: loadNotesFile(root).notes, code: "not-found", error: "Nothing to restore." };
  }
  const file = loadNotesFile(root);
  file.notes.unshift(deletedSlot.note);
  deletedSlot = null;
  saveNotesFile(root, file);
  return { success: true, notes: file.notes, note: file.notes[0] };
}

export function notesExport(root: string | null): ReaderNotesExportResult {
  if (!root) return { success: false, code: "no-root", error: "No workspace." };
  const file = loadNotesFile(root);
  if (file.notes.length === 0) return { success: false, code: "empty", error: "No notes." };
  const lines = file.notes.map((n) => `### ${n.docPath} p.${n.page}\n\n${n.text}${n.comment ? `\n\n> ${n.comment}` : ""}`);
  const markdown = `# PiX-Read Notes\n\n${lines.join("\n\n---\n\n")}\n`;
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "notes.md";
  a.click();
  URL.revokeObjectURL(url);
  return { success: true, filePath: `${root}/.pix-read/notes.md`, count: file.notes.length };
}

export function notesExportReport(root: string | null, input: ReaderNotesReportInput): ReaderNotesReportResult {
  if (!root) return { success: false, code: "no-root", error: "No workspace." };
  const docPath = toRelativeDocPath(input.docFilePath, root);
  if (!docPath) return { success: false, code: "outside", error: "Outside workspace." };
  const file = loadNotesFile(root);
  const entries = file.notes.filter((n) => docPathKey(n.docPath) === docPathKey(docPath));
  const markdown = [`# 阅读报告 · ${docPath}`, "", ...entries.map((n) => `- p.${n.page}: ${n.text}`)].join("\n");
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${docPath.split("/").pop() || "report"}.md`;
  a.click();
  URL.revokeObjectURL(url);
  return {
    success: true,
    filePath: `${root}/.pix-read/reports/${docPath}.md`,
    displayPath: `.pix-read/reports/${docPath}.md`,
    count: entries.length,
  };
}

export function notesReset(root: string | null): ReaderNotesResetResult {
  if (!root) return { success: false, notes: [], code: "no-root", error: "No workspace." };
  saveNotesFile(root, { version: 1, notes: [] });
  return { success: true, notes: [] };
}

export function notesStat(root: string | null): ReaderNotesStatResult {
  if (!root) return { success: false, exists: false, size: 0, mtimeMs: 0, hash: "", code: "no-root", error: "No workspace." };
  const raw = JSON.stringify(loadNotesFile(root));
  return { success: true, exists: true, size: raw.length, mtimeMs: Date.now(), hash: String(raw.length) };
}

export function readerStateLoad(root: string | null): ReaderStateLoadResult {
  if (!root) {
    return { success: false, state: EMPTY_STATE, filePath: "", degraded: false, code: "no-root", error: "No workspace." };
  }
  return {
    success: true,
    state: loadReaderFile(root),
    filePath: `${root}/.pix-read/reader-state.json`,
    degraded: false,
  };
}

export function readerStateSave(root: string | null, draft: ReaderStateSaveDraft): ReaderStateSaveResult {
  if (!root) return { success: false, state: EMPTY_STATE, code: "no-root", error: "No workspace." };
  const rel = toRelativeDocPath(draft.docFilePath, root);
  if (!rel) return { success: false, state: EMPTY_STATE, code: "outside", error: "Outside workspace." };
  const file = loadReaderFile(root);
  const key = docPathKey(rel);
  const prev = file.documents[key];
  file.documents[key] = {
    page: draft.page,
    scale: draft.scale,
    updatedAt: Date.now(),
    lastSessionPath: draft.lastSessionPath ?? prev?.lastSessionPath,
    lastSessionAt: draft.lastSessionAt ?? prev?.lastSessionAt,
  };
  file.lastDocPath = rel;
  saveReaderFile(root, file);
  return { success: true, state: file };
}
