import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const int = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  root,
  port: int(process.env.PORT, 3000),
  dirs: {
    data: path.join(root, 'data'),
    uploads: path.join(root, 'uploads'),
    output: path.join(root, 'output'),
    public: path.join(root, 'public'),
  },
  cvrProvider: process.env.CVR_PROVIDER || 'mock',
  vatProvider: process.env.VAT_PROVIDER || 'mock',
  virk: {
    url: process.env.VIRK_URL || 'http://distribution.virk.dk/cvr-permanent/virksomhed/_search',
    user: process.env.VIRK_USER || '',
    password: process.env.VIRK_PASSWORD || '',
  },
  cvrapi: {
    url: process.env.CVRAPI_URL || 'https://cvrapi.dk/api',
    userAgent: process.env.CVRAPI_USER_AGENT || '',
  },
  vies: {
    url: process.env.VIES_URL || 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number',
    requesterCountry: process.env.VIES_REQUESTER_COUNTRY || 'DK',
    requesterVat: (process.env.VIES_REQUESTER_VAT || '').replace(/\D/g, ''),
  },
  skat: { url: process.env.SKAT_URL || 'https://ntse.skat.dk/ntse-front/public/momsnummer/soeg' },
  concurrency: int(process.env.CONCURRENCY, 3),
  requestDelayMs: int(process.env.REQUEST_DELAY_MS, 250),
  maxRetries: int(process.env.MAX_RETRIES, 3),
  timeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 20000),
  pdfEnabled: String(process.env.PDF_ENABLED ?? 'true').toLowerCase() !== 'false',
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
};
