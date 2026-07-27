/**
 * Parser for the Teleradio-Moldova weekly programme grids.
 *
 * Both https://trm.md/ro/moldova-1 and https://trm.md/ro/moldova-2 render a
 * "PROGRAM" block containing seven day tabs (luni…duminică). Each tab holds a
 * list of "HH:MM - HH:MM" ranges, each followed by the programme title.
 *
 * The markup around this changes; the shape does not. We therefore parse the
 * flattened text stream, tracking the most recent day heading we saw.
 */

import { toText, isolateProgramme } from './html.mjs';
import { parseAnnouncements, announcementsToSlots } from './announce.mjs';

/**
 * Built-in fallback. The real list lives in data/sources.json so you can add
 * channels without touching code — see loadSources() below.
 */
export const CHANNELS = [
  {
    id: 'moldova-1',
    name: 'Moldova 1',
    schedule: 'https://trm.md/ro/moldova-1',
    live: 'https://moldova1.md/live',
  },
  {
    id: 'moldova-2',
    name: 'Moldova 2',
    schedule: 'https://trm.md/ro/moldova-2',
    live: 'https://moldova1.md/moldova2',
  },
];

/**
 * Read the channel list from data/sources.json, falling back to CHANNELS.
 * Disabled entries are dropped.
 */
export async function loadSources(dataDir) {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const raw = await readFile(join(dataDir, 'sources.json'), 'utf8');
    const parsed = JSON.parse(raw);
    // A channel needs *a* source, but not necessarily an HTML page: TVR
    // Moldova publishes no grid anywhere, so its schedule comes purely from
    // the TV Mail API.
    const active = parsed.filter((s) => s.enabled !== false && (s.schedule || s.tvmailChannel));
    return active.length ? active : CHANNELS;
  } catch {
    return CHANNELS;
  }
}

/** Romanian weekday names → ISO weekday number (1 = Monday). */
const DAYS = [
  [1, ['luni']],
  [2, ['marti', 'marţi', 'marți']],
  [3, ['miercuri']],
  [4, ['joi']],
  [5, ['vineri']],
  [6, ['simbata', 'sîmbătă', 'sambata', 'sâmbătă', 'sîmbata', 'sambăta']],
  [7, ['duminica', 'duminică']],
];

const DAY_LOOKUP = new Map();
for (const [num, names] of DAYS) {
  for (const n of names) DAY_LOOKUP.set(n.toLowerCase(), num);
}

export const DAY_NAMES_RO = {
  1: 'luni', 2: 'marți', 3: 'miercuri', 4: 'joi',
  5: 'vineri', 6: 'sâmbătă', 7: 'duminică',
};

const TIME_RANGE = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})$/;

/** Lines that are page furniture, never programme titles. */
const NOISE = new RegExp(
  [
    '^publicitate$',
    '^program$',
    '^emisiuni$',
    '^stiri trm$',
    '^ştiri trm$',
    '^contacte$',
    '^carieră$',
    '^cariera$',
    '^despre noi',
    '^radio moldova',
    '^teleradio-moldova$',
    '^telefilm',
    '^cic$',
    '^live$',
    '^ro$', '^ru$', '^en$',
    '^#$',
    '^transmisiuni în direct$',
    '^vezi arhiva$',
    '^share$', '^tweet$',
    '^\\d+$',
  ].join('|'),
  'i',
);

function isNoise(line) {
  const t = line.trim();
  if (!t || t.length > 200) return true;
  if (NOISE.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^[-–—•·|]+$/.test(t)) return true;
  return false;
}

function dayFromLine(line) {
  const t = line.trim().toLowerCase().replace(/[^a-zăâîșşțţ]/g, '');
  if (!t || t.length > 12) return null;
  return DAY_LOOKUP.get(t) ?? null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Current ISO weekday (1=Mon) in Chișinău, regardless of where this runs. */
export function todayInChisinau() {
  const name = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: 'Europe/Chisinau',
  }).format(new Date());
  const map = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };
  return map[name] ?? null;
}

