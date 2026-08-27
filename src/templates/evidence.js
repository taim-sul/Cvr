const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(v)}</td></tr>`;

/**
 * Dokumentationsside. Bemaerk: vi gengiver ikke kildesidens layout, vi gengiver
 * kildens SVAR plus en hash af det raa payload. Det er verificerbart; et
 * screenshot er det ikke.
 */
export function evidenceHtml({ kind, cvr, name, rows, sourceText, rawPayload, sha256, target, provider, timestamp, reference, screenshotBase64 }) {
  const title = kind === 'CVR' ? 'Dokumentation for CVR-kontrol' : 'Dokumentation for momskontrol';
  return `<!doctype html><html lang="da"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 "Helvetica Neue", Arial, sans-serif; color: #14181f; margin: 0; }
  header { border-bottom: 2px solid #14181f; padding-bottom: 10px; margin-bottom: 18px;
           display: flex; justify-content: space-between; align-items: flex-end; }
  h1 { font-size: 15pt; margin: 0; letter-spacing: -0.2px; }
  .stamp { font: 8.5pt/1.4 "SFMono-Regular", Menlo, monospace; text-align: right; color: #5b6472; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.8px; color: #5b6472;
       margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #e4e7ec; }
  th { width: 34%; font-weight: 600; color: #3d4553; }
  .muted { color: #98a0ae; }
  pre { background: #f6f7f9; border: 1px solid #e4e7ec; padding: 10px; font: 8pt/1.45 "SFMono-Regular", Menlo, monospace;
        white-space: pre-wrap; word-break: break-all; margin: 0; }
  .hash { font: 8pt/1.5 "SFMono-Regular", Menlo, monospace; word-break: break-all; }
  img.shot { width: 100%; border: 1px solid #e4e7ec; margin-top: 8px; }
  footer { position: fixed; bottom: -12mm; left: 0; right: 0; font-size: 7.5pt; color: #98a0ae;
           border-top: 1px solid #e4e7ec; padding-top: 5px; }
</style></head><body>
<header>
  <div><h1>${esc(title)}</h1><div class="muted">CVR ${esc(cvr)} · ${esc(name || 'navn ikke oplyst')}</div></div>
  <div class="stamp">${esc(timestamp)}<br>${esc(provider)}</div>
</header>

<h2>Resultat</h2>
<table>${rows.map(([k, v]) => row(k, v)).join('')}</table>

<h2>Kildens svar</h2>
<pre>${esc(sourceText || '(ingen tekst returneret)')}</pre>

<h2>Verifikation</h2>
<table>
  ${row('Forespurgt endpoint', target)}
  ${row('Kvitteringsnummer', reference)}
  ${row('SHA-256 af raa svar', '')}
</table>
<div class="hash">${esc(sha256)}</div>

${screenshotBase64 ? `<h2>Skaermbillede af kildesiden</h2><img class="shot" src="data:image/png;base64,${screenshotBase64}">` : ''}

<h2>Raa svar fra kilden</h2>
<pre>${esc((rawPayload || '').slice(0, 6000))}</pre>

<footer>Genereret automatisk. Hashen ovenfor daekker det raa svar som kilden returnerede paa opslagstidspunktet. CVR ${esc(cvr)} er noeglen for hele dette dokument.</footer>
</body></html>`;
}
