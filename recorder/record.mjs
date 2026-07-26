#!/usr/bin/env node
/**
 * Phase 2 — open the stream and record it at air time.
 *
 * Runs on your PC or VPS (NOT in GitHub Actions — Actions runners are
 * ephemeral and would be killed mid-film). It polls data/hits.json, and when
 * a watched title is due, waits for the slot and captures it with ffmpeg.
 *
 * The headline change from the old version: you never open DevTools. Stream
 * URLs are resolved live from the channel's public page via
 * scraper/lib/streams.mjs (PeerTube API under the hood) — on startup, and
 * again right before every single recording, because a CDN can rotate the
 * URL between when a slot was scheduled and when it airs.
 * recorder/streams.json is kept only as a warm cache/fallback for the rare
 * case the live lookup itself fails at the worst possible moment.
 *
 *   node recorder/record.mjs --watch                    poll and record
 *   node recorder/record.mjs --list                     show what is scheduled
 *   node recorder/record.mjs --now moldova-2 --mins 80   record right now
 *   node recorder/record.mjs --watch --vlc               also open VLC live
 *   node recorder/record.mjs --watch --ics               also write a .ics per recording
 *   node recorder/record.mjs --watch --notify            Telegram ping on start/finish
 *
 * Options:
 *   --outdir DIR    where to write files      (default: the project's own
 *                   recordings/ folder, regardless of where you run this from)
 *   --pad N         minutes of padding each side (default 3)
 *   --remote URL    poll a raw hits.json URL instead of the local file
 *                   e.g. https://raw.githubusercontent.com/USER/REPO/main/data/hits.json
 *   --vlc           also open VLC on the live stream when recording starts
 *   --ics           write a .ics calendar file for each scheduled recording
 *   --notify        send a Telegram message when a recording starts/finishes
 *                   (needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in env)
 *   --dry-run       print the ffmpeg command instead of running it
 *
 * Requires ffmpeg on PATH.
 *
 * This records a free-to-air broadcast you can already watch live — the same
 * thing a VCR or a set-top box PVR does. Keep it to personal use.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveStream } from '../scraper/lib/streams.mjs';
import { TZ, durationMins, planSlot } from './timing.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/* ------------------------------------------------------------------- args */
function parseArgs(argv) {
  // Anchored to the project folder, NOT process.cwd(). Task Scheduler launches
  // tasks from C:\Windows\System32, and a cwd-relative default would quietly
  // scatter recordings there instead of somewhere you would ever look.
  const o = { pad: 3, outdir: join(ROOT, 'recordings'), poll: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--watch') o.watch = true;
    else if (a === '--list') o.list = true;
    else if (a === '--vlc') o.vlc = true;
    else if (a === '--maybes') o.maybes = true;
    else if (a === '--ics') o.ics = true;
    else if (a === '--notify') o.notify = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--now') o.now = next();
    else if (a === '--mins') o.mins = Number(next());
    else if (a === '--pad') o.pad = Number(next());
    else if (a === '--outdir') o.outdir = next();
    else if (a === '--remote') o.remote = next();
    else if (a === '--poll') o.poll = Number(next());
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help || (!opts.watch && !opts.list && !opts.now)) {
  console.log(`
Filmradar recorder

  --watch              poll hits.json and record scheduled titles
  --list               print the upcoming recording plan and exit
  --now CHANNEL_ID     start recording a channel immediately
  --mins N             duration for --now (default 90)
  --maybes             ALSO record untitled archive rubrics ("Moldova de
                       patrimoniu", "Tezaur", "F.A.") — the slots where an
                       unlisted heritage film is most likely to be hiding.
                       Recurs most days, so expect false positives.
  --pad N              minutes of padding before/after   (default 3)
  --outdir DIR         output directory (default: the project's own
                       recordings/ folder, wherever you run this from)
  --remote URL         poll a remote hits.json instead of the local file
  --poll N             minutes between polls (default 10)
  --vlc                also open VLC on the live stream when recording starts
  --ics                write a .ics calendar file for each scheduled recording
  --notify             Telegram ping on recording start/finish (needs
                       TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in env)
  --dry-run            print the ffmpeg command instead of running it

Stream URLs are resolved automatically from the channel's live page — nothing
to configure by hand. recorder/streams.json is only a fallback cache; delete
it any time and it will be rebuilt.
`);
  process.exit(0);
}

/* ------------------------------------------------------------------- util */
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'film';
}

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function loadHits() {
  if (opts.remote) {
    try {
      const r = await fetch(`${opts.remote}${opts.remote.includes('?') ? '&' : '?'}t=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      log(`⚠ nu pot citi hits.json remote: ${err.message}`);
      return { current: [] };
    }
  }
  return loadJson(join(ROOT, 'data/hits.json'), { current: [] });
}

/** Active channels straight from data/sources.json — used by --now, which has no hit to read a "live" URL from. */
async function loadSources() {
  const list = await loadJson(join(ROOT, 'data/sources.json'), []);
  return list.filter((s) => s.enabled !== false);
}

/* --------------------------------------------------------------- ffmpeg check */
function ensureFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (r.error || r.status !== 0) {
    console.error('✗ ffmpeg nu a fost găsit în PATH — recorder-ul nu poate captura nimic fără el.\n');
    console.error('  Instalează-l și încearcă din nou:');
    console.error('    Windows:  winget install Gyan.FFmpeg   (sau descarcă de pe ffmpeg.org și adaugă la PATH)');
    console.error('    macOS:    brew install ffmpeg');
    console.error('    Linux:    sudo apt install ffmpeg   (sau echivalentul distribuției tale)');
    console.error('  Verifică apoi cu:  ffmpeg -version\n');
    process.exit(1);
  }
}

/* ------------------------------------------------------------- stream resolution */
/**
 * Resolve a channel's current m3u8. Always tries the live page first (URLs
 * rotate); recorder/streams.json is consulted only if that live lookup
 * fails, so a temporary network hiccup doesn't strand a scheduled recording.
 */
async function resolveChannelUrl(channelId, liveUrlHint) {
  const cache = await loadJson(join(__dirname, 'streams.json'), { channels: {} });
  const cached = cache.channels?.[channelId];
  const liveUrl = liveUrlHint || cached?.source;

  if (liveUrl) {
    const r = await resolveStream(liveUrl);
    if (r.ok) return { url: r.m3u8, live: liveUrl, fresh: true };
    log(`⚠ rezolvare live eșuată pentru «${channelId}»: ${r.error}`);
  }

  if (cached?.m3u8) {
    log(`  → folosesc fluxul din cache (recorder/streams.json) pentru «${channelId}»`);
    return { url: cached.m3u8, live: liveUrl, fresh: false };
  }

  return { url: null, live: liveUrl, fresh: false };
}

/** Warm the cache at startup so a stale/missing recorder/streams.json doesn't block anything. */
async function warmStreamCache() {
  const sources = await loadSources();
  if (!sources.length) return;
  log(`Rezolv fluxurile live pentru ${sources.length} canale...`);
  const cache = await loadJson(join(__dirname, 'streams.json'), { channels: {} });
  const channels = { ...(cache.channels ?? {}) };
  let ok = 0;
  await Promise.all(sources.map(async (s) => {
    if (!s.live) return;
    const r = await resolveStream(s.live);
    if (r.ok) {
      ok++;
      channels[s.id] = { name: s.name, m3u8: r.m3u8, resolvedAt: new Date().toISOString(), source: s.live };
    } else if (channels[s.id]) {
      channels[s.id] = { ...channels[s.id], error: r.error };
    } else {
      channels[s.id] = { name: s.name, m3u8: null, resolvedAt: new Date().toISOString(), source: s.live, error: r.error };
    }
  }));
  log(`  → ${ok}/${sources.length} rezolvate acum; restul folosesc cache-ul dacă există.`);
  try {
    await writeFile(join(__dirname, 'streams.json'),
      `${JSON.stringify({ _generated: new Date().toISOString(), channels }, null, 2)}\n`, 'utf8');
  } catch { /* cache write is best-effort */ }
}

/* ------------------------------------------------------------------- Telegram */
/**
 * Deliberately not importing scraper/lib/notify.mjs: that module is the
 * scraper's business (Telegram + email + HTML formatting), and pulling it in
 * here would couple two independently-run processes over formatting details
 * neither one needs. This is a five-line fetch, not worth the coupling.
 */
async function notifyTelegram(text) {
  if (!opts.notify) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log('⚠ --notify cerut dar TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID lipsesc din mediu.');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) log(`⚠ Telegram HTTP ${res.status}`);
  } catch (err) {
    log(`⚠ notificare Telegram eșuată: ${err.message}`);
  }
}

/* ------------------------------------------------------------------- .ics */
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function icsStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

async function writeIcs({ uid, summary, description, start, end, outdir }) {
  if (!opts.ics) return;
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Filmradar//Recorder//RO',
    'BEGIN:VEVENT',
    `UID:${uid}@filmradar`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const dir = join(outdir, 'ics');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${slug(summary)}_${uid}.ics`);
  await writeFile(file, body, 'utf8');
  log(`📅 calendar scris: ${file}`);
}

/* --------------------------------------------------------------- VLC launcher */
/**
 * Try a list of (command, args) candidates in order. spawn() reports a
 * missing executable asynchronously via the 'error' event (not a thrown
 * exception), so we chain candidates off that event instead of try/catch —
 * a plain try/catch around spawn() would miss ENOENT on most platforms.
 */
function tryLaunch(candidates, url, i = 0) {
  if (i >= candidates.length) {
    log(`⚠ nu am putut deschide VLC automat — deschide manual: ${url}`);
    return;
  }
  const [cmd, args] = candidates[i];
  let settled = false;
  let child;
  try {
    child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  } catch {
    tryLaunch(candidates, url, i + 1);
    return;
  }
  child.once('error', () => {
    if (settled) return;
    settled = true;
    tryLaunch(candidates, url, i + 1);
  });
  child.once('spawn', () => {
    settled = true;
    child.unref();
    log(`▶ VLC deschis: ${url}`);
  });
}

function openVlc(url) {
  const candidates = [];
  if (process.platform === 'win32') {
    // Relies on VLC's own PATH/registry association first…
    candidates.push(['cmd', ['/c', 'start', '', 'vlc', url]]);
    // …then falls back to the well-known install locations directly.
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];
    const guesses = [
      join(pf, 'VideoLAN', 'VLC', 'vlc.exe'),
      join(pf86, 'VideoLAN', 'VLC', 'vlc.exe'),
      localAppData ? join(localAppData, 'Programs', 'VLC', 'vlc.exe') : null,
    ].filter(Boolean);
    for (const exe of guesses) {
      if (existsSync(exe)) candidates.push([exe, [url]]);
    }
  } else if (process.platform === 'darwin') {
    candidates.push(['open', ['-a', 'VLC', url]]);
    if (existsSync('/Applications/VLC.app/Contents/MacOS/VLC')) {
      candidates.push(['/Applications/VLC.app/Contents/MacOS/VLC', [url]]);
    }
  } else {
    candidates.push(['vlc', [url]]);
    candidates.push(['cvlc', [url]]);
    candidates.push(['flatpak', ['run', 'org.videolan.VLC', url]]);
  }
  tryLaunch(candidates, url);
}

/* --------------------------------------------------------------- recording */
const active = new Map();       // jobKey -> timer or child process (for --list bookkeeping)
const ffmpegProcs = new Set();  // running ffmpeg children, for graceful SIGINT shutdown
const icsWritten = new Set();   // jobKeys we've already written a .ics for

function jobKey(h) {
  return `${h.channelId}|${h.dayName}|${h.start}|${slug(h.watched)}`;
}

/** Ask a running ffmpeg to stop cleanly (writes the mp4 trailer) instead of killing it. */
function stopFfmpegGracefully(child) {
  return new Promise((done) => {
    let exited = false;
    child.once('exit', () => { exited = true; done(); });
    // 'q' on stdin is ffmpeg's own graceful-stop key — works the same on
    // Windows and POSIX, unlike relying on signal delivery.
    try { child.stdin.write('q'); } catch { /* already gone */ }
    setTimeout(() => {
      if (!exited) { try { child.kill(); } catch { /* already gone */ } done(); }
    }, 5000);
  });
}

let shuttingDown = false;
process.on('SIGINT', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!ffmpegProcs.size) { process.exit(0); }
  log(`\n⏹ Oprire solicitată — închid ${ffmpegProcs.size} înregistrare(i) în curs, fără fișiere corupte...`);
  await Promise.all([...ffmpegProcs].map(stopFfmpegGracefully));
  process.exit(0);
});

