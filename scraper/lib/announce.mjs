/**
 * Parser for Moldova-Film Facebook page broadcast announcements.
 *
 * That page posts plain-text announcements naming an exact channel and air
 * time, often days before the TRM grid itself is updated — e.g.:
 *
 *   Sâmbătă, 2 mai: Ora12:00 la TV Moldova 2 cultural, "Tunul de lemn”,
 *   film artistic, 1986, regia Vasile Brescanu, scenariul Nicolae Esinenco;
 *
 * It also posts screening announcements for physical venues (no channel):
 *
 *   Sâmbătă 4 iulie la 20:30 Parcul Alunelul în cadrul Seri de Cronograf
 *   va fi difuzat filmul "Fii fericită, Iulia” în memoria regizorului
 *   Iacob Burghiu
 *
 * The formatting is inconsistent by nature (copy-pasted by a human, not
 * templated): "Ora12:00" with no space, opening/closing quote characters
 * that don't match each other, "regia" vs "regie", trailing semicolons. This
 * parser is built to tolerate exactly that mess rather than assume a clean
 * format.
 */

import { fold } from './normalize.mjs';

/** Romanian weekday name → ISO weekday number (1 = Monday), canonical spelling. */
export const DAY_NAMES_RO = {
  1: 'luni', 2: 'marți', 3: 'miercuri', 4: 'joi',
  5: 'vineri', 6: 'sâmbătă', 7: 'duminică',
};

// Every spelling variant we might meet in the wild, including both
// competing Unicode encodings for ș/ț (comma-below vs legacy cedilla).
const WEEKDAY_VARIANTS = [
  [1, ['luni']],
  [2, ['marți', 'marţi', 'marti']],
  [3, ['miercuri']],
  [4, ['joi']],
  [5, ['vineri']],
  [6, ['sâmbătă', 'sîmbătă', 'sambata', 'sâmbata', 'sîmbata', 'sambăta']],
  [7, ['duminică', 'duminica']],
];

const WEEKDAY_LOOKUP = new Map();
const ALL_WEEKDAY_SPELLINGS = [];
for (const [num, names] of WEEKDAY_VARIANTS) {
  for (const n of names) {
    WEEKDAY_LOOKUP.set(n, num);
    ALL_WEEKDAY_SPELLINGS.push(n);
  }
}
// Longest first so a shorter spelling can never eat part of a longer one.
ALL_WEEKDAY_SPELLINGS.sort((a, b) => b.length - a.length);

const MONTHS_RO = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie',
  'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

/** ISO weekday number by canonical Romanian name — inverse of DAY_NAMES_RO. */
const ISO_BY_DAY_NAME = new Map(
  Object.entries(DAY_NAMES_RO).map(([num, name]) => [name, Number(num)]),
);

/**
 * Known ways the page (or its commenters) writes each channel name, mapped to
 * a canonical id. Extend this as new spellings show up — it's a plain object
 * so no code changes are needed elsewhere.
 */
export const CHANNEL_ALIASES = {
  'TV Moldova 2 cultural': 'moldova-2',
  'Moldova 2 cultural': 'moldova-2',
  'TV Moldova 2': 'moldova-2',
  'Moldova 2': 'moldova-2',
  'Moldova2': 'moldova-2',
  'TV Moldova 1': 'moldova-1',
  'Moldova 1': 'moldova-1',
  'Moldova1': 'moldova-1',
};

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Find the first channel alias that appears in `chunk`, folded so casing/diacritics/spacing don't matter. */
function detectChannel(chunk) {
  const folded = fold(chunk);
  if (!folded) return null;
  const entries = Object.entries(CHANNEL_ALIASES).sort(
    (a, b) => fold(b[0]).length - fold(a[0]).length,
  );
  for (const [alias, id] of entries) {
    const fa = fold(alias);
    if (fa && folded.includes(fa)) return id;
  }
  return null;
}

