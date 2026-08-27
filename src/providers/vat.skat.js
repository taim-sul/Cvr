// Browserautomation mod Skattestyrelsens offentlige momsregister.
//
// ============================ LAES DETTE ============================
// Selectorne herunder er IKKE verificeret mod den koerende side. De skal
// bekraeftes foerste gang du aktiverer denne provider. Alt der skal rettes
// ligger i SELECTORS-objektet nedenfor - resten af appen roerer du ikke.
//
// Siden er en Spring Webflow-applikation. execution-parameteren (e1s1) er
// dynamisk og bliver derfor ALDRIG hardcodet: vi starter altid paa
// indgangs-URL'en og lader serveren tildele sessionen.
//
// Kaldes kun for de CVR-numre hvor VIES siger 'invalid' eller 'unknown',
// medmindre VAT_PROVIDER=skat. Det holder volumen mod SKAT paa et par
// procent af batchen.
// ====================================================================
import { config } from '../config.js';
import { getBrowser } from '../services/browser.js';
import { sha256, RetryableError } from './http.js';

export const id = 'skat';
export const label = 'Skattestyrelsen (ntse.skat.dk)';
export const preflight = () => null;

export const SELECTORS = {
  // Fallback-kaeder. Foerste der findes, bruges.
  cookieAccept: ['button:has-text("Accepter alle")', 'button:has-text("Accepter")', '#declineButton'],
  input: ['input[name*="momsnummer" i]', 'label:has-text("momsnummer") >> xpath=following::input[1]',
          'input[type="text"]:visible'],
  submit: ['button:has-text("Søg")', 'input[type="submit"][value*="øg" i]', 'button[type="submit"]'],
  result: ['main', '[role="main"]', 'body'],
};

async function firstMatch(page, list, timeout = 5000) {
  for (const sel of list) {
    const loc = page.locator(sel).first();
    try { await loc.waitFor({ state: 'visible', timeout }); return loc; } catch { /* proev naeste */ }
  }
  return null;
}

const REGISTERED = /er\s+registreret|gyldigt\s+momsnummer|aktiv/i;
const NOT_REGISTERED = /ikke\s+registreret|ikke\s+gyldigt|findes\s+ikke|ingen\s+registrering/i;

export async function lookup(cvr) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ locale: 'da-DK' });
  const page = await ctx.newPage();
  try {
    // Start altid paa indgangssiden - aldrig en gemt execution-parameter.
    const resp = await page.goto(config.skat.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    const httpStatus = resp?.status() ?? 0;
    if (httpStatus >= 500) throw new RetryableError(`SKAT svarede HTTP ${httpStatus}`, httpStatus);

    const cookie = await firstMatch(page, SELECTORS.cookieAccept, 2000);
    if (cookie) await cookie.click().catch(() => {});

    const input = await firstMatch(page, SELECTORS.input, 8000);
    if (!input) throw new RetryableError('Fandt ikke soegefeltet - SELECTORS.input skal verificeres');
    await input.fill(`DK${cvr}`);

    const submit = await firstMatch(page, SELECTORS.submit, 5000);
    if (!submit) throw new RetryableError('Fandt ikke soegeknappen - SELECTORS.submit skal verificeres');
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => {}),
      submit.click(),
    ]);

    const region = await firstMatch(page, SELECTORS.result, 8000);
    const text = ((await region?.innerText()) || '').replace(/\s+\n/g, '\n').trim();
    const html = await page.content();

    let status = 'UNKNOWN';
    if (NOT_REGISTERED.test(text)) status = 'NOT_REGISTERED';
    else if (REGISTERED.test(text)) status = 'REGISTERED';

    return {
      status,
      target: page.url(),
      meta: { status: httpStatus, durationMs: 0, raw: text, sha256: sha256(html) },
      data: {
        vatNumber: `DK${cvr}`,
        name: null,
        reference: null,
        sourceText: text.slice(0, 4000),
        checkedAt: new Date().toISOString(),
        screenshot: await page.screenshot({ fullPage: true }).catch(() => null),
      },
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}
