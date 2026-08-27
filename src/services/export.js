import XLSX from 'xlsx';
import { db } from '../db.js';

const VAT_LABEL = { REGISTERED: 'Ja', NOT_REGISTERED: 'Nej', UNKNOWN: 'Ukendt' };

const overall = (c) => {
  if (c.state === 'invalid') return 'Ugyldigt CVR';
  if (c.state === 'duplicate') return 'Dublet';
  if (c.state === 'failed') return 'Fejl';
  if (c.state !== 'done') return 'Ikke faerdig';
  if (c.active === 0) return 'Inaktiv virksomhed';
  if (c.vat_status === 'NOT_REGISTERED') return 'Aktiv, ikke momsregistreret';
  if (c.vat_status === 'UNKNOWN') return 'Aktiv, moms ukendt';
  return 'OK';
};

/** Bevarer inputfilens kolonner og tilfoejer kontrolresultatet bagefter. */
export function buildResultWorkbook(batchId) {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(batchId);
  const companies = db.prepare('SELECT * FROM companies WHERE batch_id=? ORDER BY row_index').all(batchId);
  const sourceColumns = JSON.parse(batch.source_columns || '[]');

  const byId = new Map(companies.map((c) => [c.id, c]));
  const rows = companies.map((row) => {
    // En dublet arver kontrolresultatet fra den raekke der faktisk blev slaaet op.
    const c = row.duplicate_of ? { ...byId.get(row.duplicate_of), ...{ id: row.id, state: row.state,
      original_cvr: row.original_cvr, source_row: row.source_row, duplicate_of: row.duplicate_of } } : row;
    const src = JSON.parse(row.source_row || '{}');
    const kept = {};
    for (const col of sourceColumns) kept[col] = src[col] ?? '';
    return {
      ...kept,
      'Original CVR': row.original_cvr,
      'Normaliseret CVR': c.cvr ?? '',
      'Virksomhedsnavn': c.name ?? '',
      'CVR-status': c.cvr_status ?? '',
      'Aktiv': c.active === 1 ? 'Ja' : c.active === 0 ? 'Nej' : '',
      'Startdato': c.start_date ?? '',
      'Ophørsdato': c.end_date ?? '',
      'Momsregistreret': VAT_LABEL[c.vat_status] ?? '',
      'Momsnummer': c.vat_number ?? '',
      'Kvitteringsnummer': c.vat_reference ?? '',
      'Dato for CVR-kontrol': c.cvr_checked_at ?? '',
      'Dato for momskontrol': c.vat_checked_at ?? '',
      'CVR PDF': c.cvr_pdf ? c.cvr_pdf.split(/[/\\]/).pop() : '',
      'Moms PDF': c.vat_pdf ? c.vat_pdf.split(/[/\\]/).pop() : '',
      'Antal forsøg': c.retry_count ?? 0,
      'Fejl': row.error ?? '',
      'Samlet status': overall(row) === 'Dublet' ? `Dublet (se række ${byId.get(row.duplicate_of)?.row_index + 1})` : overall(row),
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Resultat');

  const summary = [
    ['Batch-ID', batch.id],
    ['Inputfil', batch.filename],
    ['Oprettet', batch.created_at],
    ['CVR-kilde', batch.cvr_provider],
    ['Momskilde', batch.vat_provider],
    ['Antal rækker', companies.length],
    ['Aktive', companies.filter((c) => c.active === 1).length],
    ['Inaktive', companies.filter((c) => c.active === 0).length],
    ['Momsregistrerede', companies.filter((c) => c.vat_status === 'REGISTERED').length],
    ['Ikke momsregistrerede', companies.filter((c) => c.vat_status === 'NOT_REGISTERED').length],
    ['Fejl', companies.filter((c) => c.state === 'failed' || c.state === 'invalid').length],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Felt', 'Værdi'], ...summary]), 'Opsummering');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function buildAuditWorkbook(batchId) {
  const log = db.prepare('SELECT * FROM audit_log WHERE batch_id=? ORDER BY id').all(batchId);
  const rows = log.map((l) => ({
    'Tidspunkt': l.ts, 'CVR': l.cvr ?? '', 'Trin': l.step ?? '', 'Kilde': l.provider ?? '',
    'Endpoint': l.target ?? '', 'HTTP': l.http_status ?? '', 'Resultat': l.outcome ?? '',
    'Forsøg': l.attempt ?? '', 'Varighed (ms)': l.duration_ms ?? '',
    'SHA-256': l.payload_sha256 ?? '', 'Detalje': l.detail ?? '',
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Tidspunkt: '', CVR: '' }]), 'Auditlog');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
