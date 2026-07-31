#!/usr/bin/env node
/**
 * Test suite for the hits.json history merge — no framework, just assertions.
 * Run: node scraper/test/history.test.mjs
 *
 * The bug being pinned: history used to append every current hit on every run,
 * because the "already alerted" ledger is only written when a notification
 * actually delivers. With no Telegram/e-mail secret configured nothing is ever
 * marked as alerted, so one Saturday screening piled up 73 identical rows in
 * the Istoric tab. History records broadcasts, not scraper runs.
 *
 * mergeHistory mirrors the block in check.mjs. Keep the two in sync.
 */

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
  }
}

function alertKey(h) {
  return `${h.channelId}|${h.day ?? '?'}|${h.start}|${(h.slotTitle || '').toLowerCase()}`;
}

function mergeHistory(prevHistory, hits, detectedNow) {
  const byKey = new Map();
  for (const h of [...(prevHistory ?? [])].reverse()) {
    const k = alertKey(h);
    if (!byKey.has(k)) byKey.set(k, h);
  }
  for (const h of hits) {
    const k = alertKey(h);
    if (!byKey.has(k)) byKey.set(k, { ...h, detectedAt: detectedNow });
  }
  return [...byKey.values()]
    .sort((a, b) => String(b.detectedAt ?? '').localeCompare(String(a.detectedAt ?? '')))
    .slice(0, 200);
}

const HIT = {
  channelId: 'moldova-2',
  day: 6,
  start: '12:40',
  slotTitle: 'F.A. (Danila Prepeleac)',
  watched: 'Dănilă Prepeleac',
};

console.log('\nhits.json history merge\n');

test('25 runs over one unchanged broadcast leave exactly one row', () => {
  let history = [];
  for (let run = 0; run < 25; run++) {
    history = mergeHistory(history, [HIT], `2026-07-${String(run + 1).padStart(2, '0')}T08:00:00.000Z`);
  }
  assert.equal(history.length, 1);
});

test('keeps the first sighting, not the most recent run', () => {
  let history = mergeHistory([], [HIT], '2026-07-01T08:00:00.000Z');
  history = mergeHistory(history, [HIT], '2026-07-09T08:00:00.000Z');
  assert.equal(history[0].detectedAt, '2026-07-01T08:00:00.000Z');
});

test('different day, start or channel stay distinct broadcasts', () => {
  const history = mergeHistory(
    [],
    [HIT, { ...HIT, day: 7, start: '03:20' }, { ...HIT, channelId: 'moldova-1' }],
    '2026-08-01T08:00:00.000Z',
  );
  assert.equal(history.length, 3);
});

test('re-scoring an existing slot adds no row', () => {
  let history = mergeHistory([], [HIT], '2026-08-01T08:00:00.000Z');
  history = mergeHistory(history, [{ ...HIT, confidence: 0.42 }], '2026-09-01T08:00:00.000Z');
  assert.equal(history.length, 1);
});

test('sorted newest-first for the Istoric table', () => {
  let history = mergeHistory([], [HIT], '2026-07-01T08:00:00.000Z');
  history = mergeHistory(history, [{ ...HIT, start: '19:00' }], '2026-07-05T08:00:00.000Z');
  const stamps = history.map((h) => h.detectedAt);
  assert.deepEqual(stamps, [...stamps].sort().reverse());
});

test('still capped at 200 rows', () => {
  const many = Array.from({ length: 260 }, (_, i) => ({
    ...HIT,
    day: (i % 7) + 1,
    start: `${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
    slotTitle: `slot ${i}`,
  }));
  assert.ok(mergeHistory([], many, '2026-10-01T08:00:00.000Z').length <= 200);
});

test('survives a history file with missing detectedAt', () => {
  const history = mergeHistory([{ ...HIT }], [{ ...HIT, start: '20:00' }], '2026-10-01T08:00:00.000Z');
  assert.equal(history.length, 2);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
