import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { db, now, audit, transaction } from '../db.js';
import { readTable, detectCvrColumn, buildRows } from '../services/importer.js';

const ALLOWED = new Set(['.xlsx', '.xls', '.csv']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.has(ext)) return cb(new Error('Kun .xlsx, .xls og .csv accepteres'));
    cb(null, true);
  },
});

export const router = express.Router();

// Kortlivet mellemlager mellem analyse og bekraeftelse.
const pending = new Map();
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of pending) if (v.at < cutoff) pending.delete(k);
}, 60_000).unref();


// Trin 1: analyser filen og foreslaa kolonne. Intet gemmes endnu.
router.post('/analyze', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil modtaget' });
  const { rows, columns } = readTable(req.file.buffer, req.file.originalname);
  const detection = detectCvrColumn(rows, columns);
  const token = crypto.randomUUID();
  pending.set(token, { rows, columns, filename: req.file.originalname, at: Date.now() });
  res.json({
    token, filename: req.file.originalname, rowCount: rows.length, columns,
    suggestion: detection.suggestion, confident: detection.confident,
    preview: rows.slice(0, 5),
  });
});

// Trin 2: brugeren bekraefter kolonnen -> batch oprettes.
router.post('/confirm', express.json(), (req, res) => {
  const { token, cvrColumn, cvrProvider, vatProvider } = req.body || {};
  const staged = pending.get(token);
  if (!staged) return res.status(410).json({ error: 'Uploaden er udløbet. Upload filen igen.' });
  if (!staged.columns.includes(cvrColumn)) return res.status(400).json({ error: 'Ukendt kolonne' });

  const batchId = `batch_${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(3).toString('hex')}`;
  const built = buildRows(staged.rows, cvrColumn);

  transaction(() => {
    db.prepare(`INSERT INTO batches (id, filename, created_at, updated_at, state, cvr_provider, vat_provider, source_columns, total)
                VALUES (?,?,?,?,'idle',?,?,?,?)`)
      .run(batchId, staged.filename, now(), now(),
           String(cvrProvider || config.cvrProvider), String(vatProvider || config.vatProvider),
           JSON.stringify(staged.columns), built.length);

    const ins = db.prepare(`INSERT INTO companies
      (batch_id,row_index,original_cvr,cvr,source_row,state,error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const r of built) {
      ins.run(batchId, r.row_index, r.original_cvr ?? '', r.cvr ?? null, r.source_row, r.state, r.error ?? null, now(), now());
    }
    // Kobl dubletter til den foerste forekomst.
    const byRow = db.prepare('SELECT id,row_index FROM companies WHERE batch_id=?').all(batchId);
    const map = new Map(byRow.map((r) => [r.row_index, r.id]));
    const upd = db.prepare('UPDATE companies SET duplicate_of=? WHERE batch_id=? AND row_index=?');
    for (const r of built) if (r.duplicate_of_row !== null) upd.run(map.get(r.duplicate_of_row), batchId, r.row_index);
  });

  pending.delete(token);
  audit({ batch_id: batchId, step: 'system', outcome: 'batch oprettet',
          detail: `${built.length} raekker fra ${staged.filename}, kolonne "${cvrColumn}"` });
  res.json({ batchId });
});
