#!/usr/bin/env node
/**
 * Runs every test file and reports one combined verdict.
 *
 * Each suite is a standalone script that exits non-zero on failure, so this is
 * just a sequencer — no shared state between suites, and one failing suite
 * can't mask another's results.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['core        ', 'run.mjs'],
  ['announcements', 'announce.test.mjs'],
  ['streams     ', 'streams.test.mjs'],
  ['rec. timing ', 'timing.test.mjs'],
  ['history     ', 'history.test.mjs'],
];

let failed = 0;
const summary = [];

for (const [label, file] of SUITES) {
  const res = spawnSync(process.execPath, [join(__dirname, file)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;

  // Each suite prints a trailing "N passed, M failed" line.
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const fails = m ? Number(m[2]) : (res.status === 0 ? 0 : 1);

  if (res.status !== 0 || fails > 0) {
    failed += fails || 1;
    process.stdout.write(out);
  }
  summary.push({ label, passed, fails, ok: res.status === 0 && fails === 0 });
}

console.log('\n─────────────────────────────');
let total = 0;
for (const s of summary) {
  total += s.passed;
  console.log(`  ${s.ok ? '✓' : '✗'} ${s.label}  ${s.passed} passed${s.fails ? `, ${s.fails} FAILED` : ''}`);
}
console.log('─────────────────────────────');
console.log(`  ${total} assertions, ${failed ? `${failed} FAILED` : 'all green'}\n`);

process.exit(failed ? 1 : 0);
