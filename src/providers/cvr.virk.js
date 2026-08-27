// Officiel kilde: Erhvervsstyrelsens "System-til-system adgang til CVR-data".
// Adgang bestilles hos cvrselvbetjening@erst.dk. Basic auth, Elasticsearch-interface.
import { config } from '../config.js';
import { fetchJson, PermanentError } from './http.js';
import { mapStatus } from './status-map.js';

export const id = 'virk';
export const label = 'Erhvervsstyrelsen (system-til-system)';

export function preflight() {
  if (!config.virk.user || !config.virk.password)
    return 'VIRK_USER og VIRK_PASSWORD mangler. Bestil adgang hos cvrselvbetjening@erst.dk.';
  return null;
}

export async function lookup(cvr) {
  const body = {
    _source: [
      'Vrvirksomhed.cvrNummer',
      'Vrvirksomhed.virksomhedMetadata.nyesteNavn.navn',
      'Vrvirksomhed.virksomhedMetadata.sammensatStatus',
      'Vrvirksomhed.virksomhedMetadata.stiftelsesDato',
      'Vrvirksomhed.livsforloeb',
      'Vrvirksomhed.virksomhedsstatus',
    ],
    query: { bool: { must: [{ term: { 'Vrvirksomhed.cvrNummer': cvr } }] } },
    size: 1,
  };
  const auth = Buffer.from(`${config.virk.user}:${config.virk.password}`).toString('base64');
  const res = await fetchJson(config.virk.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw new PermanentError('Afvist af Virk (tjek brugernavn/password)', res.status);

  const hit = res.json?.hits?.hits?.[0]?._source?.Vrvirksomhed;
  if (!hit) {
    return { found: false, target: config.virk.url, meta: res,
      data: { cvr, name: null, status: 'IKKE_FUNDET', active: null, startDate: null, endDate: null } };
  }
  const md = hit.virksomhedMetadata || {};
  const liv = Array.isArray(hit.livsforloeb) ? hit.livsforloeb : [];
  const sidste = liv[liv.length - 1]?.periode || {};
  const statusText = md.sammensatStatus
    || hit.virksomhedsstatus?.[hit.virksomhedsstatus.length - 1]?.status
    || 'UKENDT';

  return {
    found: true,
    target: config.virk.url,
    meta: res,
    data: {
      cvr: String(hit.cvrNummer ?? cvr),
      name: md.nyesteNavn?.navn ?? null,
      status: statusText,
      active: mapStatus(statusText),
      startDate: md.stiftelsesDato ?? sidste.gyldigFra ?? null,
      endDate: sidste.gyldigTil ?? null,
    },
  };
}
