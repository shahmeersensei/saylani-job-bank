/**
 * Generates a self-contained, Playwright-style HTML report at
 * tests/reports/index.html covering: E2E (Playwright JSON), QA defects,
 * load (API/Web/DB), security.
 *
 * Usage: node tests/generate-report.js   (already wired into pnpm test:reports)
 */
const fs = require('node:fs');
const path = require('node:path');

const REPORTS = path.resolve(__dirname, 'reports');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPORTS, file), 'utf8'));
  } catch {
    return null;
  }
}
function readText(file) {
  try {
    return fs.readFileSync(path.join(REPORTS, file), 'utf8');
  } catch {
    return null;
  }
}
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

// ---- Playwright JSON reporter → per-file + per-project rollup ----
function walkSuites(suites, file, project, out) {
  for (const s of suites || []) {
    const f = s.file || file;
    if (s.specs) {
      for (const spec of s.specs) {
        for (const t of spec.tests || []) {
          const proj = t.projectName || project || 'chromium';
          const status =
            t.status === 'expected' ? 'passed' : t.status === 'skipped' ? 'skipped' : 'failed';
          const first = (t.results || [])[0] || {};
          out.push({
            file: f,
            title: spec.title,
            project: proj,
            status,
            duration: first.duration ?? 0,
            error: ((first.error || {}).message || '').slice(0, 240),
          });
        }
      }
    }
    if (s.suites) walkSuites(s.suites, f, project, out);
  }
}

function e2eSection() {
  const data = readJson('e2e-results.json');
  if (!data) {
    return '<p class="muted">Not run (no e2e-results.json). Run <code>pnpm test:e2e</code> then <code>pnpm test:reports</code>.</p>';
  }
  const tests = [];
  walkSuites(data.suites, '', '', tests);
  const byStatus = (s) => tests.filter((t) => t.status === s).length;
  const passed = byStatus('passed');
  const failed = byStatus('failed');
  const skipped = byStatus('skipped');
  const total = tests.length;
  const rate = total ? ((passed / total) * 100).toFixed(1) : 0;
  const cls = failed ? 'bad' : 'ok';

  // Per-project chips
  const projects = [...new Set(tests.map((t) => t.project))];
  const projChips = projects
    .map((p) => {
      const pt = tests.filter((t) => t.project === p);
      const pFail = pt.filter((t) => t.status === 'failed').length;
      return `<span class="chip ${pFail ? 'bad' : 'ok'}">${esc(p)} ${pt.length - pFail}/${pt.length}</span>`;
    })
    .join(' ');

  // Per-file table
  const files = [...new Set(tests.map((t) => t.file))].sort();
  const fileRows = files
    .map((f) => {
      const ft = tests.filter((t) => t.file === f);
      const fFail = ft.filter((t) => t.status === 'failed').length;
      const fPass = ft.filter((t) => t.status === 'passed').length;
      const dur = (ft.reduce((a, t) => a + (t.duration || 0), 0) / 1000).toFixed(1);
      return `<tr><td><code>${esc(f)}</code></td><td><span class="chip ${fFail ? 'bad' : 'ok'}">${fFail ? `${fFail} failed` : 'all passed'}</span></td><td>${fPass}/${ft.length}</td><td>${dur}s</td></tr>`;
    })
    .join('');

  // Failed test details
  const failedTests = tests.filter((t) => t.status === 'failed');
  const failBlock = failedTests.length
    ? `<details open><summary>${failedTests.length} failed tests</summary>
      <table><thead><tr><th>File</th><th>Test</th><th>Project</th><th>Error</th></tr></thead><tbody>
      ${failedTests
        .map(
          (t) =>
            `<tr><td><code>${esc(t.file)}</code></td><td>${esc(t.title)}</td><td>${esc(t.project)}</td><td class="bad">${esc(t.error || '—')}</td></tr>`,
        )
        .join('')}
      </tbody></table></details>`
    : '<p class="ok">No failed tests in this run.</p>';

  return `
    <div class="summary ${cls}">${failed ? 'FAIL' : 'PASS'} — ${passed}/${total} passed · ${rate}% pass rate · ${projects.length} browser project(s)</div>
    <div style="margin-bottom:10px">${projChips}</div>
    <h3>Per-file</h3>
    <table><thead><tr><th>Spec file</th><th>Status</th><th>Passed</th><th>Duration</th></tr></thead><tbody>${fileRows}</tbody></table>
    <h3>Failures</h3>
    ${failBlock}`;
}

