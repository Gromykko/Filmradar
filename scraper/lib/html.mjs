/**
 * Minimal, dependency-free HTML → text conversion.
 *
 * We deliberately do NOT use a DOM parser. TRM's markup changes without warning
 * (it's a WordPress-era CMS with hand-edited templates), so selector-based
 * scraping is brittle. Instead we flatten to text and pattern-match on the
 * shape of the content — "HH:MM - HH:MM" followed by a title — which has been
 * stable for years even as the surrounding markup churns.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  bdquo: '„', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', hellip: '…',
  agrave: 'à', eacute: 'é', acirc: 'â', icirc: 'î', abreve: 'ă',
  scedil: 'ș', tcedil: 'ț', middot: '·', bull: '•', shy: '',
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+[0-9]*);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
    });
}

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/**
 * Strip an HTML document to newline-separated visible text.
 * Block-level tags become line breaks so that a "time" node and its adjacent
 * "title" node land on separate lines and stay pairable.
 */
export function toText(html) {
  if (!html) return '';
  let s = String(html);

  // Kill anything that never renders
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ');
  s = s.replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, ' ');
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, ' ');

  // Block boundaries → newlines
  s = s.replace(/<\s*(br|hr)\s*\/?\s*>/gi, '\n');
  s = s.replace(
    /<\/?\s*(p|div|li|ul|ol|tr|td|th|table|section|article|header|footer|nav|h[1-6]|span|time|dt|dd|a|figure)\b[^>]*>/gi,
    '\n',
  );

  // Any remaining tag disappears
  s = s.replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);

  // Normalise whitespace: trim each line, drop empties, cap blank runs
  return s
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Pull the class/id-bearing chunk of HTML most likely to hold the schedule,
 * so day-tab detection isn't confused by unrelated page furniture.
 * Returns the original html untouched if no obvious container is found.
 */
export function isolateProgramme(html) {
  if (!html) return '';
  const s = String(html);
  const markers = [/id=["']?program/i, /class=["'][^"']*\bprogram\b/i, /<h[1-6][^>]*>\s*PROGRAM/i];
  for (const re of markers) {
    const m = s.match(re);
    if (m && m.index != null) {
      // Take from the marker to the footer, or to the end.
      const start = Math.max(0, s.lastIndexOf('<', m.index));
      const footIdx = s.toLowerCase().indexOf('<footer', start);
      return s.slice(start, footIdx > start ? footIdx : undefined);
    }
  }
  return s;
}

export default { toText, decodeEntities, isolateProgramme };
