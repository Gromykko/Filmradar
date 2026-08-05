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
import { msUntil, msUntilDate, durationMins, planSlot, todayNameRo, DAY_NAMES } from '../../recorder/timing.mjs';
import { parseTvMail, mergeSlots, fetchTvMailWeek } from '../lib/tvmail.mjs';

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

/* ------------------------------------------ one-off --from/--to plumbing */
// The dashboard's record button emits --channel/--from/--to/--day. Its default
// weekday must round-trip through the same table msUntil() parses, or a copied
// command would fail on "unparsable" for no visible reason.

test('todayNameRo returns a weekday msUntil can parse back', () => {
  const name = todayNameRo(SUN_1400);
  assert.equal(name, 'duminică');
  assert.equal(min(msUntil(name, '16:00', SUN_1400)), 120);
});

test('every generated day name is understood by the planner', () => {
  for (const [num, name] of Object.entries(DAY_NAMES)) {
    const now = { day: Number(num), hour: 10, minute: 0 };
    assert.equal(todayNameRo(now), name);
    assert.equal(
      planSlot({ dayName: name, start: '12:00', end: '13:00' }, { now }).skip,
      false,
      `${name} must plan, not fall through to unparsable`,
    );
  }
});

/* --------------------------------------------------- exact calendar date */
// Chișinău is UTC+3 in summer, UTC+2 in winter. These assert the real instant,
// so a hardcoded offset or a naive Date parse would fail one of them.

test('msUntilDate resolves a summer (EEST, UTC+3) date correctly', () => {
  const from = Date.UTC(2026, 6, 27, 0, 0, 0); // 27 Jul 2026, 00:00 UTC
  // 12:00 in Chișinău that day is 09:00 UTC → 9 hours out.
  assert.equal(msUntilDate('2026-07-27', '12:00', from) / 3600000, 9);
});

test('msUntilDate resolves a winter (EET, UTC+2) date correctly', () => {
  const from = Date.UTC(2026, 0, 15, 0, 0, 0); // 15 Jan 2026, 00:00 UTC
  // 12:00 in Chișinău that day is 10:00 UTC → 10 hours out. Same code path,
  // different offset: proof the DST handling is real and not a fixed +3.
  assert.equal(msUntilDate('2026-01-15', '12:00', from) / 3600000, 10);
});

test('msUntilDate rejects malformed input instead of guessing', () => {
  assert.equal(msUntilDate('27-07-2026', '12:00'), null);
  assert.equal(msUntilDate('2026-07-27', 'noon'), null);
  assert.equal(msUntilDate('', '12:00'), null);
});

test('an explicit date overrides the weekday in planSlot', () => {
  // dayName says Sunday, date says a Monday — the date must win.
  const nowMs = Date.UTC(2026, 6, 27, 6, 0, 0); // Mon 27 Jul, 09:00 Chișinău
  const p = planSlot(
    { dayName: 'duminică', date: '2026-07-27', start: '12:00', end: '13:13' },
    { pad: 3, nowMs },
  );
  assert.equal(p.skip, false);
  assert.equal(p.ms / 3600000, 3, 'three hours from 09:00 to 12:00 Chișinău');
});

test('a past exact date is refused, not rolled forward a week', () => {
  const nowMs = Date.UTC(2026, 6, 27, 12, 0, 0); // Mon 27 Jul, 15:00 Chișinău
  const p = planSlot({ date: '2026-07-27', start: '09:00', end: '10:00' }, { nowMs });
  assert.equal(p.skip, true);
  assert.equal(p.reason, 'aired');
});

/* ------------------------------------------------- TV Mail backup source */

const LD = (events) =>
  `<html><script type="application/ld+json">${JSON.stringify(events)}</script></html>`;

test('parses JSON-LD events into dated slots', () => {
  const { slots, dayAssumed } = parseTvMail(LD([
    { '@type': 'Event', name: 'Tunul de lemn', startDate: '2026-07-27T09:00:00+00:00', endDate: '2026-07-27T10:13:00+00:00' },
  ]));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].date, '2026-07-27');
  assert.equal(slots[0].start, '12:00', 'UTC 09:00 is 12:00 in Chișinău in July');
  assert.equal(slots[0].end, '13:13');
  assert.equal(slots[0].dayName, 'luni');
  // The whole point of this source: dates are known, never inferred.
  assert.equal(dayAssumed, false);
});

test('ignores non-Event and malformed entries without losing the good ones', () => {
  const html = `<html>
    <script type="application/ld+json">{ not json at all }</script>
    <script type="application/ld+json">${JSON.stringify([
      { '@type': 'WebPage', name: 'nope' },
      { '@type': 'Event', name: 'no start date' },
      { '@type': 'Event', name: 'Bun', startDate: '2026-07-27T09:00:00+00:00' },
    ])}</script></html>`;
  const { slots } = parseTvMail(html);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].title, 'Bun');
  assert.equal(slots[0].end, null);
});

