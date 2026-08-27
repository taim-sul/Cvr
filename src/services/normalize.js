// CVR-normalisering og validering. Ingen netvaerksafhaengighed - kan unit-testes isoleret.

const CVR_WEIGHTS = [2, 7, 6, 5, 4, 3, 2, 1];

/** Fjerner DK-praefiks, mellemrum, punktummer, bindestreger osv. */
export function normalizeCvr(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim().toUpperCase();
  s = s.replace(/^DK[\s.\-]*/i, '');
  s = s.replace(/[^0-9]/g, '');
  return s;
}

/** Modulus-11 kontrol som Erhvervsstyrelsen anvender paa CVR-numre. */
export function isValidCvr(cvr) {
  if (!/^\d{8}$/.test(cvr)) return false;
  if (cvr === '00000000') return false;
  const sum = CVR_WEIGHTS.reduce((acc, w, i) => acc + w * Number(cvr[i]), 0);
  return sum % 11 === 0;
}

export function cvrError(original, normalized) {
  if (!normalized) return 'Tomt eller ulaeseligt CVR-felt';
  if (normalized.length !== 8) return `Forventede 8 cifre, fik ${normalized.length} ("${original}")`;
  if (!isValidCvr(normalized)) return 'Ugyldigt kontrolciffer (modulus-11)';
  return null;
}

export const toVatNumber = (cvr) => `DK${cvr}`;

/** Filnavnssikker streng. Ingen path traversal, ingen reserverede tegn. */
export function sanitizeSegment(input, fallback = 'ukendt') {
  const s = String(input ?? '')
    .normalize('NFC')
    .replace(/[\u00C6]/g, 'AE').replace(/[\u00E6]/g, 'ae')
    .replace(/[\u00D8]/g, 'OE').replace(/[\u00F8]/g, 'oe')
    .replace(/[\u00C5]/g, 'AA').replace(/[\u00E5]/g, 'aa')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

export function evidenceBasename(cvr, name, kind) {
  return `${cvr}_${sanitizeSegment(name, 'ukendt_navn')}_${kind}.pdf`;
}
