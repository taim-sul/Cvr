import XLSX from 'xlsx';
import { normalizeCvr, cvrError } from './normalize.js';

const CANDIDATES = [
  'cvr', 'cvrnr', 'cvrnummer', 'cvrnumber', 'vat', 'vatnumber', 'momsnr', 'momsnummer',
  'organisationsnummer', 'orgnr', 'virksomhedsnummer', 'se', 'senr', 'senummer',
];

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** CSV-filer kan vaere UTF-8 (med/uden BOM) eller Windows-1252. Vi proever i den raekkefoelge. */
function decodeCsv(buffer) {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
  return text.replace(/^\uFEFF/, '');
}

/** Laeser .xlsx/.xls/.csv som raekker af objekter. */
export function readTable(buffer, filename) {
  const isCsv = /\.csv$/i.test(filename || '');
  const wb = isCsv
    ? XLSX.read(decodeCsv(buffer), { type: 'string', cellDates: true, raw: false })
    : XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Filen indeholder ingen ark');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  if (!rows.length) throw new Error('Arket er tomt');
  return { rows, columns: Object.keys(rows[0]), sheetName, filename };
}

/**
 * Gaetter CVR-kolonnen. Returnerer null hvis gaettet ikke er sikkert,
 * saa brugeren selv kan vaelge - vi gaetter ikke videre paa maa og faa.
 */
export function detectCvrColumn(rows, columns) {
  const scored = columns.map((col) => {
    const k = key(col);
    let score = 0;
    if (CANDIDATES.includes(k)) score += 100;
    else if (CANDIDATES.some((c) => k.includes(c))) score += 60;

    const sample = rows.slice(0, 200);
    const hits = sample.filter((r) => /^\d{8}$/.test(normalizeCvr(r[col]))).length;
    const ratio = sample.length ? hits / sample.length : 0;
    score += Math.round(ratio * 80);
    return { col, score, ratio };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  const confident = best && best.score >= 90 && best.ratio >= 0.5 &&
    (!runnerUp || best.score - runnerUp.score >= 25);
  return { suggestion: best?.col ?? null, confident: Boolean(confident), scored };
}

/** Bygger de raekker der skal i databasen, inkl. dublet- og fejlmarkering. */
export function buildRows(rows, cvrColumn) {
  const seen = new Map();
  return rows.map((row, i) => {
    const original = String(row[cvrColumn] ?? '').trim();
    const cvr = normalizeCvr(original);
    const err = cvrError(original, cvr);
    const firstIndex = err ? undefined : seen.get(cvr);
    if (!err && firstIndex === undefined) seen.set(cvr, i);
    return {
      row_index: i,
      original_cvr: original,
      cvr: err ? null : cvr,
      source_row: JSON.stringify(row),
      duplicate_of_row: firstIndex === undefined ? null : firstIndex,
      state: err ? 'invalid' : (firstIndex === undefined ? 'pending' : 'duplicate'),
      error: err,
    };
  });
}
