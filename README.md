# Filmradar

Watches Moldovan TV schedules for film titles and notifies you — Telegram and email — when one is about to air.

Built to catch **„Tunul de lemn"** (Moldova-Film, 1986). The restored version has never been published online; only low-quality VHS rips circulate. But it *does* get broadcast — a confirmed past airing was **Moldova 2, Saturday, 12:00** — with no announcement anywhere you'd normally look.

Works for any title, any channel. Nothing about it is Tunul-specific.

---

## How it works

```
GitHub Actions (every 30 min)
   ├─ fetch TV schedule grids          → parse into time slots
   ├─ fetch news/culture feeds         → parse broadcast announcements
   ├─ match everything against data/watchlist.json
   ├─ Telegram + email if something hits
   └─ commit data/*.json back to the repo
                    │
GitHub Pages ───────┘   dashboard reads those JSON files
                    │
recorder/ (your PC or VPS, optional)
   └─ polls hits.json → resolves stream → ffmpeg records at air time
```

No server, no database, no cost. Actions does the work on a timer; Pages serves a static dashboard.

---

## Setup

### 1. Push

```bash
git remote add origin https://github.com/USERNAME/filmradar.git
git push -u origin main
```

### 2. Pages

Settings → Pages → Source: **GitHub Actions**.

### 3. Notification secrets

Settings → Secrets and variables → Actions → New repository secret.

