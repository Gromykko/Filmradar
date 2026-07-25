#!/usr/bin/env node
/**
 * Main entry point. Run by GitHub Actions on a cron, or locally.
 *
 *   node scraper/check.mjs              # fetch, match, notify, write data
 *   node scraper/check.mjs --dry-run    # everything except sending notifications
 *   node scraper/check.mjs --debug      # dump parsed slot counts and samples
 *
 * Writes:
 *   data/schedule.json  full parsed grid (the UI reads this)
 *   data/hits.json      current detections + recent history
 *   data/state.json     dedupe ledger so you aren't pinged twice for one slot
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAllChannels, loadSources } from './lib/trm.mjs';
import { findMatches } from './lib/match.mjs';
import {
  sendTelegram,
  sendEmail,
  buildTelegramMessage,
  buildEmailHtml,
  nowInChisinau,
} from './lib/notify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = join(ROOT, 'data');

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run') || argv.has('-n');
const DEBUG = argv.has('--debug');

/** Alerts older than this drop out of the dedupe ledger so they can re-fire. */
const DEDUPE_TTL_DAYS = 10;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function log(...args) {
  console.log(...args);
}

function debug(...args) {
  if (DEBUG) console.log('[debug]', ...args);
}

/**
 * A stable identity for one broadcast slot, used for dedupe.
 * Deliberately excludes confidence so a re-score doesn't re-alert.
 */
function alertKey(h) {
  return `${h.channelId}|${h.day ?? '?'}|${h.start}|${(h.slotTitle || '').toLowerCase()}`;
}

