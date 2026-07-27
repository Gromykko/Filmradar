# Command reference

Everything you can type, what it does, and why the arguments look the way they do.

All commands run from the project folder:

```
cd C:\Users\alsal\Documents\GitHub\tunuldelemn
```

Requires Node 20+ and ffmpeg on PATH (`node -v`, `ffmpeg -version`).

---

## The short version

| I want to… | Command |
|---|---|
| Record what's on **right now** | `node recorder/record.mjs --now moldova-2 --mins 5` |
| Record a slot **later today** | `node recorder/record.mjs --channel moldova-2 --from 18:30 --to 19:00` |
| Record on a **specific date** | `node recorder/record.mjs --channel moldova-2 --from 12:00 --to 13:13 --date 2026-08-01` |
| Let it watch and record **by itself** | `node recorder/record.mjs --watch --maybes` |
| See what's coming | `node recorder/record.mjs --list --maybes` |
| Check the schedules now | `npm run check` |

---

## Times are always Moldova time

**Every time you type is Chișinău wall-clock — exactly the number printed in the TV
grid.** Never convert it yourself.

You are in Denmark (UTC+2). Moldova is UTC+3, so it is **one hour ahead of you**. A film
listed at 12:00 airs at 11:00 your time. You still type `--from 12:00`, and the recorder
converts. It computes the delay as a difference against Moldova's own clock, so it is
correct from any country and survives both countries' daylight-saving switches.

The dashboard shows both, e.g. `Luni 18:30–19:00 · 17:30 la tine`.

---

## Why the command says `--day duminică`

Because **TRM's grid gives a weekday, not a date.** Its page shows one day's programming
labelled `luni`…`duminică`, with no year or day number anywhere. So the only thing the
scraper can honestly record is "Sunday at 14:45".

`--day duminică` therefore means: **the next Sunday at that time.** Concretely:

- If today *is* Sunday and 14:45 hasn't passed → today.
- If today is Sunday and 14:45 has passed → refuses, because the broadcast is over.
- If today is Tuesday → the coming Sunday, five days out.

The catch: it repeats weekly, so it can only ever mean a slot within the next seven days,
and it assumes the same programme airs at the same time next week — which is a guess, not
a fact. That is why the recorder never rolls a *past* slot forward to next week: next
week's programming in that slot is unknown, and recording it would be a coin toss.

Weekday spellings accepted: `luni`, `marți`/`marti`, `miercuri`, `joi`, `vineri`,
`sâmbătă`/`sîmbătă`/`sambata`, `duminică`/`duminica`. If you omit `--day`, it means today.

### `--date` is better when you have one

```
--date 2026-08-01
```

This names **one exact broadcast**, not a weekly repeat. No ambiguity, no assumption about
next week. Use it whenever you know the real date — for example from a Moldova-Film
announcement ("Sâmbătă, 1 august, ora 12:00").

The backup schedule source (TV Mail) supplies real dates, so slots that came from it give
you `--date` automatically in the dashboard's copy button. TRM-only slots can only give
`--day`. If you pass both, `--date` wins.

---

## Recording one broadcast

```
node recorder/record.mjs --channel CHANNEL --from HH:MM [--to HH:MM] [--day NAME | --date YYYY-MM-DD]
```

Channels: `moldova-1`, `moldova-2`.

It handles all three situations by itself, so you don't have to judge which applies:

| Situation | What it does |
|---|---|
| Slot is in the future | Waits, then records. Prints both clocks and the countdown. |
| Slot already started | Joins late, records only the time remaining. |
| Slot already finished | **Refuses**, and prints the `--now` command in case you want what's on instead. |

Without `--to` it assumes 90 minutes. It always adds `--pad` minutes at each end (default
3) because broadcasters run late.

**Leave the window open.** It's a running program, not a system scheduler. If you close
it, nothing records.

---

## Recording right now

```
node recorder/record.mjs --now moldova-2 --mins 5
```

Starts instantly for the given number of minutes. Use this only for what's on air at this
moment — it ignores schedules entirely.

---

## Unattended watching

```
node recorder/record.mjs --watch --maybes
```

Polls every 10 minutes and records anything that matches. This is the mode to leave
running overnight.

`--maybes` also records the untitled archive rubrics (`Moldova de patrimoniu`, `Tezaur`,
`F.A.`) — the slots where a heritage film hides with no title, which no text matching can
ever detect. It will also capture folk-music programmes you don't want. That's the trade.

**Your PC must be awake.** Disable sleep first:

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

The screen may still switch off. Restore later with `powercfg /change standby-timeout-ac 30`.

---

## All recorder options

| Option | Meaning |
|---|---|
| `--watch` | Poll and record automatically |
| `--list` | Print what's planned, then exit. Changes nothing |
| `--maybes` | Include untitled archive rubrics |
| `--now ID` | Record a channel immediately |
| `--mins N` | Duration for `--now` (default 90) |
| `--channel ID` | Channel for a scheduled one-off |
| `--from HH:MM` | Slot start, Moldova time |
| `--to HH:MM` | Slot end, Moldova time |
| `--day NAME` | Weekday, Romanian. Default: today |
| `--date YYYY-MM-DD` | Exact date. Overrides `--day` |
| `--pad N` | Extra minutes each side (default 3) |
| `--outdir DIR` | Where files go (default: `recordings/` in the project) |
| `--poll N` | Minutes between checks in `--watch` (default 10) |
| `--vlc` | Also open VLC on the live stream |
| `--ics` | Write a calendar file per recording |
| `--notify` | Telegram on start/finish (needs the two env vars) |
| `--dry-run` | Print the ffmpeg command instead of running it |
| `--help` | This list |

---

## Checking schedules

| Command | What it does |
|---|---|
| `npm run check` | Fetch, match, notify, write `data/` |
| `npm run check:dry` | Same but sends nothing and writes nothing |
| `npm run check:debug` | Dry run plus parsed samples — use when a channel looks wrong |
| `npm test` | Full test suite, no network |
| `npm run streams:check` | Verify every channel's live stream resolves |

---

## Where recordings go

Default: `recordings/` **inside the project folder**, regardless of where you ran the
command from. Named `tunul-de-lemn_moldova-2_2026-07-27.mp4`; `--now` files are named
`manual_moldova-2_<timestamp>.mp4`.

To put them elsewhere:

```
node recorder/record.mjs --watch --maybes --outdir C:\Filmradar\recordings
```

Budget **~1.7 GB per hour**. A 73-minute film is about 2.4 GB. Nothing deletes old files
for you.

---

## Safe things to try first

```
node recorder/record.mjs --list --maybes
```
Shows the plan and records nothing. Slots that already aired are marked `deja difuzat`.

```
node recorder/record.mjs --channel moldova-2 --from 23:30 --to 23:59 --dry-run
```
Prints the exact ffmpeg command it *would* run, then waits. Ctrl-C to stop.

```
node recorder/record.mjs --now moldova-2 --mins 1
```
A one-minute real recording, about 30 MB. The fastest end-to-end proof.

---

## If something goes wrong

**`ffmpeg` not found** — `winget install Gyan.FFmpeg`, then reopen the terminal.

**"Niciun flux disponibil"** — the stream address couldn't be resolved. Check the channel
is live at https://moldova1.md/live, then retry.

**Stopping a recording** — press **Ctrl-C**. That tells ffmpeg to close the file properly.
Closing the window instead can leave an unplayable file.

**`non-existing SPS 0` in the log** — normal. It means ffmpeg joined a live stream
mid-frame. Not an error.
