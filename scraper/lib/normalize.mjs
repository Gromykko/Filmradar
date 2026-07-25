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

/** Fold to lowercase ASCII, collapse punctuation and whitespace to single spaces. */
export function fold(input) {
  if (!input) return '';
  let s = String(input).toLowerCase();

  // Decompose then strip combining marks — catches anything not in our table.
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  s = s.replace(/[^\x00-\x7f]/g, (ch) => DIACRITICS[ch] ?? DIACRITICS[ch.normalize('NFC')] ?? ' ');

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
