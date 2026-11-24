# Image models

Every image (anchor reference images and shot images) goes through one function, `makeImage()` in `backend/src/images/index.ts`. It picks the provider, optionally falls back to OpenAI, scales the result to the requested size, and returns which model made the image and how long it took (saved as `image_provider_used` and `image_ms` on the anchor or shot).

## Providers
| id | What | Notes |
|---|---|---|
| `flux-local` | Self-hosted FLUX via stable-diffusion.cpp `sd-server` (`backend/src/providers/fluxLocal.ts`) | Default. Free per image, slow on CPU. One request at a time. 15 min timeout per request. Sends anchor images as `ref_images` (up to 10) |
| `openai` | OpenAI image API | Costs credits; currently returns 429 until credits are added |
| `fal` | fal.ai image API | Optional |

## How the provider is chosen
1. The project's `image_provider` (set on the new-project form: `imageProvider` in `POST /api/projects`). `null` means "use the default".
2. Otherwise the saved default (`defaultProvider`, initial value `flux-local`, or the `IMAGE_PROVIDER` env var).
3. If the chosen provider fails and the project has `image_fallback` on (`imageFallback: true`), OpenAI is tried once and the result is recorded as `openai`. If fallback is off, the stage fails with the error plus a hint ("Start it with `npm run flux`, or turn on fall back to OpenAI for this project"). Fallback is off by default so nobody is billed silently. When OpenAI is the chosen provider there is no further fallback.

## Settings
Stored in `backend/storage/image-settings.json` (no DB migration). Environment variables give the first values.

| Setting | Env var | Default |
|---|---|---|
| `defaultProvider` | `IMAGE_PROVIDER` | `flux-local` |
| `fluxUrl` | `FLUX_URL` | `http://127.0.0.1:7860` |
| `fluxModel` | `FLUX_MODEL` | `flux-2-klein-4b-q4` (label only; the server loads the file) |
| `fluxSteps` | `FLUX_STEPS` | 4 |
| `fluxWidth` x `fluxHeight` | `FLUX_WIDTH`, `FLUX_HEIGHT` | 576 x 1024 |

FLUX renders at that small size; `makeImage` upscales with FFmpeg lanczos to the size the pipeline asked for (1024x1536 / 1536x1024 / 1024x1024).

API:
- `GET /api/system/images` returns each provider (configured, online, last speed), the default and the FLUX settings.
- `PUT /api/system/images` changes `default`, `fluxUrl`, `fluxModel`, `fluxSteps`.
- `POST /api/system/images/test` makes one small image with the chosen provider and no fallback. It may spend OpenAI credits if you test `openai`.

## Starting the FLUX server
Files live on E: because C: is nearly full.
1. Download (resumable, safe to re-run; the connection is slow and drops often): `bash e:/projects/flux/download.sh`. It fetches the stable-diffusion.cpp CPU build into `e:\projects\flux\bin` and the FLUX 3 Klein Q4_K_M GGUF (about 3.3 GB) into `e:\projects\flux\models`.
2. Start: `npm run flux` in `backend` (runs `e:\projects\flux\start.ps1`: `sd-server` on 127.0.0.1:7860, one thread per core, 4 steps).
3. Check: `GET /api/system/images` should show `flux-local` online, or run `node scripts/qa-check.js`.

Start order: MariaDB (XAMPP), `npm run flux`, backend, frontend.

## Rented GPU instead of the CPU
The provider only talks to a URL. Run any stable-diffusion.cpp `sd-server` (or a compatible server exposing `/v1/images/generations` and `/v1/models`) on a rented GPU box, then set the FLUX URL in Settings (or `PUT /api/system/images` with `fluxUrl`). No code change. Keep the box private or behind a token-protecting proxy.

## Fallback rules at a glance
| Chosen | Fallback toggle | FLUX down |
|---|---|---|
| `flux-local` | off | Stage fails with a start hint |
| `flux-local` | on | OpenAI makes the image (credits needed), recorded as `openai` |
| `openai` | any | Error is shown; no other fallback |

## Benchmark (to fill in)
No NVIDIA GPU exists on this PC (Intel HD 520 only), so FLUX runs on the CPU. Record the first measured numbers here.

| Date | Model | Build | Size | Steps | Seconds per image |
|---|---|---|---|---|---|
| _pending_ | FLUX 3 Klein Q4_K_M | CPU AVX2 | 576x1024 | 4 | _pending_ |

If an image takes over 6 minutes, prefer the rented GPU URL.
