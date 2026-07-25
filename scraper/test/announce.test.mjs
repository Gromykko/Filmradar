#!/usr/bin/env node
/**
 * Test suite for scraper/lib/announce.mjs — no framework, just assertions.
 * Run: node scraper/test/announce.test.mjs
 *
 * Covers parsing Moldova-Film Facebook announcements, which are messier than
 * the TRM grid: mixed quote characters, "Ora12:00" with no space, mismatched
 * regia/regie spelling, and screening (non-TV) announcements.
 */

import assert from 'node:assert/strict';
import { parseAnnouncements, announcementsToSlots, CHANNEL_ALIASES } from '../lib/announce.mjs';

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

console.log('\nannounce — real examples from the Moldova-Film page');

const tunulPost =
  'Sâmbătă, 2 mai: Ora12:00 la TV Moldova 2 cultural, "Tunul de lemn”, film artistic, 1986, regia Vasile Brescanu, scenariul Nicolae Esinenco;';

const stradaPost =
  'Sâmbătă, 2 mai: Ora 22:30 la TV Moldova 2 cultural, "Strada felinarelor stinse”, film artistic, 1991, regie Valeriu Gagiu;';

const screeningPost =
  'Sâmbătă 4 iulie la 20:30 Parcul Alunelul în cadrul Seri de Cronograf va fi difuzat filmul “Fii fericită, Iulia” în memoria regizorului Iacob Burghiu';

test('parses the "Tunul de lemn" TV announcement', () => {
  const [a] = parseAnnouncements(tunulPost);
  assert.ok(a, 'expected one announcement');
  assert.equal(a.title, 'Tunul de lemn');
  assert.equal(a.channel, 'moldova-2');
  assert.equal(a.time, '12:00');
  assert.equal(a.year, 1986);
  assert.equal(a.director, 'Vasile Brescanu');
  assert.equal(a.kind, 'tv');
  assert.equal(a.dayName, 'sâmbătă');
  assert.equal(a.dayOfMonth, 2);
  assert.equal(a.month, 'mai');
});

test('parses the "Strada felinarelor stinse" TV announcement (regie, not regia)', () => {
  const [a] = parseAnnouncements(stradaPost);
  assert.equal(a.title, 'Strada felinarelor stinse');
  assert.equal(a.channel, 'moldova-2');
  assert.equal(a.time, '22:30');
  assert.equal(a.year, 1991);
  assert.equal(a.director, 'Valeriu Gagiu');
  assert.equal(a.kind, 'tv');
});

test('handles "Ora12:00" glued with no space', () => {
  const [a] = parseAnnouncements(tunulPost);
  assert.equal(a.time, '12:00');
});

test('handles mismatched opening/closing quotes: straight open, curly close', () => {
  const raw = 'Marți, 5 mai: Ora 20:00 la Moldova 1, "Un film oarecare”, film artistic, 1980, regia X Y;';
  const [a] = parseAnnouncements(raw);
  assert.equal(a.title, 'Un film oarecare');
  assert.equal(a.channel, 'moldova-1');
});

test('handles curly-both and straight-both quote styles too', () => {
  const curly = parseAnnouncements('Luni, 1 iunie: Ora 10:00 la Moldova 1, “Film Curly”, 1975;')[0];
  assert.equal(curly.title, 'Film Curly');
  const straight = parseAnnouncements('Luni, 1 iunie: Ora 10:00 la Moldova 1, "Film Straight", 1975;')[0];
  assert.equal(straight.title, 'Film Straight');
});

test('both examples together parse into two distinct announcements', () => {
  const combined = parseAnnouncements(`${tunulPost}\n${stradaPost}`);
  assert.equal(combined.length, 2);
  assert.equal(combined[0].title, 'Tunul de lemn');
  assert.equal(combined[1].title, 'Strada felinarelor stinse');
});

console.log('\nannounce — screening (non-TV) announcements');

test('screening announcement is kind "screening", not "tv"', () => {
  const [a] = parseAnnouncements(screeningPost);
  assert.equal(a.kind, 'screening');
  assert.equal(a.channel, null);
});