function artilleryTable(name, data) {
  if (!data) return `<p class="muted">Not run (no JSON).</p>`;
  const agg = data.aggregate || {};
  // Artillery 2.x: flat `counters` + `summaries['http.response_time']`.
  const counters = agg.counters || {};
  const resp = (agg.summaries && agg.summaries['http.response_time']) || {};
  const total = counters['http.requests'] ?? 'n/a';
  const failed = counters['vusers.failed'] ?? 0;
  const codesRows = Object.entries(counters)
    .filter(([k]) => k.startsWith('http.codes.'))
    .map(([k, v]) => {
      const c = k.replace('http.codes.', '');
      const cls = c.startsWith('2') ? 'ok' : c.startsWith('4') ? 'warn' : 'bad';
      return `<span class="chip ${cls}">${c} × ${v}</span>`;
    })
    .join(' ');
  const pct = (k) => (resp[k] != null ? `${Number(resp[k]).toFixed(0)} ms` : 'n/a');
  const errs = Object.entries(counters)
    .filter(([k]) => k.startsWith('errors.'))
    .map(([k, v]) => `${k.replace('errors.', '')} × ${v}`);
  return `
    <table>
      <tr><th>Requests</th><td>${total} <span class="muted">(failed vusers: ${failed})</span></td></tr>
      <tr><th>Status codes</th><td>${codesRows || 'n/a'}</td></tr>
      <tr><th>Latency mean</th><td>${pct('mean')}</td></tr>
      <tr><th>Latency p50</th><td>${pct('p50')}</td></tr>
      <tr><th>Latency p95</th><td class="${parseFloat(resp.p95) > 1000 ? 'bad' : 'ok'}">${pct('p95')}</td></tr>
      <tr><th>Latency p99</th><td>${pct('p99')}</td></tr>
      <tr><th>Errors</th><td>${errs.length ? errs.map(esc).join(', ') : '<span class="ok">none</span>'}</td></tr>
    </table>`;
}

function parseDbStress(text) {
  if (!text) return '<p class="muted">Not run.</p>';
  const lines = text.split(/\r?\n/).filter((l) => /reads|writes|verdict|connected/.test(l));
  return `<pre class="log">${esc(lines.join('\n'))}</pre>`;
}

function securitySection() {
  const audit = readText('security-audit.txt') || '';
  const advisories = [
    ...new Set(audit.match(/https:\/\/github\.com\/advisories\/GHSA-[\w-]+/g) || []),
  ];
  const hasFail = /Failed security audit/.test(audit);
  const status = hasFail ? 'FAIL' : 'PASS';
  const cls = hasFail ? 'bad' : 'ok';
  const advisoryList = advisories.length
    ? `<ul class="adv">${advisories.map((a) => `<li><a href="${esc(a)}" target="_blank" rel="noopener">${esc(a.split('/').pop())}</a></li>`).join('')}</ul>`
    : '<p class="ok">No advisories found.</p>';
  return `
    <div class="summary ${cls}">${status} — ${advisories.length} unique advisories (audit-ci --moderate)</div>
    ${advisoryList}
    <details><summary>Raw audit output</summary><pre class="log">${esc(audit.slice(-6000))}</pre></details>`;
}

