import express from 'express';
import fs from 'node:fs';
import { config } from './config.js';
import { router as uploadRouter } from './routes/upload.js';
import { router as batchRouter } from './routes/batches.js';
import { router as downloadRouter } from './routes/downloads.js';
import { closeBrowser } from './services/browser.js';
import { providerStatus } from './providers/index.js';

for (const d of Object.values(config.dirs)) fs.mkdirSync(d, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.static(config.dirs.public));
app.use('/api/upload', uploadRouter);
app.use('/api/batches', batchRouter);
app.use('/api/download', downloadRouter);

app.use((err, _req, res, _next) => {
  console.error('[fejl]', err.message);
  const status = err.status || (/accepteres|for stor|LIMIT_FILE_SIZE/i.test(err.message) ? 400 : 500);
  res.status(status).json({ error: err.message });
});

const server = app.listen(config.port, () => {
  const s = providerStatus();
  console.log(`\nCVR-kontrol kører på http://localhost:${config.port}`);
  console.log(`  CVR-kilde:  ${s.cvr.label}${s.cvr.warning ? `  ⚠ ${s.cvr.warning}` : ''}`);
  console.log(`  Momskilde:  ${s.vat.label}${s.vat.warning ? `  ⚠ ${s.vat.warning}` : ''}\n`);
});

const shutdown = async () => { await closeBrowser(); server.close(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
