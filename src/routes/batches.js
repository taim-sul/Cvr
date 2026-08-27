import express from 'express';
import { db } from '../db.js';
import { runBatch, pauseBatch, isRunning } from '../services/queue.js';
import { providerStatus } from '../providers/index.js';

export const router = express.Router();

const counts = (batchId) => {
  const rows = db.prepare('SELECT state, active, vat_status FROM companies WHERE batch_id=?').all(batchId);
  const done = rows.filter((r) => ['done', 'failed', 'invalid', 'duplicate'].includes(r.state)).length;
  return {
    total: rows.length,
    processed: done,
    active: rows.filter((r) => r.active === 1).length,
    inactive: rows.filter((r) => r.active === 0).length,
    vatRegistered: rows.filter((r) => r.vat_status === 'REGISTERED').length,
    vatNotRegistered: rows.filter((r) => r.vat_status === 'NOT_REGISTERED').length,
    vatUnknown: rows.filter((r) => r.vat_status === 'UNKNOWN').length,
    failed: rows.filter((r) => r.state === 'failed').length,
    invalid: rows.filter((r) => r.state === 'invalid').length,
    duplicates: rows.filter((r) => r.state === 'duplicate').length,
  };
};

router.get('/providers', (_req, res) => res.json(providerStatus()));

router.get('/', (_req, res) => {
  const list = db.prepare('SELECT * FROM batches ORDER BY created_at DESC LIMIT 50').all();
  res.json(list.map((b) => ({ ...b, running: isRunning(b.id), counts: counts(b.id) })));
});

router.get('/:id', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Ukendt batch' });
  const companies = db.prepare(`SELECT id,row_index,original_cvr,cvr,name,cvr_status,active,start_date,end_date,
      vat_status,vat_number,vat_reference,cvr_pdf,vat_pdf,state,error,retry_count
      FROM companies WHERE batch_id=? ORDER BY row_index`).all(req.params.id);
  res.json({ batch: { ...batch, running: isRunning(batch.id) }, counts: counts(batch.id), companies });
});

router.post('/:id/start', (req, res) => {
  runBatch(req.params.id).catch((e) => console.error('[batch]', e));
  res.json({ ok: true });
});

router.post('/:id/pause', (req, res) => { pauseBatch(req.params.id); res.json({ ok: true }); });

router.post('/:id/retry-failed', (req, res) => {
  runBatch(req.params.id, { onlyFailed: true }).catch((e) => console.error('[batch]', e));
  res.json({ ok: true });
});

router.get('/:id/audit', (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log WHERE batch_id=? ORDER BY id DESC LIMIT 1000').all(req.params.id));
});
