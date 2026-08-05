#!/bin/sh
# Standalone capture of one TRM broadcast. Needs only sh, curl and ffmpeg —
# no Node, no repo, no checkout. Copy this one file anywhere and run it.
#
# It exists for redundancy. recorder/record.mjs is the good path on a machine
# that has the repo; this is what you run on a NAS, a borrowed laptop or a
# phone, so a single machine failing does not cost you a broadcast that may not
# recur for years.
#
#   ./capture.sh 2026-08-08 22:00 105 /volume1/video/tunul-de-lemn.mp4
#   ./capture.sh <date> <start HH:MM> <minutes> <output> [channel-page-url]
#
# TIMES ARE CHISINAU TIME, always — the same clock TRM prints in its grid.
# The script converts to this machine's clock itself, so you give it 22:00
# whether you are running it in Chisinau, Copenhagen or anywhere else.
#
# It starts recording IMMEDIATELY when run if the start time has already
# passed, so launching late still captures the rest of the film.

set -eu

DATE="${1:?date, e.g. 2026-08-08}"
START="${2:?start HH:MM in Chisinau time, e.g. 22:00}"
MINS="${3:?duration in minutes, e.g. 105}"
OUT="${4:?output file}"
PAGE="${5:-https://moldova1.md/moldova2}"

# --- resolve the stream fresh -------------------------------------------
# Never hardcode the m3u8. TRM has already changed both the host and the video
# id at least once (v0.trm.md/d5fafab0 -> v.trm.md/937e4e0e), and a stale URL
# can still serve a DIFFERENT live channel — you would get a clean recording of
# the wrong programme and not find out until you played it.
resolve() {
  page=$(curl -sL --max-time 30 -A "Mozilla/5.0" "$1") || return 1
  embed=$(printf '%s' "$page" | grep -oiE 'https?://[a-z0-9.-]+/videos/embed/[A-Za-z0-9_-]+' | head -1) || return 1
  [ -n "$embed" ] || return 1
  host=$(printf '%s' "$embed" | sed -E 's|https?://([^/]+)/.*|\1|')
  vid=$(printf '%s' "$embed" | sed -E 's|.*/videos/embed/||')
  curl -sL --max-time 30 -A "Mozilla/5.0" "https://$host/api/v1/videos/$vid" \
    | grep -oE '"playlistUrl":"[^"]+"' | head -1 | sed -E 's/"playlistUrl":"//; s/"$//'
}

M3U8=$(resolve "$PAGE" || true)
if [ -z "${M3U8:-}" ]; then
  # Both known Moldova 2 feeds, checked 5 Aug 2026 — TRM runs two in parallel
  # ("Live: Moldova2" and "Live0: Moldova2"). Only reached if resolution fails.
  echo "! nu am putut rezolva fluxul, folosesc adresa de rezervă" >&2
  M3U8="https://v.trm.md/static/streaming-playlists/hls/937e4e0e-7174-4fb2-a299-480e68b49ecb/master.m3u8"
fi
echo "flux: $M3U8"

# --- wait for the slot ---------------------------------------------------
# `date -d` with an explicit TZ offset resolves the Chisinau wall clock to a
# real instant, so this is correct regardless of the machine's own timezone.
# Chisinau is UTC+3 (EEST) from late March to late October, UTC+2 otherwise.
month=$(printf '%s' "$DATE" | cut -d- -f2)
if [ "$month" -ge 4 ] && [ "$month" -le 9 ]; then OFF="+03:00"; else OFF="+02:00"; fi
TARGET=$(date -d "${DATE}T${START}:00${OFF}" +%s 2>/dev/null) || {
  echo "✗ 'date -d' nu funcționează aici (busybox?). Pornește scriptul manual la ora potrivită." >&2
  TARGET=$(date +%s)
}
NOW=$(date +%s)
WAIT=$((TARGET - NOW))

echo "start: $DATE $START Chisinau (UTC$OFF) -> local $(date -d "@$TARGET" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || echo '?')"
if [ "$WAIT" -gt 0 ]; then
  echo "aștept $((WAIT / 60)) min..."
  sleep "$WAIT"
else
  echo "ora a trecut deja ($((-WAIT / 60)) min) — pornesc acum"
fi

# --- record --------------------------------------------------------------
mkdir -p "$(dirname "$OUT")"
echo "⏺ înregistrez $MINS min -> $OUT"
ffmpeg -hide_banner -loglevel warning \
  -user_agent "Mozilla/5.0" \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 30 \
  -i "$M3U8" \
  -t "$((MINS * 60))" \
  -c copy -bsf:a aac_adtstoasc -movflags +faststart \
  -y "$OUT"

echo "✓ gata: $OUT"
ls -lh "$OUT"
