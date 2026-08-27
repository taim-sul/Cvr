const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fejl ${res.status}`);
  return data;
};

let token = null, batchId = null, poll = null;

// ---------- Datakilder ----------
async function loadProviders() {
  const s = await api('/api/batches/providers');
  $('sources').innerHTML = `CVR: <b>${s.cvr.label}</b><br>Moms: <b>${s.vat.label}</b>`;
  const warn = [s.cvr.warning, s.vat.warning].filter(Boolean);
  $('providerWarnings').innerHTML = warn.map((w) => `<div class="notice">${w}</div>`).join('');
  const fill = (el, list, current) => {
    el.innerHTML = list.map((v) => `<option value="${v}"${v === current ? ' selected' : ''}>${v}</option>`).join('');
  };
  fill($('cvrProv'), s.available.cvr, s.cvr.id);
  fill($('vatProv'), s.available.vat, s.vat.id);
}

// ---------- Upload ----------
const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) analyze(e.dataTransfer.files[0]); });
$('file').addEventListener('change', (e) => { if (e.target.files[0]) analyze(e.target.files[0]); });

async function analyze(file) {
  $('uploadStatus').textContent = `Læser ${file.name}…`;
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await api('/api/upload/analyze', { method: 'POST', body: fd });
    token = r.token;
    $('uploadStatus').textContent = `${r.filename} · ${r.rowCount} rækker · ${r.columns.length} kolonner`;
    $('cvrColumn').innerHTML = r.columns.map((c) => `<option${c === r.suggestion ? ' selected' : ''}>${c}</option>`).join('');
    $('mapHint').textContent = r.confident
      ? `Kolonnen "${r.suggestion}" ser ud til at indeholde CVR-numrene. Ret den hvis det er forkert.`
      : 'Kolonnen kunne ikke bestemmes sikkert. Vælg den rigtige nedenfor.';
    $('mapCard').classList.remove('hidden');
  } catch (err) { $('uploadStatus').textContent = err.message; }
}

$('confirmBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/upload/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, cvrColumn: $('cvrColumn').value,
        cvrProvider: $('cvrProv').value, vatProvider: $('vatProv').value }),
    });
    openBatch(r.batchId);
  } catch (err) { alert(err.message); }
});

// ---------- Batch ----------
function openBatch(id) {
  batchId = id;
  $('mapCard').classList.add('hidden');
  $('runCard').classList.remove('hidden');
  $('tableCard').classList.remove('hidden');
  $('xlsxLink').href = `/api/download/batch/${id}/resultat.xlsx`;
  $('zipLink').href = `/api/download/batch/${id}/dokumentation.zip`;
  $('auditLink').href = `/api/download/batch/${id}/auditlog.xlsx`;
  refresh();
  clearInterval(poll);
  poll = setInterval(refresh, 1500);
}

$('startBtn').addEventListener('click', () => api(`/api/batches/${batchId}/start`, { method: 'POST' }).then(refresh));
$('pauseBtn').addEventListener('click', () => api(`/api/batches/${batchId}/pause`, { method: 'POST' }).then(refresh));
$('retryBtn').addEventListener('click', () => api(`/api/batches/${batchId}/retry-failed`, { method: 'POST' }).then(refresh));

const STATE = {
  pending:   ['Afventer', 'n'],
  cvr_running:['Behandler CVR', 'run'],
  cvr_done:  ['CVR godkendt', 'run'],
  vat_running:['Kontrollerer moms', 'run'],
  done:      ['Færdig', 'ok'],
  failed:    ['Fejl', 'bad'],
  invalid:   ['Ugyldigt CVR', 'bad'],
  duplicate: ['Dublet', 'n'],
};
const VAT = {
  REGISTERED: ['Momsregistreret', 'ok'],
  NOT_REGISTERED: ['Ikke momsregistreret', 'bad'],
  UNKNOWN: ['Ukendt', 'warn'],
};

function track(c) {
  const a = c.cvr_pdf ? 'on' : (c.state === 'failed' && !c.cvr_pdf ? 'err' : '');
  const b = c.vat_pdf ? 'on' : (c.state === 'failed' && c.cvr_pdf ? 'err' : '');
  return `<span class="track" title="CVR-trin / moms-trin"><i class="${a}"></i><i class="${b}"></i></span>`;
}

async function refresh() {
  if (!batchId) return;
  const { batch, counts, companies } = await api(`/api/batches/${batchId}`);

  $('stats').innerHTML = [
    ['Virksomheder', counts.total, ''],
    ['Aktive', counts.active, 'ok'],
    ['Inaktive', counts.inactive, 'bad'],
    ['Momsregistreret', counts.vatRegistered, 'ok'],
    ['Ikke momsregistreret', counts.vatNotRegistered, 'warn'],
    ['Fejl', counts.failed + counts.invalid, 'bad'],
  ].map(([l, n, cls]) => `<div class="stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

  const pct = counts.total ? Math.round((counts.processed / counts.total) * 100) : 0;
  $('barFill').style.width = pct + '%';
  $('progressText').textContent = `${counts.processed} / ${counts.total} virksomheder behandlet`;
  $('progressPct').textContent = pct + ' %';
  $('startBtn').disabled = batch.running;
  $('pauseBtn').disabled = !batch.running;
  $('retryBtn').disabled = batch.running || counts.failed === 0;

  $('tbody').innerHTML = companies.map((c) => {
    const [sl, sc] = STATE[c.state] || [c.state, 'n'];
    const [vl, vc] = VAT[c.vat_status] || ['—', 'n'];
    const links = [
      c.cvr_pdf ? `<a href="/api/download/company/${c.id}/cvr">CVR</a>` : '',
      c.vat_pdf ? `<a href="/api/download/company/${c.id}/moms">Moms</a>` : '',
    ].filter(Boolean).join('');
    return `<tr>
      <td class="cvr">${c.cvr || `<span class="muted">${c.original_cvr || '—'}</span>`}</td>
      <td>${c.name || '<span class="muted">—</span>'}</td>
      <td>${c.cvr_status ? `<span class="badge ${c.active === 1 ? 'ok' : c.active === 0 ? 'bad' : 'warn'}">${c.cvr_status}</span>` : '<span class="muted">—</span>'}</td>
      <td><span class="badge ${vc}">${vl}</span></td>
      <td>${track(c)}</td>
      <td class="pdf-links">${links || '<span class="muted">—</span>'}</td>
      <td><span class="badge ${sc}">${sl}</span></td>
      <td class="muted">${c.error ? c.error.slice(0, 90) : ''}</td>
    </tr>`;
  }).join('');

  if (!batch.running && counts.processed === counts.total) clearInterval(poll);
}

loadProviders().catch((e) => { $('sources').textContent = e.message; });
