# Filmradar

Moldovan public TV still broadcasts the digitised Moldova-Film archive. It just doesn't tell
anyone in advance.

This watches the schedules for you, pings your phone when a film you care about is coming up,
and — if you want — records it off the live stream while you're asleep.

It was built for one film: **„Tunul de lemn"** (Moldova-Film, 1986). The restored version has
never been published online; everything circulating is a bad VHS rip. But it *does* get
broadcast — a confirmed past airing was Moldova 2, Saturday at 12:00, announced nowhere you'd
think to look. Nothing in the code is specific to it, though. Put any title in the watchlist.

**Live dashboard:** https://gromykko.github.io/Filmradar/

---

## Read this part first

Three things decide whether this actually works for you.

**1. You get about a day of warning, not a week.** TRM publishes only the current day's grid;
its other six weekday tabs load from an endpoint that refuses anything but a real browser on
the page. A second source (TV Mail, below) adds today plus tomorrow, which is what the horizon
now rests on. Either way a film airing Saturday does not appear on Monday — so treat this as
"tell me tonight about tomorrow", not "plan my week".

**2. Because of that, the untitled slots matter more than the titles.** Moldovan TV routinely
lists archive films under a rubric name with no title at all: `Moldova de patrimoniu`,
`Tezaur`, `F.A.`, `Filmoteca`. No amount of clever text matching can see a film that isn't
named. Those slots show up separately as **posibile**, and the recorder can capture them blind.
There are usually under a dozen a week.