/**
 * Parse one channel page into an array of slots.
 *
 * The tricky part: the page emits all seven weekday words as tab labels
 * ("luni marţi miercuri … duminică") and then, server-side, renders only the
 * CURRENT day's slots — the other tabs are filled in by JavaScript we never
 * run. A naive parser reads the last tab label as a heading and files every
 * slot under Sunday.
 *
 * So we only treat a weekday word as a heading when it appears ALONE. A run of
 * two or more consecutive weekday words is a tab strip and is discarded. If we
 * finish with slots that have no day, we attribute them to today in Chișinău
 * and flag them `dayAssumed` so nothing downstream over-trusts it.
 *
 * @returns {{slots:Array, parsedAnyTime:boolean, dayAssumed:boolean}}
 */
export function parseSchedule(html, { assumeToday = true } = {}) {
  const text = toText(isolateProgramme(html));
  const lines = text.split('\n');

  const slots = [];
  let currentDay = null;
  let pending = null; // a time range awaiting its title
  let sawAnyTime = false;
  let dayRun = []; // consecutive weekday words seen with nothing between them

  const flushDayRun = () => {
    let run = dayRun;
    dayRun = [];
    if (!run.length) return;

    // A complete tab strip is seven DISTINCT weekdays in a row. Consume exactly
    // those seven — anything left over is a genuine section heading that
    // happened to sit immediately after the tabs.
    while (run.length >= 7) {
      const head = run.slice(0, 7);
      if (new Set(head).size !== 7) break;
      run = run.slice(7);
    }

    // Exactly one weekday word standing alone = a real section heading.
    if (run.length === 1) currentDay = run[0];
    // Anything else is ambiguous; leave the day context untouched rather than
    // guessing and mis-filing a whole day of programming.
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const day = dayFromLine(line);
    if (day) {
      dayRun.push(day);
      pending = null;
      continue;
    }
    flushDayRun();

    const range = line.match(TIME_RANGE);
    if (range) {
      sawAnyTime = true;
      pending = {
        start: `${pad(+range[1])}:${range[2]}`,
        end: `${pad(+range[3])}:${range[4]}`,
      };
      continue;
    }

    const only = line.match(TIME_ONLY);
    if (only) {
      sawAnyTime = true;
      pending = { start: `${pad(+only[1])}:${only[2]}`, end: null };
      continue;
    }

    if (pending) {
      if (isNoise(line)) {
        // "Publicitate" etc. still occupies a slot but isn't a film; keep it so
        // the grid stays contiguous, but mark it.
        slots.push({
          day: currentDay,
          dayName: currentDay ? DAY_NAMES_RO[currentDay] : null,
          start: pending.start,
          end: pending.end,
          title: line,
          filler: true,
        });
        pending = null;
        continue;
      }
      slots.push({
        day: currentDay,
        dayName: currentDay ? DAY_NAMES_RO[currentDay] : null,
        start: pending.start,
        end: pending.end,
        title: line,
        filler: false,
      });
      pending = null;
    }
  }
  flushDayRun();

  // Only today's tab is server-rendered, so slots usually arrive dayless.
  // Attribute them to today in Chișinău, but mark the guess as a guess.
  let dayAssumed = false;
  if (assumeToday) {
    const orphans = slots.filter((s) => s.day == null);
    if (orphans.length) {
      const today = todayInChisinau();
      if (today) {
        dayAssumed = true;
        for (const s of orphans) {
          s.day = today;
          s.dayName = DAY_NAMES_RO[today];
          s.dayAssumed = true;
        }
      }
    }
  }

  return { slots, parsedAnyTime: sawAnyTime, dayAssumed };
}

