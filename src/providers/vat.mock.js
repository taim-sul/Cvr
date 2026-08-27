import { sha256 } from './http.js';

export const id = 'mock';
export const label = 'Mock (ingen eksterne kald)';
export const preflight = () => null;

export async function lookup(cvr) {
  await new Promise((r) => setTimeout(r, 40));
  const registered = Number(cvr[6]) % 5 !== 0;
  const text = registered
    ? `Mock: DK${cvr} er momsregistreret.`
    : `Mock: DK${cvr} er ikke momsregistreret.`;
  return {
    status: registered ? 'REGISTERED' : 'NOT_REGISTERED',
    target: 'mock://moms',
    meta: { status: 200, durationMs: 40, raw: text, sha256: sha256(text) },
    data: {
      vatNumber: `DK${cvr}`,
      name: `Testvirksomhed ${cvr.slice(-4)} ApS`,
      reference: `MOCK-${cvr}`,
      sourceText: text,
      checkedAt: new Date().toISOString(),
    },
  };
}
