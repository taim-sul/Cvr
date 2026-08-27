import { config } from '../config.js';
import * as cvrVirk from './cvr.virk.js';
import * as cvrApi from './cvr.cvrapi.js';
import * as cvrMock from './cvr.mock.js';
import * as vatVies from './vat.vies.js';
import * as vatSkat from './vat.skat.js';
import * as vatMock from './vat.mock.js';

const CVR = { virk: cvrVirk, cvrapi: cvrApi, mock: cvrMock };
const VAT = { vies: vatVies, skat: vatSkat, mock: vatMock };

export function cvrProvider(name = config.cvrProvider) {
  const p = CVR[name];
  if (!p) throw new Error(`Ukendt CVR_PROVIDER: ${name}. Vaelg virk, cvrapi eller mock.`);
  return p;
}
export function vatProvider(name = config.vatProvider) {
  const p = VAT[name];
  if (!p) throw new Error(`Ukendt VAT_PROVIDER: ${name}. Vaelg vies, skat eller mock.`);
  return p;
}
export function providerStatus() {
  const c = cvrProvider(); const v = vatProvider();
  return {
    cvr: { id: c.id, label: c.label, warning: c.preflight() },
    vat: { id: v.id, label: v.label, warning: v.preflight() },
    available: { cvr: Object.keys(CVR), vat: Object.keys(VAT) },
  };
}