async function main() {
  const runAt = nowInChisinau();
  log(`\n▶ Verificare grilă TRM — ${runAt}`);

  const watchlist = await readJson(join(DATA, 'watchlist.json'), []);
  const active = watchlist.filter((w) => w.enabled !== false);
  log(`  ${active.length} titluri active (din ${watchlist.length})`);

  if (!active.length) {
    log('  Watchlist gol — nimic de căutat. Adaugă titluri în data/watchlist.json sau din UI.');
  }

  // ---------------------------------------------------------------- fetch
  const sources = await loadSources(DATA);
  log(`  ${sources.length} surse active`);
  const results = await fetchAllChannels({ channels: sources });

  for (const r of results) {
    if (!r.ok) {
      console.error(`  ✗ ${r.channel.name}: ${r.error}`);
      continue;
    }
    const real = r.slots.filter((s) => !s.filler).length;
    const tag = r.channel.newsOnly ? 'titluri știri' : 'sloturi';
    const assumed = r.dayAssumed ? ' [zi presupusă = azi]' : '';
    log(`  ✓ ${r.channel.name}: ${r.slots.length} ${tag} (${real} utile)${assumed}`);
    if (r.empty && r.channel.expectEmpty) {
      log('    · gol, ca de obicei (grilă încărcată prin JS) — ignor');
    }
    if (r.warning) console.warn(`    ⚠ ${r.warning}`);
    if (DEBUG) {
      debug(`${r.channel.name} first 5:`, r.slots.slice(0, 5).map((s) => `${s.dayName ?? '-'} ${s.start} ${s.title}`));
    }
  }

  // Moldova 1 and Moldova 2 are the only sources that actually carry the films.
  // If one of them breaks while the news feeds keep answering, the run still
  // "succeeds" and reports zero matches — indistinguishable from a quiet day.
  // Failing the workflow is the cheapest signal that reaches a human: GitHub
  // emails you on a red run, and no extra notification plumbing can rot.
  const brokenPrimary = results.filter(
    (r) => r.channel.tier === 'primary' && (!r.ok || r.warning),
  );
  if (brokenPrimary.length) {
    for (const r of brokenPrimary) {
      console.error(`  ‼ SURSĂ PRINCIPALĂ DEFECTĂ — ${r.channel.name}: ${r.error ?? r.warning}`);
    }
    process.exitCode = 1;
  }

  const anyOk = results.some((r) => r.ok && r.slots.length);
  if (!anyOk) {
    console.error('\n✗ Nicio grilă nu a putut fi citită. Nu suprascriu datele bune.');
    process.exitCode = 1;
    // Still record that the run happened. GitHub disables a cron after 60 days
    // with no repo activity, and the per-run commit is what keeps it alive — so
    // a long outage must not also be a silent commit drought that kills the
    // schedule permanently. Written to its own file so the last good
    // schedule.json survives untouched.
    if (!DRY_RUN) {
      await writeJson(join(DATA, 'health.json'), {
        updatedAt: new Date().toISOString(),
        updatedAtLocal: runAt,
        ok: false,
        reason: 'Nicio sursă nu a răspuns',
        channels: results.map((r) => ({ id: r.channel.id, ok: r.ok, error: r.error ?? null })),
      });
    }
    return;
  }

  // ---------------------------------------------------------------- match
  const { hits, maybes } = findMatches(results, watchlist, { includeMaybes: true });
  log(`  → ${hits.length} potriviri, ${maybes.length} posibile`);

  for (const h of hits) {
    log(`    🎬 ${h.watched} — ${h.channel} ${h.dayName ?? ''} ${h.start} ("${h.slotTitle}")`);
  }

  // ---------------------------------------------------------------- dedupe
  const state = await readJson(join(DATA, 'state.json'), { alerted: {} });
  const cutoff = Date.now() - DEDUPE_TTL_DAYS * 86400_000;
  for (const [k, ts] of Object.entries(state.alerted ?? {})) {
    if (Date.parse(ts) < cutoff) delete state.alerted[k];
  }

  const fresh = hits.filter((h) => !state.alerted?.[alertKey(h)]);
  log(`  → ${fresh.length} potriviri noi (nealertate anterior)`);

  // ---------------------------------------------------------------- notify
  let delivery = { telegram: null, email: null };

  if (fresh.length) {
    const subject =
      fresh.length === 1
        ? `🎬 "${fresh[0].watched}" — ${fresh[0].channel} ${fresh[0].dayName ?? ''} ${fresh[0].start}`
        : `🎬 ${fresh.length} titluri urmărite apar în grila TV`;

    const tgText = buildTelegramMessage({
      hits: fresh,
      maybes,
      watchCount: active.length,
      runAt,
    });
    const mailHtml = buildEmailHtml({
      hits: fresh,
      maybes,
      watchCount: active.length,
      runAt,
      siteUrl: process.env.SITE_URL || null,
    });

    if (DRY_RUN) {
      log('\n--- DRY RUN: Telegram ---\n' + tgText + '\n');
    } else {
      delivery.telegram = await sendTelegram(tgText);
      delivery.email = await sendEmail(subject, mailHtml);
      log(`  telegram: ${describe(delivery.telegram)}`);
      log(`  email:    ${describe(delivery.email)}`);

      const delivered = delivery.telegram?.ok || delivery.email?.ok;
      if (delivered) {
        state.alerted ??= {};
        for (const h of fresh) state.alerted[alertKey(h)] = new Date().toISOString();
      } else {
        console.warn('  ⚠ Nicio notificare livrată — nu marchez ca alertat, se reîncearcă.');
        // Retrying forever is right for a single bad run, but a token that has
        // expired or a bot that got blocked fails identically on every run and
        // would otherwise be visible nowhere. A non-zero exit turns that into a
        // red X and GitHub's own "workflow failed" email.
        process.exitCode = 1;
      }
    }
  }

  // ---------------------------------------------------------------- persist
  const schedule = {
    updatedAt: new Date().toISOString(),
    updatedAtLocal: runAt,
    timezone: 'Europe/Chisinau',
    channels: results.map((r) => ({
      id: r.channel.id,
      name: r.channel.name,
      live: r.channel.live,
      schedule: r.channel.schedule,
      ok: r.ok,
      error: r.error ?? null,
      warning: r.warning ?? null,
      slots: r.slots,
    })),
  };

  const prevHits = await readJson(join(DATA, 'hits.json'), { history: [] });
  const history = [
    ...fresh.map((h) => ({ ...h, detectedAt: new Date().toISOString() })),
    ...(prevHits.history ?? []),
  ].slice(0, 200);

  if (!DRY_RUN) {
    await writeJson(join(DATA, 'schedule.json'), schedule);
    await writeJson(join(DATA, 'hits.json'), {
      updatedAt: new Date().toISOString(),
      current: hits,
      maybes,
      history,
    });
    await writeJson(join(DATA, 'state.json'), state);
    log('  ✓ data/ actualizat');
  } else {
    log('  (dry run — nu scriu în data/)');
  }

  // GitHub Actions step summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `### Verificare grilă TRM — ${runAt}`,
      '',
      `- Titluri urmărite: **${active.length}**`,
      `- Potriviri: **${hits.length}** (noi: ${fresh.length})`,
      `- Posibile (rubrici generice): **${maybes.length}**`,
      '',
      ...(hits.length
        ? ['| Titlu | Canal | Când | Listat ca |', '|---|---|---|---|',
           ...hits.map((h) => `| ${h.watched} | ${h.channel} | ${h.dayName ?? ''} ${h.start} | ${h.slotTitle} |`)]
        : ['_Niciun titlu urmărit în grila curentă._']),
    ].join('\n');
    await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
  }

  log('▶ Gata.\n');
}

function describe(r) {
  if (!r) return 'n/a';
  if (r.ok) return `ok${r.via ? ` (${r.via})` : ''}`;
  if (r.skipped) return `sărit — ${r.reason}`;
  return `EȘUAT — ${r.reason}`;
}

main().catch((err) => {
  console.error('Eroare fatală:', err);
  process.exitCode = 1;
});
