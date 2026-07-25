/**
 * When to start recording, and for how long.
 *
 * Split out of record.mjs purely so it can be tested: record.mjs parses argv
 * and starts work at import time, so it can't be pulled into a test file.
 *
 * The whole subtlety here is that TRM publishes only the CURRENT day's grid.
 * data/hits.json therefore always contains slots that have already aired, and
 * a scheduler that treats "negative time until start" as "start now" will
 * cheerfully record 46 minutes of whatever happens to be on instead.
 */

export const TZ = 'Europe/Chisinau';

export const DAYS = {
  luni: 1, 'marți': 2, marti: 2, miercuri: 3, joi: 4, vineri: 5,
  'sâmbătă': 6, sambata: 6, 'sîmbătă': 6, 'duminică': 7, duminica: 7,
};

/** Current wall-clock parts in Chișinău, wherever this machine actually is. */
export function chisinauParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const wd = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };
  return { day: wd[get('weekday')], hour: +get('hour'), minute: +get('minute') };
}

/**
 * Milliseconds from now until {weekday, HH:MM} in Chișinău. Computed as a
 * delta against Chișinău's own clock, so it holds from any host timezone and
 * across DST changes.
 *
 * A slot earlier today yields a NEGATIVE value and is deliberately left
 * negative rather than rolled forward a week — next week's programming in that
 * slot is unknown, so recording it would be a guess. planSlot() decides
 * whether that past slot is a late join or a skip.
 */
export function msUntil(dayName, hhmm, now = chisinauParts()) {
  const target = DAYS[String(dayName || '').toLowerCase()];
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!target || !Number.isFinite(h) || !Number.isFinite(m)) return null;

  let dDays = target - now.day;
  if (dDays < 0) dDays += 7;
  const deltaMin = dDays * 1440 + (h * 60 + m) - (now.hour * 60 + now.minute);
  return deltaMin * 60_000;
}

/** Slot length in minutes; 90 when the grid gives no end time. */
export function durationMins(slot) {
  if (!slot.start || !slot.end) return 90;
  const [sh, sm] = slot.start.split(':').map(Number);
  const [eh, em] = slot.end.split(':').map(Number);
  let d = (eh * 60 + em) - (sh * 60 + sm);
  if (d <= 0) d += 1440; // crosses midnight
  return d;
}

/**
 * Decide what to do with one hit.
 *
 * @returns {{skip:true, reason:string} |
 *           {skip:false, ms:number, startIn:number, mins:number,
 *            elapsedMin:number, remainingMin:number, late:boolean}}
 */
export function planSlot(hit, { pad = 3, now = chisinauParts() } = {}) {
  const ms = msUntil(hit.dayName, hit.start, now);
  if (ms == null) return { skip: true, reason: 'unparsable' };

  const slotMins = durationMins(hit);
  const elapsedMin = Math.max(0, -ms / 60_000);

  // Finished. Recording now would capture whatever replaced it.
  if (elapsedMin >= slotMins) return { skip: true, reason: 'aired' };

  const late = elapsedMin > 0;
  const remainingMin = slotMins - elapsedMin;
  return {
    skip: false,
    ms,
    startIn: ms - pad * 60_000,
    // A late join has no "before" padding left to spend — only trailing slack.
    mins: Math.ceil(remainingMin) + pad * (late ? 1 : 2),
    elapsedMin,
    remainingMin,
    late,
  };
}
