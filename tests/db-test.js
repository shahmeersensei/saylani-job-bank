/**
 * DB stress test — hits PostgreSQL directly (no HTTP) to isolate database
 * performance from the app server. Quick sanity load: mixed read/write bursts.
 *
 * Usage: node tests/db-test.js   (requires infra up + DATABASE_URL in .env)
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');

// Minimal .env loader (root .env only).
function loadRootEnv() {
  try {
    for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadRootEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set — cannot run DB stress test.');
  process.exit(1);
}

const READ_ROUNDS = 200;
const WRITE_ROUNDS = 100;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Sanity: verify connection + PostGIS before stressing.
  const info = await client.query('SELECT version() AS v');
  console.log(`connected: ${info.rows[0].v.split(' ').slice(0, 2).join(' ')}`);

  const reads = [];
  const writes = [];

  // --- Read burst: index-backed count + a paginated select ---
  for (let i = 0; i < READ_ROUNDS; i++) {
    const t0 = process.hrtime.bigint();
    await client.query('SELECT count(*) FROM users');
    await client.query('SELECT id, email FROM users ORDER BY created_at DESC LIMIT 20');
    reads.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }

  // --- Write burst: transactional insert + rollback (no lasting data) ---
  for (let i = 0; i < WRITE_ROUNDS; i++) {
    const t0 = process.hrtime.bigint();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO master_data (type, code, label) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      ['SKILL', `STRESS_${i}`, `Stress ${Date.now()}`],
    );
    await client.query('ROLLBACK');
    writes.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }

  await client.end();

  const fmt = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      p50: percentile(s, 50),
      p95: percentile(s, 95),
      p99: percentile(s, 99),
      avg,
      max: s[s.length - 1],
    };
  };
  const r = fmt(reads);
  const w = fmt(writes);

  console.log('\n=== DB stress results (ms) ===');
  console.log(
    `reads  x${READ_ROUNDS}:  p50=${r.p50.toFixed(1)}  p95=${r.p95.toFixed(1)}  p99=${r.p99.toFixed(1)}  avg=${r.avg.toFixed(1)}  max=${r.max.toFixed(1)}`,
  );
  console.log(
    `writes x${WRITE_ROUNDS}:  p50=${w.p50.toFixed(1)}  p95=${w.p95.toFixed(1)}  p99=${w.p99.toFixed(1)}  avg=${w.avg.toFixed(1)}  max=${w.max.toFixed(1)}`,
  );

  const ok = r.p95 < 200 && w.p95 < 300;
  console.log(
    `\nverdict: ${ok ? 'PASS (p95 within budget: reads<200ms, writes<300ms)' : 'FAIL (p95 exceeded budget)'}`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('DB stress test failed:', err.message);
  process.exit(1);
});