**3. Recording needs your PC on.** GitHub does the watching for free, around the clock. It
cannot do the recording — its machines are temporary and would be killed mid-film. So the
recording happens on your computer, which means your computer has to be awake at air time.
See [Recording](#recording).

---

## What you get without doing anything else

It's already running. Every 30 minutes GitHub fetches the schedules, matches them against
`data/watchlist.json`, and publishes the result to the dashboard. That costs nothing and needs
no computer of yours.

What it doesn't do yet is tell *you*. For that, add Telegram — about two minutes:

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name. It gives you a token.
2. **Send your new bot a message.** Anything. A bot can't write to you until you've written to
   it first — skipping this is the usual reason people think it's broken.
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and copy the number
   at `result[0].message.chat.id`.

Then add both under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from step 1 |
| `TELEGRAM_CHAT_ID` | the number from step 3 |

Nothing to redeploy. The next run picks them up.

Email works too via a [Resend](https://resend.com) API key in `RESEND_API_KEY` + `MAIL_TO`, if
you'd rather. Set neither and it still runs — results just stay on the dashboard.

---

## Recording

`ffmpeg` does the recording, not VLC. It copies the broadcast stream straight to an MP4 with no
re-encoding, so it's fast, lossless, and light on the machine. VLC is optional and only for
*watching* live while the capture runs.

You need [Node.js 20+](https://nodejs.org) and ffmpeg:

```
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

Close and reopen the terminal afterwards, then check both answer: `node -v` and `ffmpeg -version`.

### The command

```
node recorder/record.mjs --watch --maybes
```

Leave that running. It checks every 10 minutes, waits for air time, and records. Ctrl-C stops
it cleanly and still writes a playable file.

**`--maybes` is the one that matters.** Without it, the recorder only captures slots where the
title was actually printed in the grid. With it, it also records the untitled archive rubrics —
the ones where an unlisted heritage film is most likely hiding. It will also record folk-music
programmes you don't want. That's the trade: a few gigabytes of junk against not missing the
one broadcast that matters.

### Where files land

By default in `recordings/` inside the project folder, named like
`tunul-de-lemn_moldova-2_2026-07-26.mp4`. To put them somewhere sane:

```
node recorder/record.mjs --watch --maybes --outdir C:\Filmradar\recordings
```

Budget roughly **1.7 GB per hour** of recording. A 73-minute film is about 2 GB. With `--maybes`
on both channels, expect a few GB a day — nothing deletes old recordings for you.

### Your PC must be awake

This is the part people get wrong. A film at 08:30 is exactly when Windows will have gone to
sleep. Turn sleep off while you're hunting:

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

The screen can still switch off — that doesn't matter. Undo later with
`powercfg /change standby-timeout-ac 30`.

If the machine sleeps mid-recording, the file is lost or truncated. ffmpeg's reconnect handling
covers brief network drops, not the OS suspending it for six hours.

### Leaving it running permanently

See [`recorder/install/`](recorder/install/) for Windows Task Scheduler and Linux systemd setup,
including the two settings that otherwise bite you: Task Scheduler kills tasks after 72 hours by
default, and it hides the window so you'd never see an error.

### Other options

```
node recorder/record.mjs --list              # what's coming, and what already aired
node recorder/record.mjs --now moldova-2 --mins 80   # start right now
node recorder/record.mjs --watch --vlc       # also open VLC to watch live
node recorder/record.mjs --watch --notify    # Telegram ping on start/finish
node recorder/record.mjs --watch --ics       # write a calendar file per recording
```

Stream addresses are worked out automatically from the channel's live page, at startup and again
right before each recording, because they rotate. There's nothing to configure by hand.

Recording a free-to-air broadcast you can already watch live, for yourself, is what a VCR did.
Keep it personal.

---

## Why this is more than a text search

**Untitled rubrics.** Covered above — it's the main event, and the reason an exact-match checker
would report "nothing found" on precisely the week your film airs.

**Announcements arrive before the grid does.** Moldova-Film publishes airings as prose:

> Sâmbătă, 2 mai: Ora12:00 la TV Moldova 2 cultural, "Tunul de lemn”, film artistic, 1986, regia Vasile Brescanu

`scraper/lib/announce.mjs` turns that into a real scheduled slot — channel, date, time, year,
director. It copes with `Ora12:00` glued together, mismatched quote characters, `regia` vs
`regie`, and both Romanian diacritic encodings. These land days ahead of the grid, which given
the warning horizon makes them disproportionately valuable.

**Romanian and Russian are both messy.** ș/ț exist in two different Unicode encodings and TRM
mixes both on one page, so everything folds to bare ASCII before comparison. Cyrillic is
transliterated rather than discarded — Moldova 1 and 2 are bilingual and genuinely list Russian
titles in the same grid, so without that, a Russian-language listing was invisible.

**A parser bug that would have been invisible.** TRM emits all seven weekday tab labels, then
server-renders only *today's* slots. The obvious parser reads the last label as a heading and
files every slot under Sunday. This one consumes the tab strip as a unit, attributes dayless
slots to today in Chișinău, and marks them `dayAssumed` so the dashboard shows `azi?` rather
than pretending to be certain.

**It fails loudly.** A silent false negative is the only failure that really costs you. So: if
Moldova 1 or Moldova 2 stops parsing, the run goes red and GitHub emails you, rather than
reporting a cheerful zero. Same if a slot count collapses, or if notifications stop being
delivered.

---

## Sources

| Source | What it gives |
|---|---|
| **Moldova 1**, **Moldova 2** | TRM's own grid — the main event, but published unevenly |
| **TV Mail (Chișinău)** | Second opinion on the same two channels, merged in. See below |
| **TRM culture + general news** | Announcements, which arrive before any grid updates |
| **Diez**, **Moldpres** | Moldovan press; they republish Moldova-Film announcements |
| **TVR Moldova** | Its own site publishes no grid at all, so the schedule comes from TV Mail |
| **Vocea Basarabiei** | Grid is JavaScript-loaded and came back empty. Flagged so it never cries wolf |
| ~~Facebook~~ | The best feed, and not automatable — see below |

### Why there are two sources for one channel

TRM publishes its own grid unevenly. On 27 July 2026 it served 56 slots for Sunday and,
all through Monday afternoon, six — every one of them already aired. A watcher that can
only see TRM goes blind on days like that, and quietly reports "nothing found".

So Moldova 1 and Moldova 2 are also read from TV Mail's Chișinău listings, which embed
`schema.org` JSON-LD: one `Event` per programme with absolute ISO timestamps. On that same
Monday it carried 54 and 50 further slots respectively.

The two are **merged into one channel**, not listed as two, so a film both sources carry
stays a single hit and alerts once. TRM's own wording wins where they overlap.

The side benefit is real dates. TRM's page shows a weekday and no date at all, so a slot
can only ever mean "the next Monday at 14:45". JSON-LD events carry a true calendar date,
which is what lets the recorder target one exact broadcast via `--date`.

`data/sources.json`. The parser keys off content *shape* — `HH:MM - HH:MM` then a title — not
CSS selectors, so most schedule pages work without code changes.

### Why Facebook isn't a source

The Moldova-Film page is the single best feed, and it can't be automated. Meta serves a login
wall and blocks datacenter addresses outright, which is exactly what a GitHub runner is. A
scraper there would fail *silently*, which is worse than no scraper.

So the **Anunțuri** tab on the dashboard has a paste box. Copy posts in, press Analizează, and
the same parser runs in your browser; detected airings get added with one click.

---

## Development

```
npm test              # 100 assertions across 4 suites, zero dependencies
npm run check:dry     # fetch and match, notify nothing
npm run check:debug   # the above, plus parsed samples
```

Node 20+. No runtime dependencies.

```
.github/workflows/  check.yml (every 30 min) · pages.yml (deploy)
data/               watchlist · sources · schedule · hits · state
docs/index.html     dashboard, single file, no build step
scraper/            check.mjs · lib/ · tools/ · test/
recorder/           record.mjs · timing.mjs · install/
```

---

## When something looks wrong

**A channel reports 0 slots.** The layout changed, or it renders client-side. `npm run
check:debug` shows what was parsed.

**The run went red.** That's deliberate — it means a primary channel broke, or notifications
aren't being delivered. Check the Actions log.

**Alerted once, then silence.** Alerted slots are suppressed for 10 days via `data/state.json`.
Delete the entry to re-fire.

**Scheduled runs stopped.** GitHub disables cron after 60 days of repo inactivity. Every run
commits, which counts as activity — but if it ever does stop, push anything.

**Cron runs late.** Normal. GitHub schedules on a best-effort basis and delays under load.

MIT.