// Title in any quote-style combination the page has used:
// „…” (correct Romanian), "…” (straight open / curly close — the common
// real-world case), "…" (curly both), "…" (straight both). Mixed
// opening/closing quote characters are the norm here, not the exception.
const TITLE_RE = /[„"“]([^„"“”]+)[”"]/;

// "Ora12:00" (no space), "Ora 22:30", "ora 12.00" — always a colon or dot
// between hour and minute, and "ora"/"Ora" glued or spaced before the digits.
const TIME_ORA_RE = /\bora\s*(\d{1,2})[:.](\d{2})/i;
// Screening posts skip "ora" entirely and just say "la 20:30".
const TIME_LA_RE = /\bla\s+(\d{1,2}):(\d{2})/i;

const YEAR_RE = /\b(19[3-9]\d|20[0-2]\d)\b/;
const DIRECTOR_RE = /(?:regizat\s+de|regizor\w*|regia|regie)\s+([^,;.\n]+)/i;

function parseChunk(chunk) {
  let time = null;
  const oraMatch = chunk.match(TIME_ORA_RE);
  if (oraMatch) {
    time = `${pad(+oraMatch[1])}:${oraMatch[2]}`;
  } else {
    const laMatch = chunk.match(TIME_LA_RE);
    if (laMatch) time = `${pad(+laMatch[1])}:${laMatch[2]}`;
  }

  const channel = detectChannel(chunk);

  const titleMatch = chunk.match(TITLE_RE);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const yearMatch = chunk.match(YEAR_RE);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  const dirMatch = chunk.match(DIRECTOR_RE);
  const director = dirMatch ? dirMatch[1].trim() : null;

  return { time, channel, title, year, director };
}

/**
 * Parse free-form Facebook post text into a list of broadcast/screening
 * announcements. Never throws on text with no recognisable announcements —
 * it just returns [].
 *
 * @param {string} text
 * @returns {Array<{title:?string, channel:?string, time:?string, dayName:string,
 *   dayOfMonth:number, month:string, year:?number, director:?string,
 *   kind:'tv'|'screening', raw:string}>}
 */
export function parseAnnouncements(text) {
  if (!text || typeof text !== 'string') return [];

  // Match on a lowercased copy so we don't need case-insensitive regex flags
  // to fight with Romanian diacritics; toLowerCase() maps ă/â/î/ș/ț correctly
  // and preserves string length/offsets, so indices still line up with the
  // original text (which we need untouched for quotes, casing of names, etc.).
  const lower = text.toLowerCase();
  const weekdayAlt = ALL_WEEKDAY_SPELLINGS.join('|');
  const monthAlt = MONTHS_RO.join('|');
  const headerRe = new RegExp(`(${weekdayAlt})\\s*,?\\s*(\\d{1,2})\\s+(${monthAlt})`, 'g');

  const matches = [...lower.matchAll(headerRe)];
  if (!matches.length) return [];

  const results = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const chunk = text.slice(start, end).trim();
    if (!chunk) continue;

    const isoDay = WEEKDAY_LOOKUP.get(m[1]);
    if (isoDay == null) continue; // shouldn't happen — guard against the unexpected anyway
    const dayOfMonth = parseInt(m[2], 10);
    const month = m[3];

    const { time, channel, title, year, director } = parseChunk(chunk);

    results.push({
      title,
      channel,
      time,
      dayName: DAY_NAMES_RO[isoDay],
      dayOfMonth,
      month,
      year,
      director,
      kind: channel ? 'tv' : 'screening',
      raw: chunk,
    });
  }
  return results;
}

/**
 * Convert parsed announcements into the same slot shape produced by
 * scraper/lib/trm.mjs, so findMatches() in match.mjs can consume both
 * uniformly. Announcements never carry an end time.
 *
 * @param {Array} announcements  output of parseAnnouncements()
 */
export function announcementsToSlots(announcements) {
  if (!Array.isArray(announcements)) return [];
  return announcements.map((a) => ({
    day: ISO_BY_DAY_NAME.get(a.dayName) ?? null,
    dayName: a.dayName,
    start: a.time ?? null,
    end: null,
    title: a.title,
    filler: false,
    announcement: true,
    channelId: a.channel ?? null,
    kind: a.kind,
  }));
}

export default { parseAnnouncements, announcementsToSlots, CHANNEL_ALIASES, DAY_NAMES_RO };
