import crypto from 'node:crypto';
import { config } from '../config.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s ?? '').digest('hex');

/** Fejl der er vaerd at proeve igen: netvaerk, timeout, 429, 5xx. */
export class RetryableError extends Error {
  constructor(message, status) { super(message); this.retryable = true; this.status = status; }
}
export class PermanentError extends Error {
  constructor(message, status) { super(message); this.retryable = false; this.status = status; }
}

export async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), options.timeoutMs ?? config.timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    const meta = { status: res.status, durationMs: Date.now() - started, raw: text, sha256: sha256(text) };
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new RetryableError(`HTTP ${res.status}`, res.status), { meta });
    }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ikke JSON */ }
    return { ...meta, json, ok: res.ok };
  } catch (err) {
    if (err.retryable !== undefined) throw err;
    if (err.name === 'AbortError') throw new RetryableError('Timeout');
    throw new RetryableError(err.message);
  } finally {
    clearTimeout(t);
  }
}
