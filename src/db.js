// SQLite via Nodes indbyggede node:sqlite. Ingen native kompilering,
// ingen Visual Studio, ingen node-gyp. Kraever Node 24 (eller Node 22.5+
// startet med --experimental-sqlite).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dirs.data, { recursive: true });
export const db = new DatabaseSync(path.join(config.dirs.data, 'cvr-checker.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  filename TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  cvr_provider TEXT,
  vat_provider TEXT,
  source_columns TEXT,
  total INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  row_index INTEGER,
  original_cvr TEXT,
  cvr TEXT,
  source_row TEXT,
  duplicate_of INTEGER,
  name TEXT,
  cvr_status TEXT,
  active INTEGER,
  start_date TEXT,
  end_date TEXT,
  vat_status TEXT,
  vat_number TEXT,
  vat_reference TEXT,
  vat_source_text TEXT,
  cvr_checked_at TEXT,
  vat_checked_at TEXT,
  cvr_pdf TEXT,
  vat_pdf TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, row_index)
);
CREATE INDEX IF NOT EXISTS idx_companies_batch ON companies(batch_id, state);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  company_id INTEGER,
  cvr TEXT,
  ts TEXT NOT NULL,
  step TEXT,
  provider TEXT,
  target TEXT,
  http_status INTEGER,
  outcome TEXT,
  attempt INTEGER,
  duration_ms INTEGER,
  payload_sha256 TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_batch ON audit_log(batch_id, id);
`);

export const now = () => new Date().toISOString();

/**
 * node:sqlite afviser undefined og booleans. Alt der skal bindes,
 * gaar igennem her - én gang, i stedet for spredt ud over kaldstederne.
 */
export function bindable(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

/** Kører fn i én transaktion. Erstatter better-sqlite3's db.transaction(). */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const auditStmt = db.prepare(`INSERT INTO audit_log
  (batch_id, company_id, cvr, ts, step, provider, target, http_status, outcome, attempt, duration_ms, payload_sha256, detail)
  VALUES (@batch_id,@company_id,@cvr,@ts,@step,@provider,@target,@http_status,@outcome,@attempt,@duration_ms,@payload_sha256,@detail)`);

export function audit(entry) {
  auditStmt.run(bindable({
    batch_id: null, company_id: null, cvr: null, step: null, provider: null, target: null,
    http_status: null, outcome: null, attempt: null, duration_ms: null, payload_sha256: null,
    detail: null, ...entry, ts: now(),
  }));
}
