#!/usr/bin/env bash
# Runs the VoiceStudio speech server (engine OmniVoice) on the Colab GPU and opens a public tunnel to it. Run it in the Colab TERMINAL
# (the Terminal button at the bottom left of the notebook), so it can run next to the FLUX cell:
#
#   curl -fsSL https://raw.githubusercontent.com/abdulkarimtaji33/videogenerator/main/kaggle/voicestudio-server.sh -o v.sh; VOICESTUDIO_KEY=<a long random key> bash v.sh
#
# VOICESTUDIO_KEY becomes the server's API key (the same value goes in backend/.env as VOICESTUDIO_API_KEY). Nothing secret is in this file.
# Every network step retries. It prints:  VOICESTUDIO_PUBLIC_URL=https://....trycloudflare.com   and a heartbeat every 5 minutes.

set -u
KEY="${VOICESTUDIO_KEY:-}"
[ -n "$KEY" ] || { echo "set VOICESTUDIO_KEY first"; exit 1; }
W=/content/vs-run; PORT=3900
mkdir -p "$W" && cd /content || exit 1
say() { echo "[$(date +%H:%M:%S)] $*"; }
retry() { local n="$1"; shift; local i; for i in $(seq 1 "$n"); do "$@" && return 0; say "retry $i/$n: $*"; sleep 8; done; return 1; }

# 1. code and packages
command -v uv >/dev/null 2>&1 || retry 8 pip install -q uv
[ -d /content/vs/.git ] || retry 8 git clone --depth 1 https://github.com/debpalash/VoiceStudio.git /content/vs || { say "clone failed"; exit 1; }
cd /content/vs
say "installing packages (uv sync)"
retry 5 uv sync --python 3.11 --no-dev > "$W/sync.log" 2>&1 || { tail -n 20 "$W/sync.log"; say "uv sync failed"; exit 1; }

# 2. server
start_server() {
  pkill -f "uvicorn backend.main:app" 2>/dev/null; sleep 1
  OMNIVOICE_API_KEY="$KEY" OMNIVOICE_SERVER_MODE=1 nohup uv run --no-dev uvicorn backend.main:app --host 127.0.0.1 --port $PORT > "$W/server.log" 2>&1 &
  local i
  for i in $(seq 1 120); do
    curl -s -m 3 "http://127.0.0.1:$PORT/health" | grep -q . && { say "VoiceStudio is up"; return 0; }
    sleep 3
  done
  tail -n 25 "$W/server.log"; say "VoiceStudio did not come up"; return 1
}
start_server || exit 1
curl -s -m 5 "http://127.0.0.1:$PORT/health"; echo

# 3. tunnel
CF=/content/flux/cloudflared; [ -x "$CF" ] || CF="$W/cloudflared"
[ -x "$CF" ] || { retry 20 curl -fsSL --retry 5 --retry-all-errors -o "$CF" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64; chmod +x "$CF"; }
URL=""
start_tunnel() {
  pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT" 2>/dev/null; sleep 1
  : > "$W/tunnel.log"
  nohup "$CF" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$W/tunnel.log" 2>&1 &
  local i
  for i in $(seq 1 60); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$W/tunnel.log" | head -n 1)
    [ -n "$URL" ] && return 0
    sleep 2
  done
  return 1
}
retry 10 start_tunnel || { tail -n 20 "$W/tunnel.log"; say "no tunnel"; exit 1; }
say "VOICESTUDIO_PUBLIC_URL=$URL"

# 4. stay alive
n=0
while true; do
  sleep 60; n=$((n+1))
  curl -s -m 5 "http://127.0.0.1:$PORT/health" | grep -q . || { say "server stopped; restarting"; start_server; }
  pgrep -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT" >/dev/null || { say "tunnel stopped; restarting"; start_tunnel && say "VOICESTUDIO_PUBLIC_URL=$URL"; }
  [ $((n % 5)) -eq 0 ] && say "heartbeat VOICESTUDIO_PUBLIC_URL=$URL"
done
