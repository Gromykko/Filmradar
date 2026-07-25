#!/usr/bin/env node
/**
 * Test suite for scraper/lib/streams.mjs — no framework, just assertions.
 * Run: node scraper/test/streams.test.mjs
 *
 * Deliberately offline: the sandbox this runs in has no route to trm.md, so
 * these tests exercise only the pure parsing helpers (extractEmbed,
 * extractPlaylistUrl, extractM3u8Fallback) against fixture strings. Nothing
 * here calls resolveStream()/resolveAll() over the network — that behaviour
 * is exercised by hand via `node scraper/tools/discover-streams.mjs --check`
 * on a machine that actually has internet access.
 */

import assert from 'node:assert/strict';
import { extractEmbed, extractPlaylistUrl, extractM3u8Fallback } from '../lib/streams.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
  }
}

console.log('\nextractEmbed — PeerTube embed detection');

test('extracts host + full UUID from an iframe embed', () => {
  const html = `
    <div class="video-wrap">
      <iframe src="https://v0.trm.md/videos/embed/d5fafab0-9c37-4746-9e7a-b2d6c0427015"
        allowfullscreen frameborder="0"></iframe>
    </div>`;
  const r = extractEmbed(html);
  assert.ok(r, 'expected a match');
  assert.equal(r.host, 'v0.trm.md');
  assert.equal(r.uuid, 'd5fafab0-9c37-4746-9e7a-b2d6c0427015');
});

test('extracts host + shortUUID form', () => {
  const html = `<iframe src="https://v1.trm.md/videos/embed/c4QtES1c8UxxS4gc7CnwbK" width="640"></iframe>`;
  const r = extractEmbed(html);
  assert.ok(r, 'expected a match');
  assert.equal(r.host, 'v1.trm.md');
  assert.equal(r.uuid, 'c4QtES1c8UxxS4gc7CnwbK');
});

test('finds the embed even buried in unrelated markup', () => {
  const html = `<html><head><title>Moldova 1 — Live</title></head><body>
    <nav>...</nav><script>var x=1;</script>
    <p>Vezi transmisiunea în direct mai jos:</p>
    <div><iframe src="https://v1.trm.md/videos/embed/c4QtES1c8UxxS4gc7CnwbK"></iframe></div>
    <footer>© TRM</footer></body></html>`;
  const r = extractEmbed(html);
  assert.ok(r);
  assert.equal(r.uuid, 'c4QtES1c8UxxS4gc7CnwbK');
});

test('returns null when there is no PeerTube embed', () => {
  assert.equal(extractEmbed('<html><body>Nimic aici</body></html>'), null);
});

test('returns null on empty or malformed HTML', () => {
  assert.equal(extractEmbed(''), null);
  assert.equal(extractEmbed(null), null);
  assert.equal(extractEmbed(undefined), null);
  assert.equal(extractEmbed('<<<not html>>>'), null);
});

console.log('\nextractPlaylistUrl — PeerTube API response parsing');

test('picks playlistUrl out of a realistic PeerTube API response', () => {
  // Trimmed shape of a real GET /api/v1/videos/:id response.
  const json = {
    id: 12,
    uuid: 'd5fafab0-9c37-4746-9e7a-b2d6c0427015',
    name: 'Moldova 2 — Live',
    isLive: true,
    streamingPlaylists: [
      {
        id: 1,
        type: 1,
        playlistUrl:
          'https://v0.trm.md/static/streaming-playlists/hls/d5fafab0-9c37-4746-9e7a-b2d6c0427015/master.m3u8',
        segmentsSha256Url: 'https://v0.trm.md/static/streaming-playlists/hls/d5fafab0-.../segments-sha256.json',
      },
    ],
    files: [],
  };
  assert.equal(
    extractPlaylistUrl(json),
    'https://v0.trm.md/static/streaming-playlists/hls/d5fafab0-9c37-4746-9e7a-b2d6c0427015/master.m3u8',
  );
});

test('returns null when streamingPlaylists is empty (channel offline)', () => {
  assert.equal(extractPlaylistUrl({ id: 1, isLive: false, streamingPlaylists: [] }), null);
});

test('returns null when streamingPlaylists is missing entirely', () => {
  assert.equal(extractPlaylistUrl({ id: 1, isLive: false }), null);
});

test('handles a completely malformed/empty JSON body', () => {
  assert.equal(extractPlaylistUrl({}), null);
  assert.equal(extractPlaylistUrl(null), null);
  assert.equal(extractPlaylistUrl(undefined), null);
});

console.log('\nextractM3u8Fallback — raw HTML scan');

test('finds a bare .m3u8 URL inlined in a script tag', () => {
  const html = `<script>var playerConfig = { src: "https://cdn.trm.md/live/moldova1/index.m3u8?token=abc123" };</script>`;
  assert.equal(extractM3u8Fallback(html), 'https://cdn.trm.md/live/moldova1/index.m3u8?token=abc123');
});

test('finds an .m3u8 URL inside an HTML attribute', () => {
  const html = `<video><source src='https://cdn.trm.md/hls/master.m3u8' type="application/x-mpegURL"></video>`;
  assert.equal(extractM3u8Fallback(html), 'https://cdn.trm.md/hls/master.m3u8');
});

test('returns null when there is no .m3u8 anywhere', () => {
  assert.equal(extractM3u8Fallback('<html><body>Nimic</body></html>'), null);
});

test('returns null on empty or malformed HTML', () => {
  assert.equal(extractM3u8Fallback(''), null);
  assert.equal(extractM3u8Fallback(null), null);
  assert.equal(extractM3u8Fallback(undefined), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