/** Fetch with a browser-ish UA — TRM 403s some default agents. */
export async function fetchPage(url, { timeoutMs = 25000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8,ru;q=0.7',
          'Cache-Control': 'no-cache',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message ?? lastErr}`);
}

/**
 * Extract headline-ish lines from a news page, so an announced premiere can be
 * caught before it ever reaches a schedule grid. Returns pseudo-slots with no
 * time, which the matcher treats like any other title.
 */
export function parseNewsFeed(html) {
  const text = toText(isolateProgramme(html));
  const seen = new Set();
  const slots = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    // Headlines: sentence-length, not navigation, not a date stamp.
    if (line.length < 25 || line.length > 180) continue;
    if (/^\d{1,2}\s/.test(line)) continue;
    if (isNoise(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ day: null, dayName: null, start: null, end: null, title: line, filler: false, news: true });
  }
  return { slots, parsedAnyTime: false, dayAssumed: false };
}

/**
 * Fetch + parse every configured channel. Never throws; reports per-channel errors.
 *
 * `tvmailCache` is read from and written back to data/tvmail-cache.json by the
 * caller. TV Mail rate-limits and will hand back a captcha page if pushed, so
 * the week it gives us is kept on disk: a block on Tuesday must not wipe the
 * Saturday listing fetched on Monday. Channels are fetched sequentially rather
 * than in parallel for the same reason — a burst is what trips the limiter.
 */
export async function fetchAllChannels({ channels = CHANNELS, tvmailCache = {} } = {}) {
  const results = await Promise.all(
    channels.map(async (ch) => {
      let altAdded = 0;
      let altError = null;
      try {
        // Channels with no page of their own (TVR Moldova) skip straight to
        // the API merge below.
        const html = ch.schedule ? await fetchPage(ch.schedule) : '';
        let parsed;
        if (!ch.schedule) {
          parsed = { slots: [], parsedAnyTime: false, dayAssumed: false };
        } else if (ch.newsOnly) {
          parsed = parseNewsFeed(html);
        } else {
          parsed = parseSchedule(html);
        }

        // News pages sometimes carry an explicit broadcast announcement
        // ("Sâmbătă, 2 mai: Ora 12:00 la TV Moldova 2 cultural, «Titlu»…").
        // Those name a channel AND an exact time, so they're far more
        // actionable than a bare headline — merge them in as real slots.
        // Second source for the same channel. TRM's grid is unreliable day to
        // day, so anything it missed gets filled in from TV Mail's structured
        // listings — merged into this channel, not added as another one, so a
        // film both sources carry stays one hit and alerts once. A failure
        // here is logged and ignored: the backup must never take down the
        // primary read.
        if (ch.tvmailChannel) {
          try {
            const { fetchTvMailWeek, mergeSlots } = await import('./tvmail.mjs');
            const alt = await fetchTvMailWeek(ch.tvmailChannel, {
              days: ch.tvmailDays ?? 7,
              cache: tvmailCache,
            });
            if (alt.slots.length) {
              const before = parsed.slots.length;
              parsed = {
                ...parsed,
                slots: mergeSlots(parsed.slots, alt.slots),
                parsedAnyTime: parsed.parsedAnyTime || alt.parsedAnyTime,
              };
              altAdded = parsed.slots.length - before;
            }
            if (alt.errors.length) altError = alt.errors.join('; ');
          } catch (err) {
            altError = String(err.message ?? err);
          }
        }

        if (ch.newsOnly || ch.scanAnnouncements) {
          const announced = announcementsToSlots(parseAnnouncements(toText(html)));
          if (announced.length) {
            parsed = { ...parsed, slots: [...announced, ...parsed.slots] };
          }
        }

        // Some sources render their grid client-side and legitimately come back
        // empty. Flagging those as warnings every 30 min would train you to
        // ignore warnings, so known-empty sources stay quiet.
        // Deliberately NOT a slot-count threshold. TRM publishes its grid
        // unevenly: 56 slots for one day, 6 for the next (observed 27 Jul 2026
        // — Monday showed only 00:00-05:55 all afternoon). A minimum-count
        // canary fired on five consecutive healthy runs before this was
        // removed, which is exactly how you teach someone to ignore a red X.
        // Only "the page contains no time strings at all" is unambiguous.
        let warning = null;
        if (!parsed.parsedAnyTime && !ch.newsOnly && !ch.expectEmpty) {
          warning = 'No time slots found — page layout may have changed.';
        }

        return {
          channel: ch,
          slots: parsed.slots,
          ok: true,
          warning,
          dayAssumed: parsed.dayAssumed,
          empty: parsed.slots.length === 0,
          bytes: html.length,
          altAdded,
          altError,
        };
      } catch (err) {
        return { channel: ch, slots: [], ok: false, error: String(err.message ?? err) };
      }
    }),
  );
  return results;
}

export default { CHANNELS, parseSchedule, fetchPage, fetchAllChannels, DAY_NAMES_RO };
