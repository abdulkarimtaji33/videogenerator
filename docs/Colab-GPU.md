# Free GPU for FLUX (and VoiceStudio): Colab and Kaggle, measured

Why: FLUX on this PC's CPU takes 8.6 minutes for a small plain image and about 16 minutes with reference images. On a free Colab T4 it takes about 30 seconds (plain) and 90 seconds (two references).

## What was measured (2026-11-26, Colab T4, 576x1024, 4 steps, through the app's own code over the tunnel)
| Case | Colab T4 | This PC's CPU (384x640) |
|---|---|---|
| plain image | 28.9 s, 27.4 s, 33.1 s, 27.0 s | 513 s |
| with 2 reference images | 90.2 s | about 960 s |

## How to start it
1. Colab: new notebook, Runtime -> Change runtime type -> T4 GPU. One cell: `!curl -fsSL --retry 8 --retry-all-errors https://raw.githubusercontent.com/abdulkarimtaji33/videogenerator/main/kaggle/flux-server.sh -o f.sh; bash f.sh` (works on Kaggle too: GPU T4 x2, Internet on, phone verified).
2. The script builds stable-diffusion.cpp `master-1111-6874e49` with CUDA (T4 only, **without FlashAttention**), downloads the three models (resumable, fast on Colab), starts `sd-server` on 7860, renders a test image and opens a Cloudflare quick tunnel (it prints `FLUX_PUBLIC_URL=...`).
3. Point the app at it: `node scripts/set-flux-url.js <url> --size 576x1024 --steps 4` (`... local` goes back to the CPU). Check it: `npx tsx scripts/check-gpu.ts`; measure it: `npx tsx scripts/flux-bench.ts [reference images]`.
4. VoiceStudio on the same GPU: see `docs/HANDOFF-2026-11-26.md` section 6 (clone `debpalash/VoiceStudio`, `uv sync --python 3.11 --no-dev`, run with `OMNIVOICE_API_KEY` set, its own tunnel; `node scripts/set-voicestudio.js <url>`).

## Things that went wrong, and what they taught
- **The build is slow on Colab's 2 CPU cores:** with FlashAttention kernels it was 61% after 30 minutes; with `-DGGML_CUDA_FA=OFF` it took about 65 minutes in total (the heavy parts are the matrix-multiply kernels and the model integrations). Kaggle has more cores but its free GPU queue was 600+ places long and barely moving.
- **Colab sessions end by themselves:** this one ran about 2 hours and then showed "Runtime disconnected"; both tunnels then answered Cloudflare error 530. A new session starts from nothing (a rebuild). Keeping the build somewhere permanent needs a decision from the owner (Google Drive mount = an OAuth permission; a GitHub release asset = publishing a binary).
- **Tunnels:** the Cloudflare quick tunnel answered 429 for several minutes before it worked (the script retries). `localhost.run` slows every request by about a minute: do not use. A tunnel address is random and public: do not post it; the VoiceStudio server needs its API key (verified: 401 without it).
- **One of the two Cloudflare addresses is unreachable from this PC.** The OS resolver (`dns.lookup`, used by Node and fetch) returned only that dead address, while `dns.resolve4` returned both. `src/net/reachable.ts` picks an address that answers a quick TCP test; the FLUX client and the VoiceStudio client (`src/net/httpx.ts`) use it. Node's built-in `fetch` cannot, so it is not used for tunnels.
- Colab's notebook output is an iframe; read logs with the Terminal panel (`tail`).
- Terms: Colab's free tier restricts serving web services and Stable-Diffusion-style use; the owner was told and chose to use it anyway.
