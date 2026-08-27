// Deterministisk mock, saa hele appen kan testes uden eksterne kald.
import { mapStatus } from './status-map.js';
import { sha256 } from './http.js';

export const id = 'mock';
export const label = 'Mock (ingen eksterne kald)';
export const preflight = () => null;

const STATUSES = ['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'UNDER KONKURS', 'OPHOERT', 'TVANGSOPLOEST'];

export async function lookup(cvr) {
  await new Promise((r) => setTimeout(r, 40 + (Number(cvr) % 60)));
  const status = STATUSES[Number(cvr[7]) % STATUSES.length];
  const raw = JSON.stringify({ cvr, status, mock: true });
  return {
    found: true,
    target: 'mock://cvr',
    meta: { status: 200, durationMs: 40, raw, sha256: sha256(raw) },
    data: {
      cvr,
      name: `Testvirksomhed ${cvr.slice(-4)} ApS`,
      status,
      active: mapStatus(status),
      startDate: '2015-04-01',
      endDate: status === 'NORMAL' ? null : '2024-11-30',
    },
  };
}