| Secret | How to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token |
| `TELEGRAM_CHAT_ID` | Send your bot any message, open `api.telegram.org/bot<TOKEN>/getUpdates`, copy `result[0].message.chat.id` |
| `RESEND_API_KEY` | [resend.com](https://resend.com), free tier |
| `MAIL_TO` | your email address |

SMTP works too: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (needs `npm i nodemailer`). Set nothing and it still runs — results land in the Actions summary.

Optional repo **variable** `SITE_URL` → your Pages URL, adds a dashboard link to emails.

### 4. Test

Actions → **Check TV schedules** → Run workflow → tick `dry_run`.

---

## How much warning you actually get

Be clear-eyed about this. TRM server-renders **only the current day's grid**; the other six
weekday tabs load over AJAX from `Programs/ajaxUpdateProgramsLst`, which returns an empty
payload to any request that isn't a live browser session on the page. So the grid gives
**hours** of notice, not days, and only for today.

That is why the other two paths matter more than they look:

- **Announcements** (Moldova-Film via TRM, Diez, Moldpres) name a channel and an exact time
  and appear *days* before the grid does. `scraper/lib/announce.mjs` turns them into real
  scheduled slots.
- **`recorder --watch --maybes`** doesn't need warning at all — it sits there and captures
  the untitled archive slots as they air.

Checking every 30 minutes covers the grid's short horizon. Nothing here can see next
Tuesday, and nothing pretends to.

## What makes this more than a string search

**Generic rubrics.** TV listings routinely hide archive films behind a rubric name — `F.A.`, `Film artistic`, `Moldova de patrimoniu`, `Tezaur`, `Cinemateca` — with no title at all. An exact-match checker reports "nothing found" on precisely the week your film airs. Those slots surface separately as **posibile**. Fewer than a dozen a week; worth a glance.

**Broadcast announcements.** Moldova-Film publishes airings as prose, before the grid updates:

> Sâmbătă, 2 mai: Ora12:00 la TV Moldova 2 cultural, "Tunul de lemn”, film artistic, 1986, regia Vasile Brescanu

`scraper/lib/announce.mjs` parses that into a real scheduled slot — channel, date, time, year, director. It copes with `Ora12:00` glued together, mismatched quotes (`"` opening, `”` closing), `regia` vs `regie`, and both Romanian diacritic encodings.

**Romanian text is genuinely messy.** ș/ț exist in two Unicode encodings — comma-below (correct) and cedilla (legacy Microsoft) — and TRM mixes both in the same page. Everything folds to bare ASCII before comparison, so `Poienile roșii` = `Poienile roşii` = `POIENILE ROSII`.

**A parser bug that would have been invisible.** TRM emits all seven weekday tab labels, then server-renders only *today's* slots; the rest load via JavaScript a plain fetch never runs. The obvious parser reads the last tab (`duminică`) as a heading and files every slot under Sunday. This one consumes the tab strip as a unit, attributes dayless slots to today in Chișinău, and marks them `dayAssumed` so the dashboard shows `azi?` instead of feigning certainty. Pinned by a regression test.

---

## Sources

`data/sources.json`. The parser keys off content *shape* — `HH:MM - HH:MM` then a title — not CSS selectors, so most schedule pages work without code changes.

| Source | Status |
|---|---|
| **Moldova 1**, **Moldova 2** | Server-rendered grids. Reliable. The main event. |
| **TRM culture + general news** | Scanned for announcements — these land *before* the grid updates |
| **Diez**, **Moldpres** | Moldovan press; they republish Moldova-Film announcements |
| **TVR Moldova** | No schedule grid exists — `/program-tv`, `/program`, `/grila-de-programe` all 404. Scanned for announcements instead |
| **Vocea Basarabiei** | Grid is JS-loaded and was empty when checked. Flagged `expectEmpty` so it never cries wolf. |
| ~~ARAX / Zebra TV~~ | Channel *list* only, no times. Unusable. |
| ~~Facebook~~ | **Not automatable** — see below |

### Why Facebook isn't a source

The Moldova-Film page is the single best feed — but it can't be automated. Meta serves a login wall, and blocks datacenter IPs outright, which is exactly what a GitHub Actions runner is. The Graph API can't read a page you don't own. A scraper here would fail *silently*, which is worse than no scraper.

So: the **Anunțuri** tab in the dashboard has a paste box. Copy posts, paste, hit Analizează — the same parser runs in your browser, and detected airings get added with one click. Thirty seconds, no extension, nothing to break.

For bulk title harvesting there's also:

```bash
node scraper/tools/extract-titles.mjs posts.txt          # review
node scraper/tools/extract-titles.mjs posts.txt --merge   # add
```

Scores candidates by how title-like they are. Years and directors come from the *same sentence* only, so a year from the line above can't attach to the wrong film. Run-on captures are trimmed at clause markers but never at bare prepositions — `Nunta la palat` and `La porțile Satanei` survive intact.

---

## Recording

`recorder/record.mjs` runs on your PC or VPS — not Actions, whose runners are ephemeral and would be killed mid-film.

**You never open DevTools.** TRM runs on PeerTube, so stream URLs resolve from a public API automatically — at startup and again immediately before each recording, because CDNs rotate URLs between scheduling and air time.

```bash
node recorder/record.mjs --list                    # what's coming
node recorder/record.mjs --watch --ics --notify    # record, calendar, Telegram
node recorder/record.mjs --watch --vlc             # also open VLC live
node recorder/record.mjs --watch --maybes          # also grab untitled archive slots
node recorder/record.mjs --now moldova-2 --mins 80 # right now
npm run streams                                    # warm the cache by hand
```

**`--maybes` is the one that catches an unlisted film.** TRM routinely airs archive titles
under a rubric name only — `Moldova de patrimoniu`, `Tezaur`, `F.A.` — with no title in the
grid at all, which is exactly the case no title-matcher can ever see. This records those
slots speculatively. They recur most days, so it is opt-in and it will capture folk-music
programmes too; that is the price of not missing the one broadcast that matters.

ffmpeg does the recording, not VLC — `-c copy`, no re-encode, and it writes a clean MP4 on
Ctrl-C. `--vlc` is separate: it opens VLC on the live stream so you can *watch* while the
capture runs.

On a VPS, point at published data instead of a checkout:

```bash
node recorder/record.mjs --watch \
  --remote https://raw.githubusercontent.com/USERNAME/filmradar/main/data/hits.json
```

`-c copy`, so no re-encode — nearly free on a small VPS. `--pad 5` for slack; broadcasters run late. Install files for systemd and Windows Task Scheduler are in `recorder/install/`.

Personal time-shifting of a free-to-air broadcast you can already watch live — what a VCR does. Keep it personal.

---

## Development

```bash
npm test              # 83 assertions across 4 suites, zero dependencies
npm run check:dry     # fetch + match, notify nothing
npm run check:debug   # plus parsed samples
python3 -m http.server 8080 --directory docs
```

Node 20+. No runtime dependencies at all.

---

## Troubleshooting

**A channel reports 0 slots.** Layout changed, or it renders client-side. `npm run check:debug` shows the parsed text. If client-side, set `"expectEmpty": true` or disable it.

**Scheduled runs stopped.** GitHub disables cron after 60 days of repo inactivity. This commits on every change, which counts — but if it ever stops, push anything.

**Hit in the summary, no notification.** Alerted slots are suppressed for 10 days via `data/state.json`. Delete the key to re-fire.

**Cron runs late.** Normal — GitHub schedules best-effort and delays under load. For tight timing, run the checker from a VPS cron.

---

## Layout

```
.github/workflows/  check.yml (cron) · pages.yml (deploy)
data/               watchlist · sources · schedule · hits · state
docs/index.html     dashboard, single file, no build
scraper/
  check.mjs         entry point
  lib/              normalize · html · trm · match · announce · streams · notify
  tools/            extract-titles · discover-streams
  test/             all.mjs runs core + announce + streams + timing
recorder/           record.mjs · timing.mjs · streams.json · install/
```

MIT.
