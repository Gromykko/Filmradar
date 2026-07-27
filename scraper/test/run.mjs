#!/usr/bin/env node
/**
 * Test suite — no framework, just assertions. Run: npm test
 *
 * Covers the two things most likely to silently break:
 *   1. the TRM grid parser (markup churn)
 *   2. the title matcher (diacritics, casing, spacing, false positives)
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { parseSchedule, CHANNELS, todayInChisinau, DAY_NAMES_RO } from '../lib/trm.mjs';
import { scoreTitle, genericFilmLabel, genericFilmRubric, findMatches } from '../lib/match.mjs';
import { fold, contentTokens } from '../lib/normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

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

console.log('\nnormalize');

test('folds Romanian comma-below diacritics', () => {
  assert.equal(fold('Poienile roșii'), 'poienile rosii');
  assert.equal(fold('Sâmbătă în Chișinău'), 'sambata in chisinau');
});

test('folds legacy cedilla encoding identically', () => {
  // U+015F/U+0163 (cedilla) vs U+0219/U+021B (comma) must collapse to the same string
  assert.equal(fold('Poienile roşii'), fold('Poienile roșii'));
  assert.equal(fold('marţi'), fold('marți'));
});

test('collapses punctuation and repeated spaces', () => {
  assert.equal(fold('„TUNUL   DE  LEMN"'), 'tunul de lemn');
  assert.equal(fold('F.A. Tunul de lemn'), 'f a tunul de lemn');
});

test('drops stopwords but keeps content words', () => {
  assert.deepEqual(contentTokens('Tunul de lemn'), ['tunul', 'lemn']);
});

console.log('\nmatch — true positives');

test('exact title matches', () => {
  const r = scoreTitle('Tunul de lemn', 'Tunul de lemn');
  assert.equal(r.kind, 'exact');
});

test('matches inside an F.A. rubric prefix', () => {
  const r = scoreTitle('Tunul de lemn', 'F.A. Tunul de lemn');
  assert.ok(r, 'should match');
  assert.ok(r.score >= 0.9, `score ${r?.score} too low`);
});

test('matches through uppercase and double spacing', () => {
  const r = scoreTitle('Tunul de lemn', 'TUNUL  DE  LEMN');
  assert.ok(r && r.score >= 0.9);
});

test('matches undiacriticised listings', () => {
  const r = scoreTitle('Gingașa și tandra mea fiară', 'Gingasa si tandra mea fiara');
  assert.ok(r, 'should match despite missing diacritics');
});

test('matches with a trailing year', () => {
  const r = scoreTitle('Tunul de lemn', 'Tunul de lemn (1986)');
  assert.ok(r && r.score >= 0.9);
});

test('tolerates a typo in a long word when fuzzy', () => {
  const r = scoreTitle('Poienile roșii', 'Poienille rosii', { fuzzy: true });
  assert.ok(r, 'should survive one transposition');
});

console.log('\nmatch — false positives must NOT fire');

test('unrelated programme does not match', () => {
  assert.equal(scoreTitle('Tunul de lemn', 'Evantai folcloric. Vasile Iovu'), null);
});

test('partial stopword overlap does not match', () => {
  assert.equal(scoreTitle('Tunul de lemn', 'Casa de piatra'), null);
});

test('single shared content word does not match', () => {
  assert.equal(scoreTitle('Tunul de lemn', 'Lemn si mestesug'), null);
});

test('single-word title requires full coverage', () => {
  assert.equal(scoreTitle('Fântâna', 'Fantasticul si realul'), null);
});

test('fuzzy=false rejects typos', () => {
  assert.equal(scoreTitle('Poienile roșii', 'Poienille rosii', { fuzzy: false }), null);
});

console.log('\nmatch — generic rubric detection');

test('recognises archive rubrics', () => {
  assert.ok(genericFilmLabel('F.A. Un film oarecare'));
  assert.ok(genericFilmLabel('Film artistic'));
  assert.ok(genericFilmLabel('Moldova de patrimoniu'));
  assert.ok(genericFilmLabel('Tezaur'));
  assert.ok(genericFilmLabel('Cinemateca: ceva'));
});

test('does not flag ordinary programmes as rubrics', () => {
  assert.equal(genericFilmLabel('Evantai folcloric. Vasile Iovu'), null);
  assert.equal(genericFilmLabel('Concert. Snails'), null);
  assert.equal(genericFilmLabel('Publicitate'), null);
});

console.log('\ntrm parser');

const html = await readFile(join(__dirname, 'fixtures/moldova2.sample.html'), 'utf8');
const { slots, parsedAnyTime } = parseSchedule(html);

test('finds time slots at all', () => {
  assert.ok(parsedAnyTime);
  assert.ok(slots.length >= 18, `only found ${slots.length} slots`);
});

test('pairs each time range with the following title', () => {
  const s = slots.find((x) => x.start === '06:00');
  assert.equal(s.title, 'Evantai folcloric. Vasile Iovu');
  assert.equal(s.end, '07:00');
});

test('attributes slots to the correct weekday', () => {
  const s = slots.find((x) => x.title.includes('Tunul de lemn'));
  assert.equal(s.day, 1, 'Monday');
  assert.equal(s.dayName, 'luni');
  assert.equal(s.start, '20:00');
});

test('handles the cedilla-encoded "marţi" tab', () => {
  const tue = slots.filter((x) => x.day === 2);
  assert.ok(tue.length >= 3, `expected Tuesday slots, got ${tue.length}`);
  assert.ok(tue.some((x) => x.start === '19:00'));
});

test('parses all seven weekdays', () => {
  const days = new Set(slots.map((s) => s.day).filter(Boolean));
  assert.equal(days.size, 7, `got days: ${[...days].sort().join(',')}`);
});

test('marks Publicitate as filler', () => {
  const ad = slots.find((x) => /publicitate/i.test(x.title));
  assert.equal(ad.filler, true);
});

test('ignores content inside the footer', () => {
  assert.ok(!slots.some((s) => s.start === '99:99'));
  assert.ok(!slots.some((s) => /footer/i.test(s.title)));
});

test('strips script and style content', () => {
  assert.ok(!slots.some((s) => s.title.includes('color:red')));
});

console.log('\ntrm parser — real-world "only today is rendered" shape');

const todayHtml = await readFile(join(__dirname, 'fixtures/moldova1.today-only.html'), 'utf8');
const todayParsed = parseSchedule(todayHtml);

test('does NOT file slots under the last tab label', () => {
  // The regression this whole branch exists to prevent: reading "duminică"
  // (the final tab) as a heading and mis-filing every slot under Sunday.
  const sunday = todayParsed.slots.filter((s) => s.dayName === 'duminică');
  const isActuallySunday = todayInChisinau() === 7;
  if (!isActuallySunday) {
    assert.equal(sunday.length, 0, 'slots were wrongly attributed to Sunday');
  }
});

test('attributes tab-only pages to today, and says so', () => {
  assert.equal(todayParsed.dayAssumed, true, 'should flag the day as assumed');
  const today = todayInChisinau();
  assert.ok(todayParsed.slots.every((s) => s.day === today));
  assert.ok(todayParsed.slots.every((s) => s.dayAssumed === true));
  assert.ok(todayParsed.slots.every((s) => s.dayName === DAY_NAMES_RO[today]));
});

test('still finds the film on a tab-only page', () => {
  const hit = todayParsed.slots.find((s) => /tunul de lemn/i.test(s.title));
  assert.ok(hit, 'film slot missing');
  assert.equal(hit.start, '20:10');
});

test('full-week pages are not flagged as assumed', () => {
  assert.equal(parseSchedule(html).dayAssumed, false);
});

console.log('\nend-to-end');

const watchlist = JSON.parse(await readFile(join(ROOT, 'data/watchlist.json'), 'utf8'));
const results = [{ channel: CHANNELS[1], slots, ok: true }];
const { hits, maybes } = findMatches(results, watchlist);

test('detects Tunul de lemn in both its listed forms', () => {
  const tunul = hits.filter((h) => h.watched === 'Tunul de lemn');
  assert.ok(tunul.length >= 2, `expected 2 airings, found ${tunul.length}`);
  const days = tunul.map((h) => h.dayName).sort();
  assert.deepEqual(days, ['luni', 'marți']);
});

test('detects other watchlist titles', () => {
  assert.ok(hits.some((h) => h.watched === 'Gingașa și tandra mea fiară'));
  assert.ok(hits.some((h) => h.watched === 'Poienile roșii'));
});

test('surfaces unnamed rubrics as maybes', () => {
  assert.ok(maybes.some((m) => m.slotTitle === 'Film artistic'));
  assert.ok(maybes.some((m) => m.slotTitle === 'Tezaur'));
});

test('a matched slot is a hit, not also a maybe', () => {
  const overlap = maybes.filter((m) =>
    hits.some((h) => h.start === m.start && h.day === m.day),
  );
  assert.equal(overlap.length, 0, 'hits and maybes must be disjoint');
});

test('every hit carries a live stream link', () => {
  assert.ok(hits.every((h) => h.live?.startsWith('https://')));
});

/* ------------------------------------------ rubric kind: artistic vs doc */
// "F.D." is film documentar. „Tunul de lemn" is a film artistic and can never
// air under it, so documentary strands must not be offered as places the
// target might be hiding — they were padding the list and burying the real
// candidates.