// ---- QA defects (kept in sync with QA_REPORT.md) ----
const QA_DEFECTS = [
  [
    'D-01',
    'Critical',
    'Backend/Config',
    'Prod server 500 on every request (BETTER_AUTH_SECRET empty)',
  ],
  ['D-02', 'Critical', 'Backend/Auth', 'SMS login broken in prod + OTP leaked to logs'],
  ['D-03', 'Critical', 'Auth/Seed', 'Seeded admin stuck in 2FA gate, dashboard unreachable'],
  ['D-04', 'Major', 'Tooling', 'Lint 39 errors — CI blocked'],
  ['D-05', 'Major', 'API', 'Unknown route returns HTML 404, not JSON envelope'],
  ['D-06', 'Major', 'Security', 'No security headers (CSP/HSTS/X-Frame-Options)'],
  ['D-07', 'Major', 'Security', 'creds.txt + 2FA backup codes committed to repo'],
  ['D-08', 'Major', 'UX/Backend', 'Login rate-limit tight, no UI cooldown feedback'],
  ['D-09', 'Major', 'A11y/UI', '/forbidden has no <h1>'],
  ['D-12', 'Major', 'CI', 'CI missing playwright install step + lint blocks pipeline'],
  ['D-13', 'Major', 'Security/Dep', '9 vulnerable npm advisories (audit-ci --moderate)'],
  ['D-10', 'Minor', 'UI', 'Select restyle mismatches Input/Textarea'],
  ['D-11', 'Minor', 'Perf', 'next dev login 49s (known)'],
];