test('a comma INSIDE the title is preserved, not truncated', () => {
  const [a] = parseAnnouncements(screeningPost);
  assert.equal(a.title, 'Fii fericită, Iulia');
});

test('director extracted even as "regizorului" (genitive form)', () => {
  const [a] = parseAnnouncements(screeningPost);
  assert.equal(a.director, 'Iacob Burghiu');
});

test('screening time parsed from bare "la HH:MM"', () => {
  const [a] = parseAnnouncements(screeningPost);
  assert.equal(a.time, '20:30');
  assert.equal(a.dayName, 'sâmbătă');
  assert.equal(a.dayOfMonth, 4);
  assert.equal(a.month, 'iulie');
});

console.log('\nannounce — no announcements present');

test('plain unrelated text returns an empty array, never throws', () => {
  assert.deepEqual(parseAnnouncements('Bun venit pe pagina noastră! Nu uitați să dați like.'), []);
});

test('empty and non-string input returns []', () => {
  assert.deepEqual(parseAnnouncements(''), []);
  assert.deepEqual(parseAnnouncements(null), []);
  assert.deepEqual(parseAnnouncements(undefined), []);
});

console.log('\nannounce — channel alias normalisation');

test('CHANNEL_ALIASES maps every documented spelling to the right canonical id', () => {
  assert.equal(CHANNEL_ALIASES['TV Moldova 2 cultural'], 'moldova-2');
  assert.equal(CHANNEL_ALIASES['Moldova 2 cultural'], 'moldova-2');
  assert.equal(CHANNEL_ALIASES['Moldova2'], 'moldova-2');
  assert.equal(CHANNEL_ALIASES['Moldova 1'], 'moldova-1');
});

test('detects "Moldova2" glued with no space inside a post', () => {
  const raw = 'Joi, 10 iulie: Ora 18:00 la Moldova2, "Alt Film”, 1999;';
  const [a] = parseAnnouncements(raw);
  assert.equal(a.channel, 'moldova-2');
});

console.log('\nannouncementsToSlots');

test('converts weekday name to the correct ISO weekday number', () => {
  const anns = parseAnnouncements(tunulPost); // sâmbătă = Saturday = 6
  const [slot] = announcementsToSlots(anns);
  assert.equal(slot.day, 6);
  assert.equal(slot.dayName, 'sâmbătă');
});

test('screening Saturday also maps to ISO day 6', () => {
  const anns = parseAnnouncements(screeningPost);
  const [slot] = announcementsToSlots(anns);
  assert.equal(slot.day, 6);
});

test('produces zero-padded HH:MM start times and null end', () => {
  const anns = parseAnnouncements(tunulPost);
  const [slot] = announcementsToSlots(anns);
  assert.equal(slot.start, '12:00');
  assert.equal(slot.end, null);
  assert.match(slot.start, /^\d{2}:\d{2}$/);
});

test('single-digit hour is zero-padded ("la 9:05" → "09:05")', () => {
  const raw = 'Vineri 3 iulie la 9:05 Parcul Central va fi difuzat filmul "Un Film”';
  const [a] = parseAnnouncements(raw);
  assert.equal(a.time, '09:05');
  const [slot] = announcementsToSlots(a ? [a] : []);
  assert.equal(slot.start, '09:05');
});

test('carries channelId and kind through onto the slot', () => {
  const anns = parseAnnouncements(tunulPost);
  const [slot] = announcementsToSlots(anns);
  assert.equal(slot.channelId, 'moldova-2');
  assert.equal(slot.kind, 'tv');
  assert.equal(slot.announcement, true);
  assert.equal(slot.filler, false);
});

test('a title with a comma survives the full announce → slot pipeline', () => {
  const anns = parseAnnouncements(screeningPost);
  const [slot] = announcementsToSlots(anns);
  assert.equal(slot.title, 'Fii fericită, Iulia');
});

test('announcementsToSlots tolerates non-array input', () => {
  assert.deepEqual(announcementsToSlots(null), []);
  assert.deepEqual(announcementsToSlots(undefined), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
