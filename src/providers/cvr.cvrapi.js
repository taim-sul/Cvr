// cvrapi.dk - gratis for lav volumen, kraever en identificerende User-Agent.
// Tjek deres vilkaar foer kommerciel eller hoej-volumen brug.
import { config } from '../config.js';
import { fetchJson, PermanentError, RetryableError } from './http.js';
import { mapStatus } from './status-map.js';

export const id = 'cvrapi';
export const label = 'cvrapi.dk';

export function preflight() {
  if (!config.cvrapi.userAgent || /^\s*$/.test(config.cvrapi.userAgent))
    return 'CVRAPI_USER_AGENT skal saettes til noget der identificerer dig (navn + kontaktmail).';
  return null;
}

export async function lookup(cvr) {
  const url = `${config.cvrapi.url}?search=${encodeURIComponent(cvr)}&country=dk`;
  const res = await fetchJson(url, { headers: { 'User-Agent': config.cvrapi.userAgent, Accept: 'application/json' } });

  if (res.status === 403) throw new PermanentError('cvrapi.dk afviste kaldet (User-Agent eller kvote)', 403);
  if (res.status === 404 || res.json?.error === 'NOT_FOUND') {
    return { found: false, target: url, meta: res,
      data: { cvr, name: null, status: 'IKKE_FUNDET', active: null, startDate: null, endDate: null } };
  }
  if (!res.json) throw new RetryableError('Uventet svar fra cvrapi.dk', res.status);

  const d = res.json;
  const statusText = d.companydesc && d.enddate ? 'OPHOERT' : (d.companydesc ? 'NORMAL' : (d.status || 'UKENDT'));
  const officialStatus = d.status || statusText;
  return {
    found: true, target: url, meta: res,
    data: {
      cvr: String(d.vat ?? cvr),
      name: d.name ?? null,
      status: officialStatus,
      active: d.enddate ? 0 : mapStatus(officialStatus),
      startDate: d.startdate ?? null,
      endDate: d.enddate ?? null,
    },
  };
}
