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
/**
 * Rubrics that mean "some archive film, name not given".
 *
 * `kind` matters as much as the pattern. A feature film cannot air in a
 * documentary strand: "F.D." is *film documentar*, so „Tunul de lemn" — a
 * film artistic — will never be hiding behind it. Lumping both together
 * padded the list with slots that could not possibly contain the target and
 * buried the ones that could.
 *
 *   'artistic'  — feature-film strand. The target could genuinely be here.
 *   'documentar'— documentary strand. A feature film cannot be here.
 *   'necunoscut'— heritage/archive umbrella that carries either.
 */
export const GENERIC_FILM_PATTERNS = [
  { re: /^f\s?a\b/, label: 'F.A. (film artistic)', kind: 'artistic' },
  { re: /\bfilm artistic\b/, label: 'Film artistic', kind: 'artistic' },
  { re: /\bfilmoteca\b/, label: 'Filmoteca', kind: 'artistic' },
  { re: /\bcinemateca\b/, label: 'Cinemateca', kind: 'artistic' },
  { re: /\bfilme? de colectie\b/, label: 'Filme de colecție', kind: 'artistic' },
  { re: /\bmoldova film\b/, label: 'Moldova-Film', kind: 'artistic' },
  { re: /\bcinema\b/, label: 'Cinema', kind: 'artistic' },

  { re: /^f\s?d\b/, label: 'F.D. (film documentar)', kind: 'documentar' },
  { re: /\bfilm documentar\b/, label: 'Film documentar', kind: 'documentar' },
  { re: /\bportrete in timp\b/, label: 'Portrete în timp', kind: 'documentar' },
  { re: /\bpovestea generatiilor\b/, label: 'Povestea generațiilor', kind: 'documentar' },
  { re: /\bdestine de colectie\b/, label: 'Destine de colecție', kind: 'documentar' },

  // Heritage umbrellas. TRM uses these for restored features AND for
  // documentaries, so they stay in the main list rather than being filtered
  // out — this is exactly where an unlisted feature is most likely to sit.
  { re: /\bmoldova de patrimoniu\b/, label: 'Moldova de patrimoniu', kind: 'necunoscut' },
  { re: /\btezaur\b/, label: 'Tezaur', kind: 'necunoscut' },
  { re: /\bpatrimoniu\b/, label: 'Patrimoniu', kind: 'necunoscut' },
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

/**
 * Tolerance for a typo'd word: longer words earn more slack.
 *
 * The floor is 3, not 4, deliberately. "Tunul de lemn" reduces to exactly two
 * content tokens, and "lemn" is four letters — at a floor of 4 it got zero
 * tolerance, so a single garbled character ("lemne", "Iemn") dropped coverage
 * to 0.5 and produced no hit AND no maybe. For the one film this project
 * exists to catch, that is the difference between an alert and silence.
 * Coverage still has to clear 0.75 overall, so a lone fuzzy 4-letter token
 * can never carry a match on its own.
 */
function allowedTypos(word) {
  if (word.length <= 3) return 0;
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

/** Shortest a real feature film is likely to be, in minutes. */
export const FEATURE_MIN_MINUTES = 50;

/** True when a slot is too short to plausibly be a feature film. */
export function isShortForFeature(slot) {
  if (!slot?.start || !slot?.end) return false; // unknown length proves nothing
  const [sh, sm] = slot.start.split(':').map(Number);
  const [eh, em] = slot.end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return false;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 1440; // crosses midnight
  return mins < FEATURE_MIN_MINUTES;
}

/** Does this slot look like an unnamed archive-film rubric? Returns the label. */
export function genericFilmLabel(title) {
  return genericFilmRubric(title)?.label ?? null;
}

/** As above, but keeps the kind — 'artistic' | 'documentar' | 'necunoscut'. */
export function genericFilmRubric(title) {
  const f = fold(title);
  for (const p of GENERIC_FILM_PATTERNS) {
    if (p.re.test(f)) return { label: p.label, kind: p.kind };
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
          // Real calendar date when the source supplied one (TV Mail's JSON-LD
          // does; TRM's grid never can). Lets the recorder target one exact
          // broadcast instead of "the next Monday at this time".
          date: slot.date ?? null,
          start: slot.start,
          end: slot.end,
          slotTitle: slot.title,
          watched: best.entry.title,
          matchedOn: best.matchedOn,
          confidence: Number(best.score.toFixed(2)),
          kind: best.kind,
          // Carried through so a hit on the title this project exists for
          // doesn't read like a hit on any of the other two dozen.
          priority: best.entry.priority === true,
          // A feature film does not fit in 25 minutes. TRM runs portrait
          // documentaries titled after the film they discuss — the first live
          // match this project ever produced was "Singur în fața dragostei
          // (Veniamin Apostol)" in a 25-minute slot, which is a programme
          // about the film, not the film. Flagged rather than filtered: the
          // grid's own times are sometimes wrong, and a missed broadcast
          // costs far more than a wasted look.
          shortForFeature: isShortForFeature(slot),
        });
        continue;
      }

      // A "maybe" is meant to be a BROADCAST SLOT whose film is unnamed — a
      // thing you could actually tune in to or record. A news headline that
      // happens to contain "Moldova-Film" or "patrimoniu" is an article, has
      // no air time, and cannot be recorded; listing it here buried the real
      // rubric slots under permanent, undateable noise. News still earns its
      // place through announce.mjs, which extracts a channel and an exact
      // time and produces a genuine scheduled slot.
      if (includeMaybes && !slot.filler && !slot.news && slot.start) {
        const rubric = genericFilmRubric(slot.title);
        if (rubric) {
          const label = rubric.label;
          maybes.push({
            channelId: ch.id,
            channel: ch.name,
            live: ch.live,
            schedule: ch.schedule,
            day: slot.day,
            dayName: slot.dayName,
            date: slot.date ?? null,
            start: slot.start,
            end: slot.end,
            slotTitle: slot.title,
            rubric: label,
            // 'documentar' means a feature film cannot be here — the UI and
            // the recorder use this to stop treating those as candidates.
            rubricKind: rubric.kind,
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
