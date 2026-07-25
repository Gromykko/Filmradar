/**
 * Romanian-aware text normalisation.
 *
 * Moldovan TV listings are wildly inconsistent about diacritics: the same film
 * shows up as "Tunul de lemn", "TUNUL DE LEMN", "Tunul de Lemn", and Romanian
 * uses two competing Unicode encodings for ș/ț (comma-below U+0219/U+021B, the
 * correct one, and cedilla U+015F/U+0163, the legacy Microsoft one). TRM's CMS
 * mixes both. So we fold everything down to bare ASCII before comparing.
 */

const DIACRITICS = {
  ă: 'a', â: 'a', á: 'a', à: 'a', ä: 'a', å: 'a', ã: 'a',
  î: 'i', í: 'i', ì: 'i', ï: 'i',
  ș: 's', ş: 's', // comma-below AND cedilla
  ț: 't', ţ: 't',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ç: 'c', ñ: 'n', ý: 'y',
};

/**
 * Cyrillic → Latin. Moldova 1 and Moldova 2 are bilingual state channels and
 * genuinely list Russian-language films in Cyrillic in the same grid as the
 * Romanian ones ("Всегда на высоте" was in the real Moldova 1 grid the day
 * this was written). Without this, fold() blanked every Cyrillic character,
 * so such a slot folded to an empty string and could never match anything —
 * including the Russian-title aliases in the watchlist, which were dead on
 * arrival. Soviet-era Moldova-Film titles circulate under Russian names, so
 * this is the difference between seeing that listing and never seeing it.
 *
 * Only lowercase forms are needed: fold() lowercases before this runs.
 */
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
  // Ukrainian/Moldovan Cyrillic strays that turn up in archive metadata
  і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u',
};

/** Fold to lowercase ASCII, collapse punctuation and whitespace to single spaces. */
export function fold(input) {
  if (!input) return '';
  let s = String(input).toLowerCase();

  // Decompose then strip combining marks — catches anything not in our table.
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  s = s.replace(/[^\x00-\x7f]/g, (ch) => {
    const nfc = ch.normalize('NFC');
    return DIACRITICS[ch] ?? DIACRITICS[nfc] ?? CYRILLIC[ch] ?? CYRILLIC[nfc] ?? ' ';
  });

  // Typographic quotes and dashes → plain
  s = s.replace(/[„”“"«»’‘'`]/g, ' ').replace(/[–—−]/g, '-');

  // Everything that isn't a letter, digit or space becomes a space
  s = s.replace(/[^a-z0-9 ]+/g, ' ');

  return s.replace(/\s+/g, ' ').trim();
}

/** Split folded text into word tokens. */
export function tokens(input) {
  const f = fold(input);
  return f ? f.split(' ') : [];
}

/**
 * Romanian stopwords — ignored when scoring fuzzy matches so that
 * "Tunul de lemn" vs "Tunul din lemn" still scores high, while a listing
 * that merely contains "de" and "la" doesn't score at all.
 */
export const STOPWORDS = new Set([
  'de', 'din', 'la', 'cu', 'si', 'in', 'pe', 'un', 'o', 'al', 'a', 'ale',
  'lui', 'ei', 'sa', 'sau', 'ce', 'ca', 'pentru', 'the', 'and', 'of',
]);

/** Content-bearing tokens only. Falls back to all tokens if everything is a stopword. */
export function contentTokens(input) {
  const all = tokens(input);
  const kept = all.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  return kept.length ? kept : all;
}

/** Escape a string for safe use inside a RegExp. */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default { fold, tokens, contentTokens, escapeRe, STOPWORDS };
