// VIES (EU-Kommissionen) - officielt REST-endpoint, ingen noegle noedvendig.
// Angiver du dit EGET momsnummer, returnerer VIES et "requestIdentifier"
// (consultation number). Det er den kvittering en revisor eller SKAT kan
// verificere - langt staerkere dokumentation end et screenshot.
//
// VIGTIGT: VIES viser registrering til EU-handel. Det er i praksis sammen-
// faldende med dansk momsregistrering, men ikke definitorisk identisk.
// Ved 'invalid' boer resultatet efterproeves i ntse.skat.dk (se vat.skat.js).
import { config } from '../config.js';
import { fetchJson, RetryableError } from './http.js';

export const id = 'vies';
export const label = 'VIES (EU-Kommissionen)';

export function preflight() {
  if (!config.vies.requesterVat)
    return 'VIES_REQUESTER_VAT er tom. Uden dit eget momsnummer faar du intet consultation number, og dokumentationen bliver svagere.';
  return null;
}

export async function lookup(cvr) {
  const body = {
    countryCode: 'DK',
    vatNumber: cvr,
    ...(config.vies.requesterVat
      ? { requesterMemberStateCode: config.vies.requesterCountry, requesterNumber: config.vies.requesterVat }
      : {}),
  };
  const res = await fetchJson(config.vies.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const j = res.json;
  if (!j) throw new RetryableError(`Uventet svar fra VIES (HTTP ${res.status})`, res.status);

  // VIES returnerer 200 med en errorWrappers-blok ved midlertidige fejl.
  const errors = j.errorWrappers || j.errors || [];
  if (Array.isArray(errors) && errors.length) {
    const code = errors[0].error || errors[0].code || 'UKENDT';
    const temporary = /MS_UNAVAILABLE|MS_MAX_CONCURRENT_REQ|GLOBAL_MAX_CONCURRENT_REQ|SERVICE_UNAVAILABLE|TIMEOUT|SERVER_BUSY/i.test(code);
    if (temporary) throw new RetryableError(`VIES midlertidigt utilgaengelig: ${code}`, res.status);
    return {
      status: 'UNKNOWN', target: config.vies.url, meta: res,
      data: { vatNumber: `DK${cvr}`, name: null, reference: null,
        sourceText: `VIES svarede med fejlkode ${code}`, checkedAt: new Date().toISOString() },
    };
  }

  const valid = j.valid === true;
  return {
    status: valid ? 'REGISTERED' : 'NOT_REGISTERED',
    target: config.vies.url,
    meta: res,
    data: {
      vatNumber: `DK${cvr}`,
      name: j.name && j.name !== '---' ? j.name : null,
      address: j.address && j.address !== '---' ? j.address : null,
      reference: j.requestIdentifier || null,
      sourceText: valid
        ? `VIES: momsnummer DK${cvr} er gyldigt pr. ${j.requestDate || 'n/a'}.`
        : `VIES: momsnummer DK${cvr} er IKKE gyldigt pr. ${j.requestDate || 'n/a'}.`,
      requestDate: j.requestDate || null,
      checkedAt: new Date().toISOString(),
    },
  };
}