async function record(streamUrl, outFile, mins, label) {
  await mkdir(dirname(outFile), { recursive: true });
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-user_agent', 'Mozilla/5.0',
    '-reconnect', '1', '-reconnect_streamed', '1',
    '-reconnect_delay_max', '30',
    '-i', streamUrl,
    '-t', String(Math.round(mins * 60)),
    '-c', 'copy',            // no re-encode: fastest, lossless, cheap on a VPS
    '-bsf:a', 'aac_adtstoasc',
    '-movflags', '+faststart',
    '-y', outFile,
  ];

  if (opts.dryRun) { log(`DRY RUN: ffmpeg ${args.join(' ')}`); return null; }

  log(`⏺  înregistrez „${label}" → ${outFile} (${mins} min)`);
  await notifyTelegram(`⏺ Pornesc înregistrarea: <b>${label}</b>\n${mins} min → ${outFile}`);

  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'inherit'] });
  ffmpegProcs.add(p);
  p.on('error', (e) => log(`✗ ffmpeg: ${e.message}. Instalat? (ffmpeg -version)`));
  p.on('exit', (code) => {
    ffmpegProcs.delete(p);
    if (code === 0) {
      log(`✓ gata: ${outFile}`);
      notifyTelegram(`✓ Înregistrare terminată: <b>${label}</b>\n${outFile}`);
    } else {
      log(`✗ ffmpeg a ieșit cu ${code}`);
      notifyTelegram(`✗ Înregistrarea „${label}" s-a oprit cu eroare (cod ${code}).`);
    }
  });
  return p;
}

