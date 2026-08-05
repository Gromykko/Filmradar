#!/usr/bin/env node
/**
 * Regression suite for the 5 Aug 2026 blackout.
 *
 * trm.md answered 502 for a few hours. fetchPage threw, the throw escaped the
 * whole per-channel handler, and the TV Mail backup — the one thing that exists
 * for exactly this — was never reached. Moldova 1 and Moldova 2 wrote out zero
 * slots and the dashboard showed no schedule for either. TVR Moldova was fine
 * throughout, only because it has no TRM page to fail in the first place.
 *
 * These tests pin the two guarantees that stop it recurring:
 *   1. a dead channel page still yields the backup source's slots;
 *   2. a channel that comes back genuinely empty keeps the previous snapshot's
 *      future-dated slots rather than blanking.
 *
 * Run: node scraper/test/outage.test.mjs
 */

import assert from 'node:assert/strict';
import { fetchAllChannels } from '../lib/trm.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
  }
}

const dead = async () => {
  throw new Error('HTTP 502 Bad Gateway');
};

/** Two TV Mail events for whatever day is asked for. */
const tvmailOk = async (channelId, date) => [
  { name: `Film de patrimoniu (${channelId})`, start_ts: Date.parse(`${date}T12:00:00Z`) / 1000 },
  { name: 'Telejurnal', start_ts: Date.parse(`${date}T20:00:00Z`) / 1000 },
];

const CH = {
  id: 'moldova-2',
  name: 'Moldova 2',
  schedule: 'https://trm.md/ro/moldova-2',
  tier: 'primary',
  tvmailChannel: 2910,
};

console.log('\nOutage resilience\n');

await test('a 502 on the channel page does not sink the TV Mail backup', async () => {
  const [r] = await fetchAllChannels({
    channels: [CH],
    tvmailCache: {},
    pageFetcher: dead,
    tvmailFetcher: tvmailOk,
  });
  assert.ok(r.slots.length > 0, 'expected backup slots, got none — this is the exact bug');
  assert.equal(r.ok, true, 'channel with usable slots must not be reported as failed');
  assert.match(r.warning ?? '', /rezerv/i, 'the degraded read must still be flagged');
});

await test('a 502 with no backup at all is still a hard failure', async () => {
  const [r] = await fetchAllChannels({
    channels: [{ ...CH, tvmailChannel: undefined }],
    pageFetcher: dead,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /502/);
  assert.deepEqual(r.slots, []);
});

await test('a healthy page still parses and still merges the backup', async () => {
  const html = '<html><body>12:00 - 13:30\nTunul de lemn</body></html>';
  const [r] = await fetchAllChannels({
    channels: [CH],
    tvmailCache: {},
    pageFetcher: async () => html,
    tvmailFetcher: tvmailOk,
  });
  assert.ok(r.slots.some((s) => s.title === 'Tunul de lemn'), 'lost the page\'s own slot');
  assert.ok(r.slots.some((s) => s.source === 'tvmail'), 'lost the backup slots');
  assert.equal(r.warning, null);
});

// -- carry-forward ---------------------------------------------------------
// Mirrors the persist step in check.mjs: an empty result keeps the previous
// snapshot's slots, but only ones with a real date that has not passed.
const carry = (slots, prev, today) =>
  slots.length ? slots : prev.filter((s) => s.date && s.date >= today);

await test('an empty run keeps the previous snapshot\'s future slots', () => {
  const prev = [
    { date: '2026-08-06', start: '12:00', title: 'Mâine' },
    { date: '2026-08-05', start: '09:00', title: 'Azi' },
  ];
  assert.equal(carry([], prev, '2026-08-05').length, 2);
});

await test('carry-forward never resurrects a past schedule', () => {
  const prev = [
    { date: '2026-07-28', start: '12:00', title: 'Săptămâna trecută' },
    { dayName: 'luni', start: '10:00', title: 'Fără dată' },
  ];
  assert.deepEqual(carry([], prev, '2026-08-05'), []);
});

await test('a good run is never overwritten by carried-over slots', () => {
  const fresh = [{ date: '2026-08-05', start: '12:00', title: 'Proaspăt' }];
  const prev = [{ date: '2026-08-09', start: '12:00', title: 'Vechi' }];
  assert.deepEqual(carry(fresh, prev, '2026-08-05'), fresh);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
