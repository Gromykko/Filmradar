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

export const DAY_NAMES = {
  1: 'luni', 2: 'marți', 3: 'miercuri', 4: 'joi',
  5: 'vineri', 6: 'sâmbătă', 7: 'duminică',
};

/** Romanian name of today's weekday in Chișinău — the default for a one-off recording. */
export function todayNameRo(now = chisinauParts()) {
  return DAY_NAMES[now.day] ?? null;
}

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

/**
 * Milliseconds until a specific Chișinău calendar date + time, e.g.
 * ("2026-08-02", "12:00"). Unlike msUntil(), which repeats weekly, this names
 * one exact moment — what you want when an announcement gives a real date
 * ("Sâmbătă, 2 mai: ora 12:00") rather than a grid weekday.
 *
 * Chișinău wall-clock is converted to a true instant by guessing UTC and
 * correcting twice, which settles DST without hardcoding any offset.
 */
export function msUntilDate(dateStr, hhmm, nowMs = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  const [h, mi] = String(hhmm || '').split(':').map(Number);
  if (!m || !Number.isFinite(h) || !Number.isFinite(mi)) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const partsAt = (ms) => {
    const o = {};
    for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
    let hh = +o.hour; if (hh === 24) hh = 0;
    return Date.UTC(+o.year, +o.month - 1, +o.day, hh, +o.minute, +o.second);
  };

  const want = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = want;
  for (let i = 0; i < 3; i++) guess += want - partsAt(guess);
  return guess - nowMs;
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
export function planSlot(hit, { pad = 3, now = chisinauParts(), nowMs = Date.now() } = {}) {
  // An explicit date wins over a weekday: it names one moment, not a repeat.
  const ms = hit.date
    ? msUntilDate(hit.date, hit.start, nowMs)
    : msUntil(hit.dayName, hit.start, now);
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