/* -------------------------------------------------------------------- main */
async function planAndRun() {
  const hits = await loadHits();
  const list = [...(hits.current ?? [])];

  // Rubric slots ("Moldova de patrimoniu", "Tezaur", "F.A.") name no film at
  // all — and that is exactly where an unlisted archive title hides, which is
  // the whole reason this project exists. Opt-in, because these rubrics recur
  // most days: on by default they would fill the disk with folk-music shows.
  if (opts.maybes) {
    for (const m of hits.maybes ?? []) {
      if (!m.start) continue; // news announcements carry no air time
      list.push({ ...m, watched: m.slotTitle, speculative: true });
    }
  }

  if (!list.length) { log('Niciun titlu programat momentan.'); return; }

  for (const h of list) {
    const key = jobKey(h);
    if (active.has(key)) continue;

    const plan = planSlot(h, { pad: opts.pad });

    if (plan.skip) {
      if (plan.reason === 'unparsable') {
        log(`⚠ nu pot calcula ora pentru „${h.watched}"`);
      } else if (opts.list) {
        console.log(`  ⤫ ${h.watched} — ${h.channel} ${h.dayName} ${h.start} (deja difuzat)`);
      }
      continue;
    }

    const { ms, startIn, mins } = plan;
    const startsAt = new Date(Date.now() + ms);
    const when = startsAt.toLocaleString('ro-RO', { timeZone: TZ });
    // TRM publishes Chișinău wall time. Run this from another country and a
    // bare "08:30" is an invitation to be an hour late — so when the machine's
    // own clock disagrees, show both. (The scheduling itself is unaffected:
    // it works off a delta against Chișinău's clock, not the local one.)
    const local = startsAt.toLocaleString('ro-RO');
    const whenBoth = local === when ? when : `${when} (${local} la tine)`;

    if (opts.list) {
      const eta = plan.late
        ? `ÎN CURS, ${Math.round(plan.remainingMin)} min rămase`
        : `peste ${(ms / 3600_000).toFixed(1)}h`;
      console.log(`  ${h.watched} — ${h.channel} ${h.dayName} ${h.start} `
        + `(${eta}, ${mins} min) → ${whenBoth}`);
      continue;
    }

    if (opts.ics && !icsWritten.has(key)) {
      icsWritten.add(key);
      const endsAt = new Date(startsAt.getTime() + durationMins(h) * 60_000);
      await writeIcs({
        uid: slug(key),
        summary: `🎬 ${h.watched} — ${h.channel}`,
        description: `Filmradar: înregistrare programată pe ${h.channel}, listat ca „${h.slotTitle}".`,
        start: startsAt,
        end: endsAt,
        outdir: opts.outdir,
      });
    }

    // Too far out to hold a timer; the next poll will pick it up.
    if (startIn > 6 * 3600_000) continue;

    const outFile = join(opts.outdir, `${slug(h.watched)}_${h.channelId}_`
      + `${new Date().toISOString().slice(0, 10)}.mp4`);

    log(`⏱  programat „${h.watched}" peste ${Math.max(0, startIn / 60000).toFixed(0)} min (${when})`);

    const timer = setTimeout(async () => {
      // Resolve fresh right before capturing — a URL scheduled hours ago may
      // have rotated by now.
      const resolved = await resolveChannelUrl(h.channelId, h.live);
      if (!resolved.url) {
        log(`✗ nu am niciun flux pentru «${h.channelId}» — sar peste „${h.watched}".`);
        active.delete(key);
        return;
      }
      if (opts.vlc) openVlc(h.live || resolved.url);
      const proc = await record(resolved.url, outFile, mins, h.watched);
      if (proc) proc.on('exit', () => active.delete(key));
      else active.delete(key);
    }, Math.max(0, startIn));

    active.set(key, timer);
  }
}

async function main() {
  if (opts.now) {
    ensureFfmpeg();
    const sources = await loadSources();
    const src = sources.find((s) => s.id === opts.now);
    const resolved = await resolveChannelUrl(opts.now, src?.live);
    if (!resolved.url) {
      console.error(`✗ Niciun flux disponibil pentru «${opts.now}» — nici live, nici din cache.`);
      process.exit(1);
    }
    if (opts.vlc) openVlc(src?.live || resolved.url);
    const out = join(opts.outdir, `manual_${opts.now}_${Date.now()}.mp4`);
    const proc = await record(resolved.url, out, opts.mins || 90, `manual ${opts.now}`);
    if (proc) {
      await new Promise((done) => proc.on('exit', done));
    }
    return;
  }

  if (opts.list) {
    console.log('\nPlan de înregistrare:');
    await planAndRun();
    console.log('');
    return;
  }

  ensureFfmpeg();
  await warmStreamCache();

  log(`Pornit. Verific la fiecare ${opts.poll} min. Ieșire: ${opts.outdir}`);
  await planAndRun();
  setInterval(planAndRun, opts.poll * 60_000);
}

main().catch((e) => { console.error(e); process.exit(1); });
