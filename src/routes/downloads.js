import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { config } from '../config.js';
import { db } from '../db.js';
import { buildResultWorkbook, buildAuditWorkbook } from '../services/export.js';
import { assertInsideOutput } from '../services/pdf.js';

export const router = express.Router();

function sendPdf(res, relativePath) {
  if (!relativePath) return res.status(404).json({ error: 'PDF findes ikke' });
  let abs;
  try { abs = assertInsideOutput(path.join(config.dirs.output, relativePath)); }
  catch { return res.status(400).json({ error: 'Ugyldig sti' }); }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'PDF findes ikke paa disken' });
  res.download(abs, path.basename(abs));
}

router.get('/company/:id/:kind', (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Ukendt virksomhed' });
  sendPdf(res, req.params.kind === 'cvr' ? c.cvr_pdf : c.vat_pdf);
});

router.get('/batch/:id/resultat.xlsx', (req, res) => {
  const buf = buildResultWorkbook(req.params.id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="CVR-kontrol_${req.params.id}.xlsx"`);
  res.send(buf);
});

router.get('/batch/:id/auditlog.xlsx', (req, res) => {
  const buf = buildAuditWorkbook(req.params.id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Auditlog_${req.params.id}.xlsx"`);
  res.send(buf);
});

router.get('/batch/:id/dokumentation.zip', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Ukendt batch' });
  const companies = db.prepare('SELECT * FROM companies WHERE batch_id=? ORDER BY row_index').all(req.params.id);
  const date = batch.created_at.slice(0, 10);
  const rootName = `CVR-kontrol_${date}`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${rootName}.zip"`);

  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', (err) => { console.error('[zip]', err); res.destroy(); });
  zip.pipe(res);

  for (const c of companies) {
    for (const rel of [c.cvr_pdf, c.vat_pdf]) {
      if (!rel) continue;
      const abs = path.join(config.dirs.output, rel);
      if (!fs.existsSync(abs)) continue;
      // rel = <batch>/<cvr>_<navn>/<fil>.pdf -> behold de to sidste segmenter
      const parts = rel.split(/[/\\]/);
      zip.file(abs, { name: path.posix.join(rootName, parts.at(-2), parts.at(-1)) });
    }
  }
  zip.append(buildResultWorkbook(req.params.id), { name: path.posix.join(rootName, 'Resultat.xlsx') });
  zip.append(buildAuditWorkbook(req.params.id), { name: path.posix.join(rootName, 'Auditlog.xlsx') });
  zip.finalize();
});
