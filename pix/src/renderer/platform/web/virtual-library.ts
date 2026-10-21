import type { LibraryFileResult, LibraryNode } from "@shared/types";
import { idbDelete, idbGet, idbPut } from "./idb-files";
import { kvGet, kvSet, workspaceKey } from "./kv";

export const DEFAULT_LIBRARY_ROOT = "/pix-library";

interface LibraryMeta {
  root: string;
  /** Relative paths under root (forward slashes). */
  files: string[];
}

function metaKey(root: string): string {
  return workspaceKey(root, "library-meta");
}

function abs(root: string, rel: string): string {
  const clean = rel.replace(/^\/+/, "");
  return `${root.replace(/\/+$/, "")}/${clean}`;
}

function toRel(root: string, target: string): string | null {
  const r = root.replace(/\/+$/, "");
  if (target === r) return "";
  if (!target.startsWith(r + "/")) return null;
  return target.slice(r.length + 1);
}

function loadMeta(root: string): LibraryMeta {
  return kvGet<LibraryMeta>(metaKey(root), { root, files: [] });
}

function saveMeta(meta: LibraryMeta): void {
  kvSet(metaKey(meta.root), meta);
}

export function ensureLibrary(root: string): void {
  const existing = kvGet<LibraryMeta | null>(metaKey(root), null);
  if (!existing) {
    saveMeta({ root, files: [] });
    return;
  }
  if (existing.root !== root) {
    saveMeta({ root, files: existing.files });
  }
}

export async function importFiles(root: string, fileList: FileList | File[]): Promise<string[]> {
  ensureLibrary(root);
  const meta = loadMeta(root);
  const imported: string[] = [];
  for (const file of Array.from(fileList)) {
    const rel = file.name.replace(/\\/g, "/").split("/").pop() || file.name;
    const path = abs(root, rel);
    const buf = await file.arrayBuffer();
    await idbPut(path, buf);
    if (!meta.files.includes(rel)) meta.files.push(rel);
    imported.push(path);
  }
  meta.files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  saveMeta(meta);
  return imported;
}

export function listLibrary(root: string, dir: string, _depth = 1): { success: boolean; nodes: LibraryNode[]; error?: string } {
  ensureLibrary(root);
  const meta = loadMeta(root);
  const dirRel = toRel(root, dir);
  if (dirRel == null && dir !== root) {
    return { success: false, nodes: [], error: "Path is outside the library." };
  }
  const prefix = dirRel ? dirRel.replace(/\/+$/, "") + "/" : "";
  const nodes: LibraryNode[] = [];
  const seenDirs = new Set<string>();
  for (const rel of meta.files) {
    if (prefix && !rel.startsWith(prefix)) continue;
    const rest = prefix ? rel.slice(prefix.length) : rel;
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      if (seenDirs.has(name)) continue;
      seenDirs.add(name);
      nodes.push({ name, path: abs(root, prefix + name), type: "directory", children: [] });
    } else {
      nodes.push({ name: rest, path: abs(root, prefix + rest), type: "file" });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return { success: true, nodes };
}

export async function readFile(root: string, targetPath: string): Promise<LibraryFileResult> {
  ensureLibrary(root);
  const rel = toRel(root, targetPath);
  if (rel == null) return { success: false, code: "outside", error: "Path is outside the library." };
  const meta = loadMeta(root);
  if (!meta.files.includes(rel)) return { success: false, code: "not-found", error: "File not found." };
  const data = await idbGet(targetPath);
  if (!data) return { success: false, code: "not-found", error: "File not found." };
  return { success: true, data: new Uint8Array(data) };
}

export async function readText(
  root: string,
  targetPath: string,
): Promise<LibraryFileResult & { content?: string; truncated?: boolean }> {
  const result = await readFile(root, targetPath);
  if (!result.success || !result.data) return result;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(result.data);
  const max = 200_000;
  if (text.length > max) {
    return { success: true, data: result.data, content: text.slice(0, max), truncated: true };
  }
  return { success: true, data: result.data, content: text, truncated: false };
}

export async function removeFile(root: string, targetPath: string): Promise<void> {
  const rel = toRel(root, targetPath);
  if (rel == null) return;
  const meta = loadMeta(root);
  meta.files = meta.files.filter((f) => f !== rel);
  saveMeta(meta);
  await idbDelete(targetPath);
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    });
    input.addEventListener("cancel", () => {
      cleanup();
      resolve([]);
    });
    document.body.appendChild(input);
    input.click();
  });
}
