/**
 * Resolve a channel's live HLS (.m3u8) URL directly from its public live
 * page — no DevTools, no manual copy-paste.
 *
 * Teleradio-Moldova's live pages (moldova1.md/live, moldova1.md/moldova2)
 * embed a PeerTube player. PeerTube exposes a public REST API that hands
 * back the current HLS playlist for a video, so instead of sniffing network
 * requests by hand we just: fetch the live page, pull the PeerTube embed
 * URL out of it, then ask that instance's API for the stream.
 *
 * Verified shape (July 2026):
 *   live page   https://moldova1.md/moldova2
 *   embed       https://v0.trm.md/videos/embed/d5fafab0-9c37-4746-9e7a-b2d6c0427015
 *   API         https://v0.trm.md/api/v1/videos/d5fafab0-9c37-4746-9e7a-b2d6c0427015
 *   m3u8        https://v0.trm.md/static/streaming-playlists/hls/d5fafab0-.../master.m3u8
 *
 * The embed id can be either a full UUID or PeerTube's shorter "shortUUID"
 * (base62-ish, no dashes at fixed positions) — the API accepts both, so we
 * don't need to tell them apart.
 *
 * Every exported function here fails soft: network trouble, a redesigned
 * page, or a channel that isn't PeerTube at all all come back as
 * { ok:false, error }, never a thrown exception. A caller looping over many
 * channels should never need try/catch.
 */

import { fetchPage } from './trm.mjs';

/** PeerTube embed iframe/link: https://HOST/videos/embed/ID (full UUID or shortUUID). */
const EMBED_RE = /https?:\/\/([\w.-]+)\/videos\/embed\/([\w-]+)/i;

/** Last-resort scan: any bare .m3u8 URL sitting in the page source. */
const M3U8_RE = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json,text/html,*/*;q=0.8',
};

/**
 * Find the PeerTube host + video id embedded in a live page's HTML.
 * Pure string matching, no network — safe to unit test with fixtures.
 * @returns {{host:string, uuid:string}|null}
 */
export function extractEmbed(html) {
  if (!html) return null;
  const m = String(html).match(EMBED_RE);
  if (!m) return null;
  return { host: m[1], uuid: m[2] };
}

/**
 * Pull the live HLS playlist URL out of a PeerTube `/api/v1/videos/:id`
 * JSON response. PeerTube lists one or more streamingPlaylists; the first
 * is the one actually being served.
 * @returns {string|null}
 */
export function extractPlaylistUrl(json) {
  const url = json?.streamingPlaylists?.[0]?.playlistUrl;
  return typeof url === 'string' && url ? url : null;
}

/**
 * Last-resort fallback for pages that inline a player config instead of a
 * PeerTube iframe: scan the raw HTML for anything that looks like an .m3u8.
 * @returns {string|null}
 */
export function extractM3u8Fallback(html) {
  if (!html) return null;
  const m = String(html).match(M3U8_RE);
  return m ? m[0] : null;
}

function fail(error, extra = {}) {
  return { ok: false, m3u8: null, host: null, uuid: null, isLive: null, title: null, error, ...extra };
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve one channel's live page to a playable m3u8 URL.
 *
 * @param {string} livePageUrl e.g. https://moldova1.md/moldova2
 * @returns {Promise<{ok:boolean, m3u8:?string, host:?string, uuid:?string, isLive:?boolean, title:?string, error:?string}>}
 */
export async function resolveStream(livePageUrl, { timeoutMs = 15000 } = {}) {
  if (!livePageUrl) return fail('No live page URL provided');

  let html;
  try {
    html = await fetchPage(livePageUrl, { timeoutMs, retries: 1 });
  } catch (err) {
    return fail(`Could not fetch live page: ${err.message ?? err}`);
  }

  const embed = extractEmbed(html);
  if (!embed) {
    // Not a PeerTube page (or the markup changed) — try the raw scan before
    // giving up entirely.
    const raw = extractM3u8Fallback(html);
    if (raw) return { ok: true, m3u8: raw, host: null, uuid: null, isLive: null, title: null, error: null };
    return fail('No PeerTube embed or .m3u8 URL found on the live page');
  }

  const { host, uuid } = embed;
  try {
    const json = await fetchJson(`https://${host}/api/v1/videos/${uuid}`, timeoutMs);
    const playlist = extractPlaylistUrl(json);
    if (playlist) {
      return { ok: true, m3u8: playlist, host, uuid, isLive: json?.isLive ?? null, title: json?.name ?? null, error: null };
    }
    return fail('PeerTube API returned no streamingPlaylists (channel likely offline)', {
      host, uuid, isLive: json?.isLive ?? null, title: json?.name ?? null,
    });
  } catch (err) {
    // API call failed — the page might still inline a URL somewhere, so try
    // that before reporting failure.
    const raw = extractM3u8Fallback(html);
    if (raw) return { ok: true, m3u8: raw, host, uuid, isLive: null, title: null, error: null };
    return fail(`PeerTube API request failed: ${err.message ?? err}`, { host, uuid });
  }
}

/** Resolve many channels concurrently. Each entry needs at least {id, name, live}. */
export async function resolveAll(sources) {
  return Promise.all(
    sources.map(async (s) => {
      const r = await resolveStream(s.live);
      return { id: s.id, name: s.name, live: s.live, ...r };
    }),
  );
}

export default { resolveStream, resolveAll, extractEmbed, extractPlaylistUrl, extractM3u8Fallback };
