/**
 * Copy pdfjs-dist CMap / standard font presets into pix/public for the web/Android shell.
 * Electron continues to read the same files from node_modules via the main process.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pixRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(pixRoot, "node_modules", "pdfjs-dist"),
  join(pixRoot, "..", "node_modules", "pdfjs-dist"),
];
const pdfjsRoot = candidates.find((dir) => existsSync(dir));
if (!pdfjsRoot) {
  console.error("[sync-pdfjs-assets] pdfjs-dist not found under node_modules");
  process.exit(1);
}

const outRoot = join(pixRoot, "public", "pdfjs");
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });
cpSync(join(pdfjsRoot, "cmaps"), join(outRoot, "cmaps"), { recursive: true });
cpSync(join(pdfjsRoot, "standard_fonts"), join(outRoot, "standard_fonts"), { recursive: true });
console.log(`[sync-pdfjs-assets] synced from ${pdfjsRoot} -> ${outRoot}`);
