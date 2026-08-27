// Én delt Chromium-instans. Startes doven, genbruges, lukkes ved shutdown.
import { chromium } from 'playwright';

let browserPromise = null;

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => {});
}
