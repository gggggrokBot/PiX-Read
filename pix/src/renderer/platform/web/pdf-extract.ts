/**
 * Browser-side PDF text / outline extraction for the lite Android/web agent tools.
 * Mirrors the CJK spacing rules used by the Electron pdf-tools.
 */
import * as pdfjs from "pdfjs-dist";

const CJK_CHAR_RE = /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

function isLatinWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[\p{L}\p{Nd}]/u.test(ch) && !CJK_CHAR_RE.test(ch);
}

function extractPageText(items: unknown[]): string {
  let out = "";
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { str?: unknown; hasEOL?: unknown };
    if (typeof rec.str !== "string") continue;
    if (rec.str) {
      if (isLatinWordChar(out.at(-1)) && isLatinWordChar(rec.str[0])) out += " ";
      out += rec.str;
    }
    if (rec.hasEOL === true) out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/ +/g, " ").trim();
}

async function openPdf(data: Uint8Array): Promise<pdfjs.PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: data.slice(),
    cMapUrl: "./pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "./pdfjs/standard_fonts/",
    useSystemFonts: true,
  });
  return task.promise;
}

export async function readPdfPages(
  data: Uint8Array,
  startPage: number,
  endPage: number,
): Promise<{ pages: Array<{ page: number; text: string }>; pageCount: number }> {
  const doc = await openPdf(data);
  try {
    const pageCount = doc.numPages;
    const start = Math.max(1, Math.min(startPage, pageCount));
    const end = Math.max(start, Math.min(endPage, pageCount));
    const pages: Array<{ page: number; text: string }> = [];
    for (let page = start; page <= end; page++) {
      const p = await doc.getPage(page);
      const content = await p.getTextContent();
      pages.push({ page, text: extractPageText(content.items) });
    }
    return { pages, pageCount };
  } finally {
    await doc.destroy();
  }
}

interface OutlineNode {
  title: string;
  page: number | null;
  items: OutlineNode[];
}

export async function readPdfOutline(data: Uint8Array): Promise<{ outline: OutlineNode[]; pageCount: number }> {
  const doc = await openPdf(data);
  try {
    const pageCount = doc.numPages;
    const raw = await doc.getOutline();
    if (!raw) return { outline: [], pageCount };

    async function destPage(dest: unknown): Promise<number | null> {
      try {
        let d = dest;
        if (typeof d === "string") d = await doc.getDestination(d);
        if (!Array.isArray(d) || d.length === 0) return null;
        const ref = d[0];
        const index = await doc.getPageIndex(ref as never);
        return index + 1;
      } catch {
        return null;
      }
    }

    async function walk(nodes: typeof raw): Promise<OutlineNode[]> {
      const out: OutlineNode[] = [];
      for (const node of nodes) {
        out.push({
          title: String(node.title ?? ""),
          page: await destPage(node.dest),
          items: node.items?.length ? await walk(node.items) : [],
        });
      }
      return out;
    }

    return { outline: await walk(raw), pageCount };
  } finally {
    await doc.destroy();
  }
}
