#!/usr/bin/env node
/**
 * Pull probable film titles out of pasted text (Facebook posts, press releases,
 * news articles) and emit watchlist entries.
 *
 * Facebook blocks automated fetching, so the Moldova-Film page can't be scraped
 * — but you can select the posts, copy, and paste them here.
 *
 *   node scraper/tools/extract-titles.mjs posts.txt
 *   pbpaste | node scraper/tools/extract-titles.mjs          # macOS
 *   Get-Clipboard | node scraper/tools/extract-titles.mjs    # PowerShell
 *
 *   --merge     merge into data/watchlist.json instead of printing
 *   --min N     ignore titles shorter than N characters (default 4)
 *
 * Everything is heuristic. Review the output before merging — it's tuned to
 * over-suggest rather than miss a title.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const WATCHLIST = join(ROOT, 'data/watchlist.json');

const args = process.argv.slice(2);
const MERGE = args.includes('--merge');
const MIN = Number(args[args.indexOf('--min') + 1]) || 4;
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));

/** Words that signal "this is a film being talked about", used to boost confidence. */
const FILM_CUES = /\b(film|filmul|pelicul|regi[ez]|difuz|premier|restaur|digitaliz|arhiv|patrimoniu|ecran|proiec|cinema|lungmetraj|scurtmetraj)/i;

/** Phrases that are never film titles, however they're capitalised. */
const BLOCKLIST = [
  /^(moldova[\s-]?film|studioul|agen[țt]ia|ministerul|republica moldova|chi[șs]in[ăa]u)$/i,
  /^(vezi mai mult|afl[ăa] mai mult|distribuie|comenteaz|abonea)/i,
  /^(foto|video|live|breaking|update|share|like)$/i,
  /^(anul|luna|ziua|ora|astăzi|maine|ieri)$/i,
  /facebook|youtube|instagram|http/i,
];

function isBlocked(s) {
  return BLOCKLIST.some((re) => re.test(s.trim()));
}