test('documentary rubrics are classified as such', () => {
  for (const t of ['F.D. Jocurile copilariei', 'Film documentar', 'Portrete în timp. Andrei Vartic',
                   'Povestea generațiilor', 'Destine de colecție']) {
    assert.equal(genericFilmRubric(t)?.kind, 'documentar', t);
  }
});

test('feature-film rubrics are classified as artistic', () => {
  for (const t of ['F.A. Tunul de lemn', 'Film artistic', 'Filmoteca', 'Cinemateca']) {
    assert.equal(genericFilmRubric(t)?.kind, 'artistic', t);
  }
});

test('heritage umbrellas stay candidates — they carry either kind', () => {
  for (const t of ['Moldova de patrimoniu', 'Tezaur']) {
    assert.equal(genericFilmRubric(t)?.kind, 'necunoscut', t);
  }
});

test('F.D. must not be mistaken for F.A.', () => {
  assert.notEqual(genericFilmRubric('F.D (Binecuvântarea)')?.kind, 'artistic');
  assert.equal(genericFilmRubric('F.A. ceva')?.kind, 'artistic');
});

test('maybes carry rubricKind so the UI can split them', () => {
  const slots = [
    { day: 1, dayName: 'luni', start: '09:00', end: '09:10', title: 'F.D (Ceva)', filler: false },
    { day: 1, dayName: 'luni', start: '18:30', end: '19:00', title: 'Moldova de patrimoniu', filler: false },
  ];
  const res = [{ ok: true, channel: { id: 'moldova-2', name: 'Moldova 2', live: 'https://x/', schedule: 'https://y/' }, slots }];
  const { maybes } = findMatches(res, [{ title: 'Tunul de lemn', fuzzy: true }]);
  assert.equal(maybes.length, 2);
  assert.equal(maybes.find(m=>m.start==='09:00').rubricKind, 'documentar');
  assert.equal(maybes.find(m=>m.start==='18:30').rubricKind, 'necunoscut');
});

