/**
 * Title matching.
 *
 * Two jobs:
 *   1. HIT   — a watchlist title genuinely appears in a schedule slot.
 *   2. MAYBE — the slot is a generic film placeholder ("F.A.", "Film artistic",
 *              "Moldova de patrimoniu") that could be hiding a watchlist title,
 *              because TRM often lists heritage films under a rubric name only.
 *
 * The MAYBE bucket is the whole reason this project exists: an exact-match-only
 * checker would silently miss the broadcast you actually care about.
 */

import { fold, contentTokens, escapeRe } from './normalize.mjs';

/**
 * Slot titles that mean "some archive film, name not given".
 * Matched against the folded title.
 */
export const GENERIC_FILM_PATTERNS = [
  { re: /^f\s?a\b/, label: 'F.A. (film artistic)' },
  { re: /^f\s?d\b/, label: 'F.D. (film documentar)' },
  { re: /\bfilm artistic\b/, label: 'Film artistic' },
  { re: /\bfilm documentar\b/, label: 'Film documentar' },
  { re: /\bfilmoteca\b/, label: 'Filmoteca' },
  { re: /\bmoldova de patrimoniu\b/, label: 'Moldova de patrimoniu' },
  { re: /\bpatrimoniu\b/, label: 'Patrimoniu' },
  { re: /\btezaur\b/, label: 'Tezaur' },
  { re: /\bcinemateca\b/, label: 'Cinemateca' },
  { re: /\bfilme? de colectie\b/, label: 'Filme de colecție' },
  { re: /\bdestine de colectie\b/, label: 'Destine de colecție' },
  { re: /\bportrete in timp\b/, label: 'Portrete în timp' },
  { re: /\bpovestea generatiilor\b/, label: 'Povestea generațiilor' },
  { re: /\bmoldova film\b/, label: 'Moldova-Film' },
  { re: /\bcinema\b/, label: 'Cinema' },
];

/** Levenshtein distance, capped for speed. */
function levenshtein(a, b, max = 4) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Tolerance for a typo'd word: longer words earn more slack. */
function allowedTypos(word) {
  if (word.length <= 4) return 0;
  if (word.length <= 7) return 1;
  return 2;
}

/**
 * Score how well `needle` (a watched title) appears inside `haystack` (a slot title).
 * @returns {{score:number, kind:string}|null}
 */
export function scoreTitle(needle, haystack, { fuzzy = true } = {}) {
  const nFold = fold(needle);
  const hFold = fold(haystack);
  if (!nFold || !hFold) return null;

  // Exact whole-string equality — the strongest signal.
  if (nFold === hFold) return { score: 1, kind: 'exact' };

  // Whole phrase present as a word-bounded substring.
  const phraseRe = new RegExp(`(^| )${escapeRe(nFold)}( |$)`);
  if (phraseRe.test(hFold)) return { score: 0.95, kind: 'phrase' };

  const nTok = contentTokens(needle);
  const hTok = contentTokens(haystack);
  if (!nTok.length || !hTok.length) return null;

  const hSet = new Set(hTok);
  let matched = 0;
  let fuzzyUsed = 0;

  for (const t of nTok) {
    if (hSet.has(t)) {
      matched += 1;
      continue;
    }
    if (!fuzzy) continue;
    const tol = allowedTypos(t);
    if (tol === 0) continue;
    const near = hTok.some((h) => levenshtein(t, h, tol) <= tol);
    if (near) {
      matched += 0.85;
      fuzzyUsed += 1;
    }
  }

  const coverage = matched / nTok.length;

  // A single-word title matching a single word is too weak to trust unless exact.
  if (nTok.length === 1 && coverage < 1) return null;
  if (coverage < 0.75) return null;

  return {
    score: Math.min(0.9, 0.6 + coverage * 0.3),
    kind: fuzzyUsed ? 'fuzzy' : 'tokens',
  };
}

/** Does this slot look like an unnamed archive-film rubric? */
export function genericFilmLabel(title) {
  const f = fold(title);
  for (const { re, label } of GENERIC_FILM_PATTERNS) {
    if (re.test(f)) return label;
  }
  return null;
}

/**
 * Run the whole watchlist against all parsed slots.
 *
 * @param {Array} channelResults  output of trm.fetchAllChannels()
 * @param {Array} watchlist       [{ title, aliases?, fuzzy?, enabled? }]
 * @param {Object} opts
 * @returns {{hits:Array, maybes:Array}}
 */
export function findMatches(channelResults, watchlist, { includeMaybes = true } = {}) {
  const hits = [];
  const maybes = [];
  const active = watchlist.filter((w) => w.enabled !== false && w.title);

  for (const result of channelResults) {
    if (!result.ok) continue;
    const ch = result.channel;

    for (const slot of result.slots) {
      if (!slot.title) continue;

      let best = null;
      for (const entry of active) {
        const candidates = [entry.title, ...(entry.aliases ?? [])];
        for (const cand of candidates) {
          const s = scoreTitle(cand, slot.title, { fuzzy: entry.fuzzy !== false });
          if (s && (!best || s.score > best.score)) {
            best = { ...s, entry, matchedOn: cand };
          }
        }
      }

      if (best) {
        hits.push({
          channelId: ch.id,
          channel: ch.name,
          live: ch.live,
          schedule: ch.schedule,
          day: slot.day,
          dayName: slot.dayName,
          start: slot.start,
          end: slot.end,
          slotTitle: slot.title,
          watched: best.entry.title,
          matchedOn: best.matchedOn,
          confidence: Number(best.score.toFixed(2)),
          kind: best.kind,
        });
        continue;
      }

      if (includeMaybes && !slot.filler) {
        const label = genericFilmLabel(slot.title);
        if (label) {
          maybes.push({
            channelId: ch.id,
            channel: ch.name,
            live: ch.live,
            schedule: ch.schedule,
            day: slot.day,
            dayName: slot.dayName,
            start: slot.start,
            end: slot.end,
            slotTitle: slot.title,
            rubric: label,
          });
        }
      }
    }
  }

  const key = (x) => `${x.channelId}|${x.day}|${x.start}|${x.slotTitle}`;
  return {
    hits: dedupe(hits, key),
    maybes: dedupe(maybes, key),
  };
}

function dedupe(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export default { scoreTitle, genericFilmLabel, findMatches, GENERIC_FILM_PATTERNS };