function clean(s) {
  return s
    .replace(/^[\s„”“"«»'‘’(\[]+|[\s„”“"«»'‘’)\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

function extractYear(context) {
  const m = context.match(/\b(19[3-9]\d|20[0-2]\d)\b/);
  return m ? Number(m[1]) : null;
}

function extractDirector(context) {
  const m = context.match(/regi[ea](?:\s*:|\s+lui)?\s+([A-ZĂÂÎȘȚ][\wăâîșțĂÂÎȘȚ.-]+(?:\s+[A-ZĂÂÎȘȚ][\wăâîșțĂÂÎȘȚ.-]+){0,2})/);
  return m ? m[1].trim() : null;
}

/**
 * Leading noise that regularly ends up glued to the front of a captured title
 * ("Astăzi vă prezentăm filmul X", "Pelicula X"). Stripped repeatedly until
 * the title stops shrinking.
 */
const LEAD_NOISE = /^(?:ast[ăa]zi|azi|m[âa]ine|ieri|v[ăa]|v[ăa]\s+prezent[ăa]m|prezent[ăa]m|urm[ăa]rea?[țt]i|viziona[țt]i|revede[țt]i|nou|acum)\s+/i;
const LEAD_CUE = /^(?:filmul|film|pelicula|pelicul[ăa]|lungmetrajul|scurtmetrajul|documentarul|studioul|moldova[\s-]?film)\s+/i;

/**
 * Where a title ends and the sentence carries on. An unquoted title like
 * "Pelicula Nunta la palat a fost digitalizată..." must be cut at " a fost",
 * not thrown away — otherwise unquoted mentions are silently lost.
 */
/*
 * Only clause markers — deliberately NO bare prepositions. "la", "din", "în",
 * "de" all appear inside real titles (Nunta la palat, La porțile Satanei,
 * Ultima lună de toamnă); cutting there would shred the very titles we want.
 */
const TRAIL_CUT = /\s+(?:a fost|au fost|va fi|vor fi|a devenit|este|sunt|era|care|despre|regia|regizat|regizat de|difuzat|disponibil|restaurat|digitaliz|poate fi|se afl)\b.*$/i;

function stripLead(s) {
  let out = clean(s);
  for (let i = 0; i < 6; i++) {
    const before = out;
    out = clean(out.replace(LEAD_NOISE, '').replace(LEAD_CUE, ''));
    if (out === before) break;
  }
  return out;
}

/** Trim a run-on capture back to the plausible title, if that leaves enough. */
function trimTrail(s) {
  const cut = clean(s.replace(TRAIL_CUT, ''));
  // Only accept the truncation if something substantial survives.
  return cut.length >= MIN && cut.split(/\s+/).length >= 2 ? cut : s;
}

/**
 * Split into sentence-ish units. Context must never cross these boundaries —
 * otherwise a year from the previous sentence gets attached to this title,
 * which is exactly the bug this function exists to prevent.
 */
function segments(text) {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZĂÂÎȘȚ„"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function extract(text) {
  const found = new Map(); // folded title -> {title, score, year, director, context}

  const add = (raw, score, context) => {
    const title = trimTrail(stripLead(raw));
    if (title.length < MIN || title.length > 80) return;
    if (isBlocked(title)) return;
    // Needs real letters
    if (!/[a-zăâîșțA-ZĂÂÎȘȚ]{2}/.test(title)) return;
    // A surviving quote mark means we over-captured across a boundary
    if (/[„”“"«»]/.test(title)) return;
    // Sentence fragments, not titles
    if (title.split(/\s+/).length > 8) return;
    if (/\b(?:a fost|au fost|va fi|vor fi|este|sunt|care|despre|pentru)\b/i.test(title)) return;

    const key = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const prev = found.get(key);
    found.set(key, {
      title,
      score: (prev?.score ?? 0) + score + (FILM_CUES.test(context) ? 2 : 0),
      year: prev?.year ?? extractYear(context),
      director: prev?.director ?? extractDirector(context),
      context: prev?.context ?? context.slice(0, 130).replace(/\s+/g, ' ').trim(),
    });
  };

  for (const seg of segments(text)) {
    // 1. Romanian quotes „…" — by far the strongest signal in Moldovan press
    for (const m of seg.matchAll(/„([^”"„]{3,80})["”]/g)) add(m[1], 6, seg);

    // 2. Straight and curly double quotes
    for (const m of seg.matchAll(/"([^"]{3,80})"/g)) add(m[1], 4, seg);
    for (const m of seg.matchAll(/[“«]([^”»]{3,80})[”»]/g)) add(m[1], 4, seg);

    // 3. Explicit cue word followed by an unquoted title, up to a clause break.
    //    Case-insensitive: posts start sentences with "Pelicula …".
    for (const m of seg.matchAll(
      /\b(?:filmul|pelicula|lungmetrajul|scurtmetrajul|documentarul)\s+([^,.;:!?\n(„"]{3,60})/gi,
    )) {
      add(m[1], 5, seg);
    }

    // 4. ALL-CAPS runs (Moldova-Film posts love these)
    for (const m of seg.matchAll(/\b([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ\s-]{4,50}[A-ZĂÂÎȘȚ])\b/g)) {
      const t = m[1].trim();
      if (t.split(/\s+/).length <= 6) {
        add(t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), 3, seg);
      }
    }

    // 5. Title immediately followed by a plausible film year in parens.
    //    Anchored to a segment/quote/cue boundary so it can't swallow the
    //    whole preceding clause.
    for (const m of seg.matchAll(
      /(?:^|[„"“«]|\b(?:filmul|pelicula|documentarul)\s+)([^\n,;(„"”]{3,60}?)\s*\((?:19[3-9]\d|20[0-2]\d)\)/gi,
    )) {
      add(m[1], 5, seg);
    }
  }

  return [...found.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function readInput() {
  if (file) return readFile(resolve(file), 'utf8');
  if (process.stdin.isTTY) {
    console.error('Nicio intrare. Dă un fișier sau pipe text:\n'
      + '  node scraper/tools/extract-titles.mjs posts.txt');
    process.exit(1);
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const text = await readInput();
const results = extract(text);

if (!results.length) {
  console.error('Niciun titlu identificat. Textul conține titluri între ghilimele sau cu majuscule?');
  process.exit(1);
}

const existing = JSON.parse(await readFile(WATCHLIST, 'utf8').catch(() => '[]'));
const have = new Set(existing.map((e) => slug(e.title)));

const candidates = results.map((r) => ({
  id: slug(r.title),
  title: r.title,
  aliases: [],
  ...(r.year ? { year: r.year } : {}),
  ...(r.director ? { director: r.director } : {}),
  fuzzy: r.title.split(/\s+/).length > 1, // single words are too risky for fuzzy
  enabled: true,
  _score: r.score,
  _context: r.context,
  _duplicate: have.has(slug(r.title)),
}));

if (!MERGE) {
  console.error(`\n${candidates.length} candidați (scor mai mare = mai probabil un titlu de film):\n`);
  for (const c of candidates) {
    const flag = c._duplicate ? ' [deja în listă]' : '';
    console.error(`  ${String(c._score).padStart(2)}  ${c.title}${c.year ? ` (${c.year})` : ''}${flag}`);
    console.error(`      …${c._context}…`);
  }
  console.error('\nRevizuiește, apoi rulează din nou cu --merge, sau copiază JSON-ul de mai jos.\n');

  const clean = candidates.filter((c) => !c._duplicate)
    .map(({ _score, _context, _duplicate, ...rest }) => rest);
  console.log(JSON.stringify(clean, null, 2));
} else {
  const toAdd = candidates.filter((c) => !c._duplicate)
    .map(({ _score, _context, _duplicate, ...rest }) => rest);
  if (!toAdd.length) {
    console.error('Nimic nou de adăugat — toți candidații există deja.');
    process.exit(0);
  }
  const merged = [...existing, ...toAdd];
  await writeFile(WATCHLIST, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  console.error(`✓ Am adăugat ${toAdd.length} titluri în data/watchlist.json:`);
  for (const t of toAdd) console.error(`    ${t.title}`);
  console.error('\nVerifică fișierul și șterge ce nu e film înainte de commit.');
}
