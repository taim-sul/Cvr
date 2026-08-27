// Oversaetter den officielle statustekst til aktiv/inaktiv.
// Den PRAECISE tekst gemmes altid uaendret - dette er kun et hjaelpeflag.
const ACTIVE = ['normal', 'aktiv', 'active'];
const INACTIVE = [
  'ophoert', 'ophørt', 'oploest', 'opløst', 'tvangsoploest', 'tvangsopløst',
  'underkonkurs', 'konkurs', 'undertvangsopl', 'underreassumering',
  'underfrivilligliqvidation', 'underlikvidation', 'likvidation',
  'slettet', 'lukket', 'fusioneret', 'spaltet', 'ceased',
];
const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-zæøå]/g, '');

/** 1 = aktiv, 0 = inaktiv, null = kan ikke afgoeres. */
export function mapStatus(statusText) {
  const k = key(statusText);
  if (!k) return null;
  if (ACTIVE.includes(k)) return 1;
  if (INACTIVE.some((x) => k.includes(key(x)))) return 0;
  return null;
}
