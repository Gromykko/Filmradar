#!/usr/bin/env node
/**
 * Resolve every active channel's live m3u8 URL and write recorder/streams.json.
 *
 * This is what replaced the old "open Chrome, F12, Network tab, filter m3u8"
 * workflow — see scraper/lib/streams.mjs for how the PeerTube API makes the
 * URL discoverable without a browser at all.
 *
 *   node scraper/tools/discover-streams.mjs           resolve + write recorder/streams.json
 *   node scraper/tools/discover-streams.mjs --check   report only, don't write, exit 1 on any failure
 *   node scraper/tools/discover-streams.mjs --quiet   suppress the summary table (errors still print)
 *
 * recorder/record.mjs also calls resolveStream() itself before every
 * recording — this file exists so you can warm/inspect the cache by hand,
 * and so a cron job can alert you when a channel's live page stops matching
 * the expected PeerTube shape.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAll } from '../lib/streams.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const argv = new Set(process.argv.slice(2));
const CHECK_ONLY = argv.has('--check');
const QUIET = argv.has('--quiet');

function log(...a) {
  if (!QUIET) console.log(...a);
}

async function loadSources() {
  const raw = await readFile(join(ROOT, 'data/sources.json'), 'utf8');
  const parsed = JSON.parse(raw);
  // Only channels with a live page can have a stream resolved at all.
  return parsed.filter((s) => s.enabled !== false && s.live);
}

function pad(s, w) {
  return String(s).padEnd(w);
}

async function main() {
  const sources = await loadSources();
  log(`\n▶ Rezolv fluxurile live pentru ${sources.length} canale...\n`);

  const results = await resolveAll(sources);
  const now = new Date().toISOString();

  const channels = {};
  let anyFailed = false;

  const rows = results.map((r) => {
    if (r.ok) {
      channels[r.id] = { name: r.name, m3u8: r.m3u8, resolvedAt: now, source: r.live };
      return { id: r.id, name: r.name, ok: true, detail: r.m3u8 };
    }
    anyFailed = true;
    channels[r.id] = { name: r.name, m3u8: null, resolvedAt: now, source: r.live, error: r.error };
    return { id: r.id, name: r.name, ok: false, detail: r.error };
  });

  const idW = Math.max(2, ...rows.map((r) => r.id.length));
  const nameW = Math.max(5, ...rows.map((r) => r.name.length));
  log(`${pad('ID', idW)}  ${pad('Canal', nameW)}  Stare      Detalii`);
  log('-'.repeat(idW + nameW + 40));
  for (const r of rows) {
    const status = r.ok ? '✓ OK' : '✗ EȘUAT';
    log(`${pad(r.id, idW)}  ${pad(r.name, nameW)}  ${pad(status, 9)}  ${r.detail ?? ''}`);
  }
  log(`\n  ${rows.filter((r) => r.ok).length}/${rows.length} canale rezolvate.\n`);

  if (!CHECK_ONLY) {
    const out = { _generated: now, channels };
    await mkdir(join(ROOT, 'recorder'), { recursive: true });
    await writeFile(join(ROOT, 'recorder/streams.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    log('✓ Scris recorder/streams.json');
  } else {
    log('(--check: nu am scris recorder/streams.json)');
  }

  if (anyFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Eroare fatală:', err);
  process.exitCode = 1;
});
