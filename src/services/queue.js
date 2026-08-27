// Kø med begraenset concurrency, exponential backoff og persistent status.
// Alt state ligger i SQLite, saa et batch kan genoptages efter genstart.
import { config } from '../config.js';
import { db, audit, now, bindable } from '../db.js';
import { cvrProvider, vatProvider } from '../providers/index.js';
import { renderEvidencePdf } from './pdf.js';
import { toVatNumber } from './normalize.js';

const running = new Map(); // batchId -> { cancel: boolean }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);

const setCompany = (id, patch) => {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE companies SET ${keys.map((k) => `${k}=@${k}`).join(', ')}, updated_at=@updated_at WHERE id=@id`)
    .run(bindable({ ...patch, id, updated_at: now() }));
};

const setBatch = (id, patch) => {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE batches SET ${keys.map((k) => `${k}=@${k}`).join(', ')}, updated_at=@updated_at WHERE id=@id`)
    .run(bindable({ ...patch, id, updated_at: now() }));
};

/** Ét forsoeg med retry. Permanente fejl genforsoeges ikke. */
async function withRetry(fn, ctx) {
  let lastErr;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const started = Date.now();
    try {
      const result = await fn(attempt);
      audit({ ...ctx, attempt, outcome: 'ok', duration_ms: Date.now() - started,
              http_status: result?.meta?.status ?? null, payload_sha256: result?.meta?.sha256 ?? null,
              target: result?.target ?? ctx.target });
      return result;
    } catch (err) {
      lastErr = err;
      audit({ ...ctx, attempt, outcome: 'fejl', duration_ms: Date.now() - started,
              http_status: err.status ?? null, detail: err.message });
      if (err.retryable === false || attempt === config.maxRetries) break;
      await sleep(jitter(500 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

async function processCompany(batch, company) {
  const base = { batch_id: batch.id, company_id: company.id, cvr: company.cvr };
  const cvrP = cvrProvider(batch.cvr_provider);
  const vatP = vatProvider(batch.vat_provider);

  // ---- Trin 1: CVR ----
  setCompany(company.id, { state: 'cvr_running' });
  const cvrRes = await withRetry(() => cvrP.lookup(company.cvr),
    { ...base, step: 'cvr', provider: cvrP.id, target: null });

  const d = cvrRes.data;
  setCompany(company.id, {
    name: d.name, cvr_status: d.status, active: d.active,
    start_date: d.startDate, end_date: d.endDate,
    cvr_checked_at: now(), state: 'cvr_done',
  });

  const cvrPdf = await withRetry(() => renderEvidencePdf({
    batchId: batch.id, cvr: company.cvr, name: d.name, kind: 'CVR',
    provider: cvrP.label, timestamp: new Date().toLocaleString('da-DK'),
    target: cvrRes.target, sha256: cvrRes.meta.sha256, reference: null,
    sourceText: cvrRes.found ? `Virksomheden blev fundet i registeret med status "${d.status}".`
                             : 'Registeret returnerede ingen virksomhed paa dette CVR-nummer.',
    rawPayload: cvrRes.meta.raw,
    rows: [
      ['CVR-nummer', company.cvr],
      ['Virksomhedsnavn', d.name],
      ['Officiel status', d.status],
      ['Aktiv', d.active === 1 ? 'Ja' : d.active === 0 ? 'Nej' : 'Kan ikke afgøres'],
      ['Startdato', d.startDate],
      ['Ophørsdato', d.endDate],
      ['Datakilde', cvrP.label],
      ['Opslagstidspunkt', new Date().toLocaleString('da-DK')],
    ],
  }), { ...base, step: 'pdf', provider: 'playwright', target: 'CVR-pdf' });
  setCompany(company.id, { cvr_pdf: cvrPdf.relativePath });

  // ---- Trin 2: Moms ----
  setCompany(company.id, { state: 'vat_running' });
  const vatRes = await withRetry(() => vatP.lookup(company.cvr),
    { ...base, step: 'vat', provider: vatP.id, target: null });

  setCompany(company.id, {
    vat_status: vatRes.status,
    vat_number: vatRes.data.vatNumber || toVatNumber(company.cvr),
    vat_reference: vatRes.data.reference,
    vat_source_text: vatRes.data.sourceText,
    vat_checked_at: now(),
  });

  const vatPdf = await withRetry(() => renderEvidencePdf({
    batchId: batch.id, cvr: company.cvr, name: d.name, kind: 'MOMS',
    provider: vatP.label, timestamp: new Date().toLocaleString('da-DK'),
    target: vatRes.target, sha256: vatRes.meta.sha256, reference: vatRes.data.reference,
    sourceText: vatRes.data.sourceText, rawPayload: vatRes.meta.raw,
    screenshotBase64: vatRes.data.screenshot ? Buffer.from(vatRes.data.screenshot).toString('base64') : null,
    rows: [
      ['CVR-nummer', company.cvr],
      ['Momsnummer', vatRes.data.vatNumber],
      ['Virksomhedsnavn', vatRes.data.name || d.name],
      ['Momsstatus', { REGISTERED: 'Momsregistreret', NOT_REGISTERED: 'Ikke momsregistreret', UNKNOWN: 'Kunne ikke kontrolleres' }[vatRes.status]],
      ['Kvitteringsnummer', vatRes.data.reference],
      ['Datakilde', vatP.label],
      ['Opslagstidspunkt', new Date().toLocaleString('da-DK')],
    ],
  }), { ...base, step: 'pdf', provider: 'playwright', target: 'MOMS-pdf' });

  setCompany(company.id, { vat_pdf: vatPdf.relativePath, state: 'done', error: null });
}

function nextPending(batchId) {
  return db.prepare(`SELECT * FROM companies WHERE batch_id=? AND state IN ('pending','cvr_running','vat_running')
                     ORDER BY row_index LIMIT 1`).get(batchId);
}

/** Starter (eller genoptager) et batch. Idempotent - dobbeltkald ignoreres. */
export async function runBatch(batchId, { onlyFailed = false } = {}) {
  if (running.has(batchId)) return;
  running.set(batchId, { cancel: false });
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(batchId);
  if (!batch) { running.delete(batchId); return; }

  if (onlyFailed) {
    db.prepare(`UPDATE companies SET state='pending', error=NULL, retry_count=0
                WHERE batch_id=? AND state='failed'`).run(batchId);
  }
  // Ryd op efter en haard nedlukning midt i et opslag.
  db.prepare(`UPDATE companies SET state='pending' WHERE batch_id=? AND state IN ('cvr_running','vat_running')`).run(batchId);

  setBatch(batchId, { state: 'running' });
  audit({ batch_id: batchId, step: 'system', outcome: 'batch startet',
          detail: `cvr=${batch.cvr_provider} moms=${batch.vat_provider} concurrency=${config.concurrency}` });

  const worker = async () => {
    for (;;) {
      const ctl = running.get(batchId);
      if (!ctl || ctl.cancel) return;
      const company = nextPending(batchId);
      if (!company) return;
      setCompany(company.id, { state: 'cvr_running' }); // claim
      try {
        await processCompany(batch, company);
      } catch (err) {
        setCompany(company.id, {
          state: 'failed', error: err.message,
          retry_count: (company.retry_count || 0) + 1,
        });
      }
      await sleep(jitter(config.requestDelayMs));
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, worker));
  } finally {
    running.delete(batchId);
    const left = db.prepare(`SELECT COUNT(*) n FROM companies WHERE batch_id=? AND state='pending'`).get(batchId).n;
    setBatch(batchId, { state: left ? 'paused' : 'done' });
    audit({ batch_id: batchId, step: 'system', outcome: left ? 'batch stoppet' : 'batch faerdigt' });
  }
}

export function pauseBatch(batchId) {
  const ctl = running.get(batchId);
  if (ctl) ctl.cancel = true;
  setBatch(batchId, { state: 'paused' });
}

export const isRunning = (batchId) => running.has(batchId);