/* ------------------------------------------------- Cyrillic listings ---- */
// Moldova 1/2 are bilingual and really do list Russian-language films in
// Cyrillic. fold() used to blank every Cyrillic character, so those slots
// folded to "" and could never match — including the Russian aliases in the
// watchlist, which were dead on arrival.

test('Cyrillic transliterates instead of vanishing', () => {
  assert.equal(fold('Деревянная пушка'), 'derevyannaya pushka');
  assert.equal(fold('Всегда на высоте'), 'vsegda na vysote');
  assert.notEqual(fold('Любить'), '');
});

test('a Russian-title alias matches a Cyrillic listing', () => {
  assert.equal(scoreTitle('Деревянная пушка', 'Деревянная пушка')?.kind, 'exact');
  assert.equal(scoreTitle('Деревянная пушка', 'Х/ф "Деревянная пушка", 1986')?.kind, 'phrase');
});

test('Cyrillic folding does not invent matches', () => {
  assert.equal(scoreTitle('Деревянная пушка', 'Всегда на высоте'), null);
});

/* ------------------------------------------------- four-letter tokens --- */
// "Tunul de lemn" is two content tokens and "lemn" is four letters. With the
// old tolerance floor it got zero fuzzy slack, so one garbled character meant
// no hit and no maybe at all.

test('a one-character slip in a four-letter token still matches', () => {
  assert.ok(scoreTitle('Tunul de lemn', 'Tunul de lemne'), 'inflected ending');
  assert.ok(scoreTitle('Tunul de lemn', 'TunuI de lemn'), 'capital-I for l');
});

test('fuzzy slack still cannot carry a match on one token alone', () => {
  assert.equal(scoreTitle('Tunul de lemn', 'Barcă de lemn'), null);
  assert.equal(scoreTitle('Tunul de lemn', 'Casa de lemn'), null);
});

/* ----------------------------------------------------- priority flag ---- */

test('priority is carried onto the hit, not just stored in the watchlist', () => {
  const slots = [{ day: 6, dayName: 'sâmbătă', start: '12:00', end: '13:13', title: 'F.A. Tunul de lemn', filler: false }];
  const res = [{ ok: true, channel: { id: 'moldova-2', name: 'Moldova 2', live: 'https://x/', schedule: 'https://y/' }, slots }];
  const out = findMatches(res, [
    { title: 'Tunul de lemn', priority: true, fuzzy: true },
    { title: 'Lăutarii', fuzzy: true },
  ]);
  assert.equal(out.hits.length, 1);
  assert.equal(out.hits[0].priority, true);
});

test('a non-priority title is explicitly marked false, never undefined', () => {
  const slots = [{ day: 6, dayName: 'sâmbătă', start: '20:00', end: '21:30', title: 'Lăutarii', filler: false }];
  const res = [{ ok: true, channel: { id: 'moldova-1', name: 'Moldova 1', live: 'https://x/', schedule: 'https://y/' }, slots }];
  const out = findMatches(res, [{ title: 'Lăutarii', fuzzy: true }]);
  assert.equal(out.hits[0].priority, false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
