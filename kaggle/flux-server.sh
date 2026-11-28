#!/usr/bin/env bash
# Runs the FLUX image server on a free Kaggle GPU (2x T4) and opens a public tunnel to it, so the video generator can use it
# instead of the slow CPU. Run it from a Kaggle notebook cell (GPU T4 x2, Internet on):
#
#   !curl -fsSL --retry 8 --retry-all-errors https://raw.githubusercontent.com/abdulkarimtaji33/videogenerator/main/kaggle/flux-server.sh -o f.sh; bash f.sh
#
# What it does (every network step retries, so a glitchy connection only slows it down; safe to run again):
#   1. builds stable-diffusion.cpp (the same release as the local PC: master-1111-6874e49) with CUDA for the T4 (about 10-15 min the first time)
#   2. downloads the FLUX.3 Klein model, the Qwen3-VL text encoder and the VAE (about 6 GB, resumable)
#   3. starts sd-server on 127.0.0.1:7860, makes one test image and prints how long it took
#   4. opens a Cloudflare quick tunnel and prints the public address:   FLUX_PUBLIC_URL=https://....trycloudflare.com
#   5. stays alive (restarts the server or the tunnel if either dies) and prints a heartbeat with the address every 5 minutes.
# The address is random and changes every session. Anyone who has it can use the GPU, so do not post it anywhere.
# Nothing in this file is secret.

set -u
# Kaggle keeps its files in /kaggle/working, Google Colab in /content.
if [ -n "${FLUX_WORKDIR:-}" ]; then W="$FLUX_WORKDIR"; elif [ -d /kaggle/working ]; then W=/kaggle/working/flux; elif [ -d /content ]; then W=/content/flux; else W="$HOME/flux"; fi
SD_TAG=master-1111-6874e49
PORT=7860
mkdir -p "$W/models" && cd "$W" || exit 1
say() { echo "[$(date +%H:%M:%S)] $*"; }

retry() { # retry <tries> <command...>
  local n="$1"; shift; local i
  for i in $(seq 1 "$n"); do "$@" && return 0; say "retry $i/$n: $*"; sleep 10; done
  return 1
}

get() { # get <url> <dest> <expected bytes>: resumable download, repeated until the size matches
  local url="$1" dest="$2" want="$3" i have
  for i in $(seq 1 400); do
    have=$(stat -c %s "$dest" 2>/dev/null || echo 0)
    [ "$have" = "$want" ] && { say "have $(basename "$dest")"; return 0; }
    curl -L -sS --http1.1 --connect-timeout 20 --speed-time 60 --speed-limit 1000 -C - -o "$dest" "$url" 2>/dev/null
    sleep 2
  done
  say "GAVE UP on $dest"; return 1
}

say "GPU:"; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1 | head -n 2

# ---- 1. build sd-server with CUDA ----
BIN="$W/sd/build/bin/sd-server"
# Google Drive cache (Colab only, when the notebook has mounted Drive first: from google.colab import drive; drive.mount('/content/drive')).
# The build takes about 65 minutes on Colab's 2 cores, but a Colab session is wiped when it ends, so the built server is kept on Drive
# and restored in seconds next time. Only the server program and its libraries (about 100 MB) are stored, no models and no secrets.
CACHE=""
[ -d /content/drive/MyDrive ] && CACHE="/content/drive/MyDrive/shotcraft-flux-cache" && mkdir -p "$CACHE"
CACHE_TGZ="$CACHE/sd-server-$SD_TAG-sm75.tgz"
has_missing_libs() { ldd "$1" 2>/dev/null | grep -q "not found"; }
if [ ! -x "$BIN" ] && [ -n "$CACHE" ] && [ -s "$CACHE_TGZ" ]; then
  say "restoring the built server from Drive"
  mkdir -p "$W/sd/build" && tar -xzf "$CACHE_TGZ" -C "$W/sd/build" 2>/dev/null
  if [ -x "$BIN" ] && ! has_missing_libs "$BIN" && "$BIN" --help >/dev/null 2>&1; then say "restored from Drive (no build needed)"; else say "the Drive copy does not run here; building instead"; rm -rf "$W/sd/build"; fi
fi
# Prebuilt server from GitHub (built by .github/workflows/build-sd-server.yml, CUDA 13 for the T4): a download of about a minute instead of
# the 65 minute compile. Checked the same way as the Drive copy; if it does not run here, the compile below still happens.
if [ ! -x "$BIN" ]; then
  REL_URL="https://github.com/abdulkarimtaji33/videogenerator/releases/download/sd-server-$SD_TAG/sd-server-$SD_TAG-sm75-cuda13.tgz"
  say "trying the prebuilt server from GitHub"
  mkdir -p "$W/sd/build"
  if curl -fsSL --retry 5 --retry-all-errors -o "$W/sd-prebuilt.tgz" "$REL_URL" && tar -xzf "$W/sd-prebuilt.tgz" -C "$W/sd/build" 2>/dev/null \
     && [ -x "$BIN" ] && ! has_missing_libs "$BIN" && "$BIN" --help >/dev/null 2>&1; then
    say "using the prebuilt server (no build needed)"
    [ -n "$CACHE" ] && [ ! -s "$CACHE_TGZ" ] && cp "$W/sd-prebuilt.tgz" "$CACHE_TGZ" && say "kept a copy on Drive"
  else
    say "the prebuilt server is not available or does not run here; building instead"
    rm -rf "$W/sd/build"
  fi
