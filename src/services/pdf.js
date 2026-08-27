import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getBrowser } from './browser.js';
import { evidenceHtml } from '../templates/evidence.js';
import { evidenceBasename, sanitizeSegment } from './normalize.js';

/** Mappe pr. virksomhed pr. batch. CVR er altid foerste segment. */
export function companyDir(batchId, cvr, name) {
  return path.join(config.dirs.output, sanitizeSegment(batchId), `${cvr}_${sanitizeSegment(name, 'ukendt_navn')}`);
}

/** Sikrer at en sti ikke kan pege uden for output-mappen. */
export function assertInsideOutput(p) {
  const resolved = path.resolve(p);
  const base = path.resolve(config.dirs.output);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Ugyldig sti');
  return resolved;
}

export async function renderEvidencePdf(opts) {
  const { batchId, cvr, name, kind } = opts;
  const dir = assertInsideOutput(companyDir(batchId, cvr, name));
  await fs.mkdir(dir, { recursive: true });
  const filename = evidenceBasename(cvr, name, kind);
  const target = assertInsideOutput(path.join(dir, filename));

  if (!config.pdfEnabled) {
    // Toerloeb: hele pipelinen kan testes uden Chromium installeret.
    const htmlPath = target.replace(/\.pdf$/, '.html');
    await fs.writeFile(htmlPath, evidenceHtml(opts), 'utf8');
    return { filename: path.basename(htmlPath), absolutePath: htmlPath,
             relativePath: path.relative(config.dirs.output, htmlPath), skipped: true };
  }
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.setContent(evidenceHtml(opts), { waitUntil: 'load' });
    await page.pdf({
      path: target, format: 'A4', printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:7pt;color:#98a0ae;width:100%;padding:0 16mm;display:flex;justify-content:space-between">
        <span>CVR ${cvr}</span><span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await ctx.close().catch(() => {});
  }
  return { filename, absolutePath: target, relativePath: path.relative(config.dirs.output, target) };
}
