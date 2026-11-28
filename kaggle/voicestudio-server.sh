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

# Google Drive cache (only when the notebook has mounted Drive: from google.colab import drive; drive.mount('/content/drive')).
# A Colab session is wiped when it ends. The Python environment and the 3.3 GB model are kept on Drive and restored next time, which
# skips the package install (about 4 minutes) and the model download (about 1.5 minutes). Every save is skipped when Drive lacks room,
# and every restore is checked: a bad or missing cache just means the normal install runs. No secrets are stored.
CACHE=""
[ -d /content/drive/MyDrive ] && CACHE=/content/drive/MyDrive/shotcraft-flux-cache && mkdir -p "$CACHE"
HFHUB=/root/.cache/huggingface/hub
UVPY=/root/.local/share/uv/python
ENV_TAR="$CACHE/voicestudio-env.tar"; MODEL_TAR="$CACHE/omnivoice-model.tar"
free_mb() { df -m /content/drive 2>/dev/null | awk 'NR==2{print $4}'; }
save_tar() { # save_tar <tar file> <base dir> <relative path>...: only if Drive has room for it plus 1 GB
  local out="$1" base="$2"; shift 2
  local need; need=$(( $(cd "$base" && du -sm "$@" 2>/dev/null | awk '{s+=$1} END{print s+0}') + 1024 ))
  local have; have=$(free_mb); have=${have:-0}
  if [ "$have" -lt "$need" ]; then say "not saving $(basename "$out"): needs ${need} MB, Drive has ${have} MB free"; return 1; fi
  (cd "$base" && tar -cf "$out.part" "$@") && mv -f "$out.part" "$out" && say "saved $(basename "$out"): $(du -h "$out" | cut -f1)" || { rm -f "$out.part"; say "could not save $(basename "$out")"; return 1; }
}

# 1. code and packages
command -v uv >/dev/null 2>&1 || retry 8 pip install -q uv
[ -d /content/vs/.git ] || retry 8 git clone --depth 1 https://github.com/debpalash/VoiceStudio.git /content/vs || { say "clone failed"; exit 1; }
cd /content/vs
if [ -n "$CACHE" ] && [ -s "$ENV_TAR" ] && [ ! -d /content/vs/.venv ]; then
  say "restoring the Python environment from Drive"
  tar -xf "$ENV_TAR" -C / 2>/dev/null || { say "the Drive environment could not be read; installing normally"; rm -rf /content/vs/.venv; }
fi
if [ -n "$CACHE" ] && [ -s "$MODEL_TAR" ] && [ ! -d "$HFHUB/models--k2-fsa--OmniVoice" ]; then
  say "restoring the OmniVoice model from Drive"
  mkdir -p "$HFHUB" && tar -xf "$MODEL_TAR" -C "$HFHUB" 2>/dev/null || { say "the Drive model could not be read; it will be downloaded"; rm -rf "$HFHUB/models--k2-fsa--OmniVoice"; }
fi
say "installing packages (uv sync; quick when the environment was restored)"
retry 5 uv sync --python 3.11 --no-dev > "$W/sync.log" 2>&1 || { tail -n 20 "$W/sync.log"; say "uv sync failed"; exit 1; }
[ -n "$CACHE" ] && [ ! -s "$ENV_TAR" ] && save_tar "$ENV_TAR" / content/vs/.venv "${UVPY#/}"
[ -n "$CACHE" ] || say "Drive is not mounted: nothing will be saved (mount it first to skip the install next time)"

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
  # once the model is fully installed (the app installs it through the server), keep a copy on Drive
  if [ -n "$CACHE" ] && [ ! -s "$MODEL_TAR" ] && [ ! -e "$W/model-save-tried" ] && ls "$HFHUB"/models--k2-fsa--OmniVoice/snapshots/*/model.safetensors >/dev/null 2>&1 \
     && [ -z "$(ls "$HFHUB"/models--k2-fsa--OmniVoice/blobs/*.incomplete 2>/dev/null)" ]; then
    touch "$W/model-save-tried"; save_tar "$MODEL_TAR" "$HFHUB" models--k2-fsa--OmniVoice
  fi
  [ $((n % 5)) -eq 0 ] && say "heartbeat VOICESTUDIO_PUBLIC_URL=$URL"
done