fi
[ -n "$CACHE" ] || say "Drive is not mounted: the build will not be saved (mount it first to avoid the 65 minute build next time)"
if [ ! -x "$BIN" ]; then
  say "building stable-diffusion.cpp $SD_TAG with CUDA (first run only)"
  command -v nvcc >/dev/null 2>&1 || export PATH=/usr/local/cuda/bin:$PATH
  nvcc --version 2>&1 | tail -n 1
  [ -d sd/.git ] || retry 8 git clone --recurse-submodules https://github.com/leejet/stable-diffusion.cpp sd
  cd sd && git checkout -q "$SD_TAG" && retry 8 git submodule update --init --recursive
  # GGML_CUDA_FA=OFF skips the FlashAttention GPU kernels: they take 40+ minutes to compile on a 2-core Colab machine (measured), the
  # rest builds in a few minutes, and the image server works without them.
  cmake -B build -DSD_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=75 -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA_FA=OFF > "$W/cmake.log" 2>&1 || { tail -n 25 "$W/cmake.log"; say "cmake failed"; exit 1; }
  cmake --build build -j"$(nproc)" --target sd-server > "$W/build.log" 2>&1 || { tail -n 30 "$W/build.log"; say "build failed"; exit 1; }
  cd "$W"
  [ -x "$BIN" ] || BIN=$(find "$W/sd/build" -name sd-server -type f | head -n 1)
  if [ -n "$CACHE" ] && [ -x "$W/sd/build/bin/sd-server" ]; then
    say "saving the built server to Drive"
    (cd "$W/sd/build" && tar -czf "$CACHE_TGZ.part" $(find . -type f \( -path './bin/*' -o -name '*.so' -o -name '*.so.*' \) | sed 's#^\./##')) \
      && mv -f "$CACHE_TGZ.part" "$CACHE_TGZ" && say "saved: $(du -h "$CACHE_TGZ" | cut -f1) in $CACHE" || say "could not save to Drive (the server still runs)"
  fi
fi
[ -x "$BIN" ] || { say "sd-server was not built"; exit 1; }
say "sd-server ready: $BIN"

# ---- 2. models ----
get "https://huggingface.co/Chungulus/flux-3-image-klein-comfy-Q4_K_M-GGUF/resolve/main/flux-3-image-klein-comfy-Q4_K_M.gguf" models/flux-3-image-klein-Q4_K_M.gguf 3269858304 || exit 1
get "https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/main/split_files/vae/flux2-vae.safetensors" models/flux2-vae.safetensors 336211292 || exit 1
get "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf" models/Qwen3VL-4B-Instruct-Q4_K_M.gguf 2497281664 || exit 1

# ---- 3. server ----
start_server() {
  pkill -f "sd-server.*--listen-port $PORT" 2>/dev/null; sleep 1
  nohup "$BIN" --diffusion-model models/flux-3-image-klein-Q4_K_M.gguf --llm models/Qwen3VL-4B-Instruct-Q4_K_M.gguf --vae models/flux2-vae.safetensors \
    --listen-ip 127.0.0.1 --listen-port $PORT --cfg-scale 1.0 --steps 4 --sampling-method euler > "$W/server.log" 2>&1 &
  local i
  for i in $(seq 1 120); do
    curl -s -m 3 "http://127.0.0.1:$PORT/v1/models" | grep -q sd-cpp && { say "sd-server is up"; return 0; }
    sleep 5
  done
  tail -n 25 "$W/server.log"; say "sd-server did not come up"; return 1
}
start_server || exit 1

# a test image, so the log shows how fast this GPU is (same request shape the app uses)
t0=$(date +%s)
curl -s -m 600 -X POST "http://127.0.0.1:$PORT/v1/images/generations" -H "Content-Type: application/json" \
  -d '{"prompt":"A single red apple on a white table, soft daylight, photograph. <sd_cpp_extra_args>{\"sample_params\":{\"sample_steps\":4,\"guidance\":{\"txt_cfg\":1.0}}}</sd_cpp_extra_args>","n":1,"size":"576x1024","output_format":"png"}' \
  | head -c 120 | grep -q b64_json && say "TEST IMAGE 576x1024: OK in $(( $(date +%s) - t0 )) s" || { say "TEST IMAGE failed"; tail -n 20 "$W/server.log"; }

# ---- 4. tunnel ----
[ -x "$W/cloudflared" ] || retry 20 curl -fsSL --retry 5 --retry-all-errors -o "$W/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x "$W/cloudflared"
URL=""
start_tunnel() {
  pkill -f "cloudflared tunnel" 2>/dev/null; sleep 1
  : > "$W/tunnel.log"
  nohup "$W/cloudflared" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$W/tunnel.log" 2>&1 &
  local i
  for i in $(seq 1 60); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$W/tunnel.log" | head -n 1)
    [ -n "$URL" ] && return 0
    sleep 2
  done
  return 1
}
retry 10 start_tunnel || { tail -n 20 "$W/tunnel.log"; say "no tunnel"; exit 1; }
say "FLUX_PUBLIC_URL=$URL"

# ---- 5. stay alive ----
n=0
while true; do
  sleep 60
  n=$((n+1))
  curl -s -m 5 "http://127.0.0.1:$PORT/v1/models" | grep -q sd-cpp || { say "server stopped; restarting"; start_server; }
  pgrep -f "cloudflared tunnel" >/dev/null || { say "tunnel stopped; restarting"; start_tunnel && say "FLUX_PUBLIC_URL=$URL"; }
  [ $((n % 5)) -eq 0 ] && say "heartbeat FLUX_PUBLIC_URL=$URL"
done
