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

import { DAY_NAMES_RO, fetchPage } from './trm.mjs';

/** Chișinău's region id in TV Mail's listings. */
export const TVMAIL_REGION_KISHINEV = 1844;
const TVMAIL_API = 'https://tv.mail.ru/ajax/service/channels/schedule/';

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

/** One event from the AJAX API → a slot, built from its unix timestamps. */
function eventToSlot(ev) {
  if (!ev || !ev.name || !ev.start_ts) return null;
  const start = new Date(ev.start_ts * 1000);
  const end = ev.stop_ts ? new Date(ev.stop_ts * 1000) : null;
  const day = chisinauWeekday(start);
  return {
    day,
    dayName: day ? DAY_NAMES_RO[day] : null,
    date: ymd.format(start),
    start: hhmm.format(start),
    end: end ? hhmm.format(end) : null,
    title: String(ev.name).trim(),
    filler: false,
    source: 'tvmail',
  };
}

/**
 * A full week of programming for one channel.
 *
 * The page itself only ever renders today and a little of tomorrow, but its
 * day-picker calls this endpoint, and it answers plain JSON for any date —
 * seven days of it. That is the difference between "you'll hear about it the
 * night before" and "you can see Saturday's film on Monday", which for a
 * broadcast that may not recur for years is the whole game.
 *
 * Timestamps are unix seconds, so no timezone parsing is involved: the
 * instant is exact and only the *display* is converted to Chișinău.
 *
 * One request per day; a day that fails is skipped rather than aborting the
 * week, because six days of schedule beats none.
 */
export async function fetchTvMailWeek(channelId, {
  days = 7,
  regionId = TVMAIL_REGION_KISHINEV,
  fetcher = fetchTvMailDay,
  paceMs = 1500,
  cache = {},
  maxFetch = 3,
} = {}) {
  const out = [];
  const errors = [];
  const today = ymd.format(new Date());
  const byDate = cache[channelId] ?? (cache[channelId] = {});
  let fetched = 0;

  // Anything already older than today is dead weight; drop it so the cache
  // file cannot grow without bound.
  for (const d of Object.keys(byDate)) if (d < today) delete byDate[d];

  for (let i = 0; i < days; i++) {
    const date = ymd.format(new Date(Date.now() + i * 86400_000));

    // Today's listing can still change, so it is always refreshed. Future days
    // are fetched once and then reused — which is what keeps this workable:
    // after the first run only the newly-appearing day needs a request, so a
    // run costs one or two calls instead of seven.
    const haveFresh = byDate[date] && date !== today;
    if (!haveFresh && fetched < maxFetch) {
      try {
        if (fetched > 0 && paceMs) await new Promise((r) => setTimeout(r, paceMs));
        fetched++;
        byDate[date] = (await fetcher(channelId, date, regionId))
          .map(eventToSlot)
          .filter(Boolean);
      } catch (err) {
        errors.push(`${date}: ${err.message ?? err}`);
        // Keep whatever was cached for this date rather than blanking it: a
        // captcha today must not erase a schedule fetched successfully
        // yesterday. This source is rate-limited and WILL fail sometimes.
      }
    }
    if (byDate[date]) out.push(...byDate[date]);
  }

  return {
    slots: out,
    parsedAnyTime: out.length > 0,
    dayAssumed: false,
    errors,
    fetched,
    cache,
  };
}

/**
 * One day from the API. Asks for JSON explicitly and names the channel page as
 * referer — without that it answers with an HTML page, which is what a plain
 * page-fetcher was tripping over.
 */
export async function fetchTvMailDay(channelId, date, regionId = TVMAIL_REGION_KISHINEV) {
  const url = `${TVMAIL_API}?region_id=${regionId}&date=${date}&channel_id=${channelId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru,ro;q=0.9,en;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://tv.mail.ru/kishinev/channel/${channelId}/`,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  if (!body.trimStart().startsWith('{')) throw new Error('non-JSON response (rate limited?)');
  return JSON.parse(body)?.data?.events ?? [];
}

/**
 * Combine TRM's slots with TV Mail's, preferring TRM's own wording when both
 * describe the same broadcast. Identity is date+start+channel, falling back to
 * weekday+start for TRM entries that carry no date.
 */
export function mergeSlots(primary, extra) {
  const key = (s) => `${s.date ?? s.dayName ?? '?'}|${s.start ?? '?'}`;
  const merged = [...primary];
  const index = new Map();
  for (let i = 0; i < merged.length; i++) {
    index.set(key(merged[i]), i);
    index.set(`${merged[i].dayName ?? '?'}|${merged[i].start ?? '?'}`, i);
  }

  for (const s of extra) {
    // A TRM slot with no date can still be the same broadcast; check the
    // weekday form too before deciding this is genuinely new.
    const at = index.get(key(s)) ?? index.get(`${s.dayName ?? '?'}|${s.start ?? '?'}`);
    if (at === undefined) {
      index.set(key(s), merged.length);
      merged.push(s);
      continue;
    }
    // Same broadcast in both. Prefer whichever title actually says more:
    // TRM often lists a bare "Moldova de patrimoniu" where TV Mail names the
    // programme, and keeping TRM's wording would throw that name away — the
    // difference between a slot you must check by hand and one you can read.
    const have = merged[at];
    if ((s.title?.length ?? 0) > (have.title?.length ?? 0)) {
      merged[at] = { ...have, title: s.title, date: have.date ?? s.date, end: have.end ?? s.end };
    } else if (!have.date && s.date) {
      merged[at] = { ...have, date: s.date };
    }
  }
  return merged;
}

export default { parseTvMail, mergeSlots, fetchTvMailWeek, TVMAIL_REGION_KISHINEV };