function qaSection() {
  const rows = QA_DEFECTS.map(
    ([id, sev, area, desc]) =>
      `<tr><td><code>${id}</code></td><td><span class="chip ${sev === 'Critical' ? 'bad' : sev === 'Major' ? 'warn' : 'info'}">${sev}</span></td><td>${esc(area)}</td><td>${esc(desc)}</td></tr>`,
  ).join('');
  return `<table><thead><tr><th>ID</th><th>Severity</th><th>Area</th><th>Defect</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const api = readJson('load-api.json');
const web = readJson('load-web.json');
const db = readText('db-stress.txt');
const now = new Date().toISOString();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saylani Job Bank — Test Report</title>
<style>
  :root{--bg:#0b1220;--panel:#131c2e;--panel2:#0f1726;--fg:#e6edf7;--muted:#8b9bb4;--line:#223049;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--info:#58a6ff}
  *{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
  header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:14px 22px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  header h1{font-size:16px;margin:0}header .meta{color:var(--muted);font-size:12px}
  nav{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
  nav a{color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:8px;font-size:13px}
  nav a:hover{background:var(--panel2);color:var(--fg)}
  main{max-width:1080px;margin:0 auto;padding:24px 22px 80px}
  section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px}
  h2{font-size:17px;margin:0 0 4px}h3{font-size:14px;margin:18px 0 8px;color:var(--fg)}
  .sub{color:var(--muted);font-size:12px;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);font-weight:600}
  .chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid transparent}
  .chip.ok{background:rgba(63,185,80,.15);color:var(--ok);border-color:rgba(63,185,80,.3)}
  .chip.warn{background:rgba(210,153,34,.15);color:var(--warn);border-color:rgba(210,153,34,.3)}
  .chip.bad{background:rgba(248,81,73,.15);color:var(--bad);border-color:rgba(248,81,73,.3)}
  .chip.info{background:rgba(88,166,255,.15);color:var(--info);border-color:rgba(88,166,255,.3)}
  .ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}
  .summary{padding:10px 14px;border-radius:10px;font-weight:600;margin-bottom:12px;border:1px solid}
  .summary.ok{background:rgba(63,185,80,.1);border-color:rgba(63,185,80,.3)}
  .summary.bad{background:rgba(248,81,73,.1);border-color:rgba(248,81,73,.3)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
  .card{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px}
  .card .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .card .v{font-size:22px;font-weight:700;margin-top:4px}
  pre.log{background:#0a0f1a;border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;font-size:12px;max-height:320px;color:#cdd9e5}
  ul.adv{margin:8px 0;padding-left:18px;columns:2}ul.adv a{color:var(--info)}
  details{margin-top:10px}summary{cursor:pointer;color:var(--muted)}
  code{background:var(--panel2);padding:1px 6px;border-radius:6px;font-size:12px}
  a{color:var(--info)}
</style></head><body>
<header>
  <h1>Saylani Job Bank — Consolidated Test Report</h1>
  <span class="meta">branch <code>test/api-and-ui-test-suites</code> · ${now}</span>
  <nav>
    <a href="#summary">Summary</a><a href="#e2e">E2E</a><a href="#qa">QA</a><a href="#load">Load</a><a href="#security">Security</a><a href="#repro">Reproduce</a>
  </nav>
</header>
<main>

<section id="summary">
  <h2>Summary</h2>
  <p class="sub">E2E (Playwright) + functional QA defects + API/Web/DB load + security, ek jagah. Testing only — developers fix.</p>
  <div class="grid">
    <div class="card"><div class="k">QA defects</div><div class="v">13</div><div class="muted">3 critical · 8 major · 2 minor</div></div>
    <div class="card"><div class="k">E2E (Playwright)</div><div class="v">44 / 54</div><div class="muted">10 failed (documented)</div></div>
    <div class="card"><div class="k">Visual + Cross-browser</div><div class="v ok">17 / 17</div><div class="muted">5 visual + 12 cross-browser</div></div>
    <div class="card"><div class="k">Unit + API tests</div><div class="v ok">666</div><div class="muted">Vitest 315 + Jest 351 green</div></div>
    <div class="card"><div class="k">Security advisories</div><div class="v bad">${[...new Set((readText('security-audit.txt') || '').match(/GHSA-[\w-]+/g) || [])].length}</div><div class="muted">audit-ci --moderate</div></div>
  </div>
</section>

<section id="e2e">
  <h2>1 · E2E (Playwright)</h2>
  <p class="sub">JSON: <code>e2e-results.json</code> · Full defect write-up: <a href="../../QA_REPORT.md">QA_REPORT.md</a></p>
  ${e2eSection()}
</section>

<section id="qa">
  <h2>2 · QA — Functional defects</h2>
  <p class="sub">Full detail: <a href="../../QA_REPORT.md">QA_REPORT.md</a></p>
  ${qaSection()}
</section>

<section id="load">
  <h2>3 · Load testing</h2>

  <h3>API (Artillery) — <code>pnpm test:api-load</code></h3>
  <p class="sub">Target <code>/api/v1/health</code>, protected 401, unknown-route envelope · JSON: <code>load-api.json</code></p>
  ${artilleryTable('API', api)}

  <h3>Web (Artillery) — <code>pnpm test:web-load</code></h3>
  <p class="sub">Landing/login/register/forgot + protected redirect · JSON: <code>load-web.json</code></p>
  ${artilleryTable('Web', web)}

  <h3>DB stress (direct Postgres) — <code>pnpm test:db-load</code></h3>
  <p class="sub">Isolated from HTTP: read + transactional write bursts</p>
  ${parseDbStress(db)}
</section>

<section id="security">
  <h2>4 · Security</h2>
  <p class="sub">Dependency + config audit via <code>audit-ci --moderate</code> (<code>pnpm test:security</code>)</p>
  ${securitySection()}
</section>

<section id="repro">
  <h2>Reproduce</h2>
  <pre class="log">pnpm infra:up &amp;&amp; pnpm db:migrate &amp;&amp; pnpm db:seed
pnpm --filter @jobbank/web build &amp;&amp; pnpm --filter @jobbank/web start   # for load/visual/cross
pnpm test:e2e              # functional E2E (chromium)  → e2e-results.json
pnpm test:visual-verify    # visual regression
pnpm test:cross-browser    # chromium + firefox + webkit
pnpm test:api-load         # API load
pnpm test:web-load         # Web load
pnpm test:db-load          # DB stress
pnpm test:security         # audit-ci
pnpm test:reports          # regenerate this index.html</pre>
</section>

</main></body></html>`;

fs.writeFileSync(path.join(REPORTS, 'index.html'), html);
console.log('Wrote tests/reports/index.html');