test('merge keeps TRM wording and adds only genuinely new broadcasts', () => {
  // Both sides carry a date: parseSchedule now resolves TRM's weekday tabs to
  // calendar dates, so identity is date+start on both sides.
  const trm = [{ dayName: 'luni', date: '2026-07-27', start: '12:00', end: '13:13', title: 'F.A. Tunul de lemn', filler: false }];
  const alt = [
    { dayName: 'luni', date: '2026-07-27', start: '12:00', end: '13:13', title: 'Tunul de lemn', filler: false },
    { dayName: 'luni', date: '2026-07-27', start: '20:00', end: '21:00', title: 'Altceva', filler: false },
  ];
  const merged = mergeSlots(trm, alt);
  assert.equal(merged.length, 2, 'the 12:00 duplicate must collapse');
  assert.equal(merged[0].title, 'F.A. Tunul de lemn', "TRM's own wording wins");
  assert.equal(merged[1].start, '20:00');
});

test('a next-week broadcast is not swallowed by the same weekday this week', () => {
  // The collision that hid real films: TV Mail's window rolls across two
  // calendar weeks, TRM's grid covers one. Matching on weekday alone made
  // next Monday's film look like a duplicate of this Monday's rubric — it was
  // dropped, and the slot it merged into was stamped a week wrong.
  const trm = [{ dayName: 'luni', date: '2026-08-03', start: '20:00', title: 'Moldova de patrimoniu', filler: false }];
  const alt = [{ dayName: 'luni', date: '2026-08-10', start: '20:00', title: 'Tunul de lemn', filler: false }];
  const merged = mergeSlots(trm, alt);
  assert.equal(merged.length, 2, 'next week is a different broadcast, not a duplicate');
  assert.equal(merged[0].date, '2026-08-03', "this week's slot keeps its own date");
  assert.ok(merged.some((s) => s.title === 'Tunul de lemn' && s.date === '2026-08-10'));
});

/* --------------------------------------- TV Mail week cache (rate limits) */
// This source hands back a captcha page if pushed — it did exactly that after
// a burst of probing. So the week it gives us is cached in the repo, and these
// pin the behaviour that makes a block survivable.

const asyncTest = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n      ${err.message}`); }
};

const ev = (name, hourUTC) => ({
  name, start_ts: Math.floor(Date.UTC(2026, 6, 27, hourUTC, 0, 0) / 1000),
  stop_ts: Math.floor(Date.UTC(2026, 6, 27, hourUTC + 1, 0, 0) / 1000),
});

await asyncTest('future days are fetched once, then served from cache', async () => {
  const calls = [];
  const fetcher = async (_ch, date) => { calls.push(date); return [ev('X', 9)]; };
  const cache = {};
  await fetchTvMailWeek(2910, { days: 3, fetcher, cache, paceMs: 0, maxFetch: 9 });
  const firstRun = calls.length;
  assert.equal(firstRun, 3);

  calls.length = 0;
  await fetchTvMailWeek(2910, { days: 3, fetcher, cache, paceMs: 0, maxFetch: 9 });
  // Only today is refreshed; the other two come from cache. This is what keeps
  // a run to one or two requests instead of seven.
  assert.equal(calls.length, 1, `refetched ${calls.length} days, expected 1`);
});

await asyncTest('a failed day keeps its cached slots instead of blanking them', async () => {
  let fail = false;
  const fetcher = async () => { if (fail) throw new Error('captcha'); return [ev('Film bun', 9)]; };
  const cache = {};
  const ok = await fetchTvMailWeek(2910, { days: 3, fetcher, cache, paceMs: 0, maxFetch: 9 });
  assert.equal(ok.slots.length, 3);

  fail = true;
  const blocked = await fetchTvMailWeek(2910, { days: 3, fetcher, cache, paceMs: 0, maxFetch: 9 });
  assert.ok(blocked.errors.length, 'the failure should be reported');
  // The whole point: yesterday's successful week survives today's block.
  assert.equal(blocked.slots.length, 3, 'cached days were lost on failure');
});

await asyncTest('maxFetch caps how many requests one run may make', async () => {
  const calls = [];
  const fetcher = async (_c, d) => { calls.push(d); return [ev('X', 9)]; };
  await fetchTvMailWeek(2910, { days: 7, fetcher, cache: {}, paceMs: 0, maxFetch: 2 });
  assert.equal(calls.length, 2);
});

await asyncTest('dates before today are pruned from the cache', async () => {
  const stale = '2020-01-01';
  const cache = { 2910: { [stale]: [{ title: 'ancient' }] } };
  await fetchTvMailWeek(2910, { days: 1, fetcher: async () => [], cache, paceMs: 0 });
  assert.equal(cache[2910][stale], undefined, 'stale date should be dropped');
});

await asyncTest('a total outage yields no slots but never throws', async () => {
  const r = await fetchTvMailWeek(2910, {
    days: 3, cache: {}, paceMs: 0,
    fetcher: async () => { throw new Error('HTTP 429'); },
  });
  assert.equal(r.slots.length, 0);
  assert.equal(r.errors.length, 3);
  assert.equal(r.parsedAnyTime, false);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
