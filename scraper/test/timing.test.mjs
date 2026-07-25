#!/usr/bin/env node
/**
 * Test suite for recorder/timing.mjs — no framework, just assertions.
 * Run: node scraper/test/timing.test.mjs
 *
 * The `now` parameter is injected everywhere, so these tests are pure and do
 * not depend on when they happen to run.
 *
 * The bug being pinned: TRM only publishes the CURRENT day's grid, so
 * data/hits.json is mostly slots that already aired. Treating "negative time
 * until start" as "start immediately" made the recorder capture whatever was
 * on air instead of the film.
 */

import assert from 'node:assert/strict';
import { msUntil, durationMins, planSlot } from '../../recorder/timing.mjs';

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

/** Sunday 14:00 in Chișinău. */
const SUN_1400 = { day: 7, hour: 14, minute: 0 };
const min = (ms) => ms / 60_000;

console.log('\nrecorder/timing.mjs\n');

/* ------------------------------------------------------------- msUntil */

test('later today → positive delta', () => {
  assert.equal(min(msUntil('duminică', '16:30', SUN_1400)), 150);
});

test('later this week → correct multi-day delta', () => {
  // Sunday is day 7; Tuesday is 2 days *forward* in the 1..7 wrap.
  assert.equal(min(msUntil('marți', '14:00', SUN_1400)), 2 * 1440);
});

test('earlier today stays NEGATIVE, never rolls to next week', () => {
  // The old code added 7 days once a slot was >180 min past, which scheduled a
  // recording against next week's unknown programming.
  assert.equal(min(msUntil('duminică', '09:00', SUN_1400)), -300);
});

test('unknown weekday or malformed time → null', () => {
  assert.equal(msUntil('blursday', '10:00', SUN_1400), null);
  assert.equal(msUntil('luni', 'noon', SUN_1400), null);
});

test('accepts both Romanian diacritic spellings of Saturday', () => {
  assert.equal(msUntil('sâmbătă', '14:00', SUN_1400), msUntil('sîmbătă', '14:00', SUN_1400));
});

/* -------------------------------------------------------- durationMins */

test('duration from start/end', () => {
  assert.equal(durationMins({ start: '12:00', end: '13:13' }), 73);
});

test('duration across midnight', () => {
  assert.equal(durationMins({ start: '23:30', end: '00:50' }), 80);
});

test('missing end time → 90 min default', () => {
  assert.equal(durationMins({ start: '12:00', end: null }), 90);
});

/* ------------------------------------------------------------ planSlot */

const at = (start, end, dayName = 'duminică') => ({ dayName, start, end });

test('future slot: schedules with padding on both sides', () => {
  const p = planSlot(at('16:00', '17:13'), { pad: 3, now: SUN_1400 });
  assert.equal(p.skip, false);
  assert.equal(p.late, false);
  assert.equal(min(p.ms), 120);
  assert.equal(min(p.startIn), 117);       // starts 3 min early
  assert.equal(p.mins, 73 + 6);            // 73 min + 3 before + 3 after
});

test('REGRESSION: slot that already ended is skipped, not recorded now', () => {
  // 12:00-13:13, now 14:00 — finished 47 min ago. The old code fired the timer
  // immediately and recorded 79 min of the wrong programme.
  const p = planSlot(at('12:00', '13:13'), { pad: 3, now: SUN_1400 });
  assert.equal(p.skip, true);
  assert.equal(p.reason, 'aired');
});

test('slot ending exactly now is skipped', () => {
  const p = planSlot(at('12:47', '14:00'), { pad: 3, now: SUN_1400 });
  assert.equal(p.skip, true);
  assert.equal(p.reason, 'aired');
});

test('slot in progress: joins late and records only what is left', () => {
  // 13:30-14:43, now 14:00 — 30 min gone, 43 min remain.
  const p = planSlot(at('13:30', '14:43'), { pad: 3, now: SUN_1400 });
  assert.equal(p.skip, false);
  assert.equal(p.late, true);
  assert.equal(p.elapsedMin, 30);
  assert.equal(p.remainingMin, 43);
  // Trailing pad only — the head of the film is already gone.
  assert.equal(p.mins, 43 + 3);
});

test('late join never claims padding it cannot use', () => {
  const p = planSlot(at('13:30', '14:43'), { pad: 10, now: SUN_1400 });
  assert.equal(p.mins, 43 + 10, 'one pad, not two');
});

test('unparsable slot reports a distinct reason', () => {
  const p = planSlot(at('12:00', '13:00', 'blursday'), { now: SUN_1400 });
  assert.equal(p.skip, true);
  assert.equal(p.reason, 'unparsable');
});

test('no end time: 90-min default still governs the aired/skip cut-off', () => {
  // Started 09:00, no end → assumed 90 min, so it ended at 10:30. Skip.
  assert.equal(planSlot({ dayName: 'duminică', start: '09:00', end: null }, { now: SUN_1400 }).skip, true);
  // Started 13:30, no end → runs to 15:00, still on air. Join.
  const live = planSlot({ dayName: 'duminică', start: '13:30', end: null }, { now: SUN_1400 });
  assert.equal(live.skip, false);
  assert.equal(live.late, true);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
