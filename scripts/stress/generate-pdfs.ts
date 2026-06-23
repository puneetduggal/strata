import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const SRC_DIR = path.join(ROOT, "fixtures", "meridian", "src");
const OUT_DIR = path.join(ROOT, "fixtures", "meridian", "pdf");

// A production-looking document shell: serif body, ruled tables, a running header/footer.
// The tables + multi-page flow are deliberate — they exercise unpdf extraction (matrix #17).
function htmlShell(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 22mm 18mm; }
    body { font: 11pt/1.5 Georgia, "Times New Roman", serif; color: #111; }
    h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 6px; }
    h2 { font-size: 14pt; margin-top: 20px; }
    h3 { font-size: 12pt; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #888; padding: 6px 9px; text-align: left; font-size: 10pt; }
    th { background: #f0f0f0; }
    code { background: #f4f4f4; padding: 1px 4px; }
  </style></head><body>${bodyHtml}</body></html>`;
}

export async function mdToPdf(markdown: string): Promise<Buffer> {
  const html = htmlShell(await marked.parse(markdown));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;width:100%;text-align:right;padding-right:18mm;color:#999;">MERIDIAN — CONFIDENTIAL</div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#999;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".md")).sort();
  for (const f of files) {
    const md = fs.readFileSync(path.join(SRC_DIR, f), "utf8");
    const pdf = await mdToPdf(md);
    const out = path.join(OUT_DIR, f.replace(/\.md$/, ".pdf"));
    fs.writeFileSync(out, pdf);
    process.stdout.write(`[pdf] ${f} -> ${path.basename(out)} (${pdf.length} bytes)\n`);
  }
}

// Run as a script (not when imported by the test).
if (process.argv[1] && process.argv[1].endsWith("generate-pdfs.ts")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
