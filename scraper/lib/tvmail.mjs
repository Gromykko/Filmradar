/**
 * Second opinion on the Moldova 1 / Moldova 2 schedule, from TV Mail's
 * Chișinău listings (tv.mail.ru/kishinev/channel/<id>/).
 *
 * Why this exists: TRM's own site publishes its grid unevenly. On 27 Jul 2026
 * it served 56 slots for Sunday and, all through Monday afternoon, six — all
 * of them already aired. A watcher that can only see TRM sees nothing on days
 * like that. TV Mail carried 46 entries for the same Monday plus the start of
 * Tuesday.
 *
 * The happy part: the page embeds schema.org JSON-LD, one Event per
 * programme, with absolute ISO timestamps. So unlike the TRM path — which
 * scrapes flattened text and has to *guess* the weekday, because the page
 * renders only one day's tab — every slot here arrives with a real date. No
 * dayAssumed, no inference.
 *
 * Merged into the existing channel rather than added as a separate one, so a
 * film listed by both sources stays a single hit and alerts once.
 */

import { DAY_NAMES_RO } from './trm.mjs';

/** ISO weekday (1=Mon) for an instant, as seen in Chișinău. */
function chisinauWeekday(date) {
  const name = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', timeZone: 'Europe/Chisinau',
  }).format(date);
  const map = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };
  return map[name] ?? null;
}

const hhmm = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Chisinau',
});
/** "YYYY-MM-DD" as it falls in Chișinău — en-CA formats exactly that way. */
const ymd = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Chisinau',
});

/**
 * Pull the JSON-LD Event list out of a TV Mail channel page.
 * Returns slots shaped exactly like trm.parseSchedule() so the matcher and
 * the dashboard need no special case — plus `date`, which TRM can't supply.
 */
export function parseTvMail(html) {
  const slots = [];
  let sawAnyTime = false;

  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue; // one malformed block must not lose the others
    }
    for (const ev of Object.values(parsed)) {
      if (!ev || ev['@type'] !== 'Event' || !ev.name || !ev.startDate) continue;
      const start = new Date(ev.startDate);
      if (Number.isNaN(start.getTime())) continue;
      const end = ev.endDate ? new Date(ev.endDate) : null;
      const day = chisinauWeekday(start);
      sawAnyTime = true;
      slots.push({
        day,
        dayName: day ? DAY_NAMES_RO[day] : null,
        date: ymd.format(start),          // real calendar date — TRM has none
        start: hhmm.format(start),
        end: end && !Number.isNaN(end.getTime()) ? hhmm.format(end) : null,
        title: String(ev.name).trim(),
        filler: false,
        source: 'tvmail',
      });
    }
  }

  return { slots, parsedAnyTime: sawAnyTime, dayAssumed: false };
}

/**
 * Combine TRM's slots with TV Mail's, preferring TRM's own wording when both
 * describe the same broadcast. Identity is date+start+channel, falling back to
 * weekday+start for TRM entries that carry no date.
 */
export function mergeSlots(primary, extra) {
  const key = (s) => `${s.date ?? s.dayName ?? '?'}|${s.start ?? '?'}`;
  const seen = new Set(primary.map(key));
  const merged = [...primary];
  for (const s of extra) {
    // A TRM slot with no date can still be the same broadcast; match on the
    // weekday form too before deciding this is genuinely new.
    if (seen.has(key(s)) || seen.has(`${s.dayName ?? '?'}|${s.start ?? '?'}`)) continue;
    seen.add(key(s));
    merged.push(s);
  }
  return merged;
}

export default { parseTvMail, mergeSlots };
