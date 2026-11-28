# How the Colab GPU setup works (FLUX images + VoiceStudio voices)

This project has no fast GPU on the PC, so two heavy jobs run on a free Google Colab T4 GPU and the app talks to them over the internet:

| Job | What runs on Colab | What the app uses it for |
|---|---|---|
| Images | FLUX (stable-diffusion.cpp `sd-server`, port 7860) | Shot images and anchor images |
| Voices | VoiceStudio (engine OmniVoice, port 3900) | Urdu / Hindi / English narration and character voices |

Each one is a server started by a script from this repo's `kaggle/` folder, and each gets its own public address through a Cloudflare "quick tunnel". The app only needs that address.

No keys or tunnel addresses are written in this file. The voice server's key lives in `backend/.env` as `VOICESTUDIO_API_KEY`.

## The picture

```
 this PC (backend :4501)                       Google Colab (T4 GPU, Linux)
 ----------------------                        ----------------------------------------
 images  -> src/providers/fluxLocal.ts  --->   cloudflared tunnel --> sd-server  :7860   (FLUX)
 speech  -> src/providers/voicestudio.ts --->  cloudflared tunnel --> VoiceStudio :3900   (OmniVoice)
            (both use src/net/reachable.ts + httpx.ts to pick an address that answers)
```

Addresses are random and change every session. They are stored (without secrets) in `backend/storage/image-settings.json` (`fluxUrl`) and `backend/storage/voice-settings.json` (`voicestudioUrl`). Both files are git-ignored.

## Starting it (about 5 minutes with a warm cache, up to about 75 minutes cold)

You need a Colab notebook with the GPU runtime set to T4 (Runtime, Change runtime type). The notebook has one code cell for FLUX and uses the Terminal panel for VoiceStudio, because a running cell blocks other cells but the terminal runs beside it.

### Step 0 (optional, but saves the 65-minute compile): mount Google Drive
Run this once in a new cell, then click through Google's permission prompts yourself:
```
from google.colab import drive; drive.mount('/content/drive')
```
With Drive mounted, the FLUX launcher saves the built server to `MyDrive/shotcraft-flux-cache` and restores it next session in seconds. Without Drive, it compiles every time.

### Step 1: FLUX (a notebook cell)
```
!curl -fsSL --retry 8 --retry-all-errors https://raw.githubusercontent.com/abdulkarimtaji33/videogenerator/main/kaggle/flux-server.sh -o f.sh; bash f.sh
```
What `kaggle/flux-server.sh` does, in order:
1. Restores the built server from Drive if it can, otherwise builds stable-diffusion.cpp `master-1111-6874e49` with CUDA for the T4 (`-DGGML_CUDA_FA=OFF`; the FlashAttention kernels took 40+ minutes on Colab's 2 cores). A cold build took about 65 minutes. Compiler output goes to `/content/flux/build.log`, so the cell looks quiet during the compile. That is normal.
2. Downloads the three models, resumable: image model 3.27 GB, text encoder 2.5 GB, image decoder 0.34 GB. Minutes on Colab.
3. Starts `sd-server` on 7860 and makes a test image.
4. Opens a Cloudflare tunnel and prints `FLUX_PUBLIC_URL=https://....trycloudflare.com`, then a heartbeat every 5 minutes.

Point the app at it (from `backend/`): `node scripts/set-flux-url.js <that address> --size 576x1024 --steps 4`. Use `node scripts/set-flux-url.js local` to go back to this PC's slow CPU build. Check it with `npx tsx scripts/check-gpu.ts`; measure speed with `npx tsx scripts/flux-bench.ts`.

Measured (2026-11-26, T4, through the app's own code): 576x1024 plain image 27 to 33 s; with 2 reference images 90 s. This PC's CPU: about 8.6 minutes plain at 384x640, about 16 minutes with references.

### Step 2: VoiceStudio (the Colab Terminal)
Open the Terminal panel (bottom left of the notebook). Choose a long random key, then paste one line:
```
curl -fsSL https://raw.githubusercontent.com/abdulkarimtaji33/videogenerator/main/kaggle/voicestudio-server.sh -o v.sh; VOICESTUDIO_KEY=<your key> nohup bash v.sh > /content/vs-run.log 2>&1 &
```
The same key goes in `backend/.env` as `VOICESTUDIO_API_KEY`. `nohup ... &` matters: it keeps the server running if the terminal window disconnects or someone presses Ctrl+C.

What `kaggle/voicestudio-server.sh` does:
1. Installs `uv`, clones `debpalash/VoiceStudio`, runs `uv sync --python 3.11 --no-dev` (about 4 minutes on Colab).
2. Starts the server with `OMNIVOICE_API_KEY` set (all routes require the key; verified: 401 without it, 200 with it).
3. Opens a tunnel and prints `VOICESTUDIO_PUBLIC_URL=...` into `/content/vs-run.log`. Read it with `grep VOICESTUDIO_PUBLIC_URL /content/vs-run.log | tail -n 1`.
4. Restarts the server or the tunnel if either dies; prints a heartbeat every 5 minutes.

Point the app at it: `node scripts/set-voicestudio.js <that address>`. (Routes: `/elevenlabs/v1/...` takes the key as `xi-api-key`; the other routes take `Authorization: Bearer <key>`.)

### Step 3: the voice model (once per fresh server)
A fresh server has no model, and the first speech request is refused with `403 model_licence_required`.
1. Read the licence: `GET /models/licenses/details/k2-fsa/OmniVoice`. It is CC-BY-NC (non-commercial), plus Higgs Audio 2 and Meta Llama 3. **Accepting it is the owner's decision.** On 2026-11-28 the owner said not to worry about non-commercial use and to use the best voice, and it was accepted for this server.
2. Accept it: `POST /models/licenses/accept` with `{repo_id, fingerprint, accepted: true}` (the fingerprint comes from the details call).
3. Install it: `POST /models/install` with `{"repo_id":"k2-fsa/OmniVoice"}`, then watch `GET /models/install/status`. 3.27 GB at about 40 MB/s took about 1.5 minutes. Do not treat the word `bytes_done` as "done": wait until the job disappears from the list.
4. Make a sample: `npx tsx scripts/voice-sample.ts` (from `backend/`). It writes mp3 files to `backend/storage/voice-test/`.

### Step 4: word timings for captions (speech-recognition model)
Captions need the start and end time of every spoken word. VoiceStudio gets them by listening to the finished speech with a speech-recognition (ASR) model, and it **only estimates** them when no ASR model is installed (the files then show just 2 timing marks). A fresh server has none installed.
- Install Whisper large-v3 Turbo (`deepdml/faster-whisper-large-v3-turbo-ct2`, 1.6 GB, 99 languages including Urdu and Hindi, MIT licence, no acceptance needed): `POST /models/install` with `{"repo_id":"deepdml/faster-whisper-large-v3-turbo-ct2"}`. The download took about 40 seconds at 25 to 45 MB/s, after which the server needs a short time to finish. Wait until `GET /models/install/status` returns `{"jobs":[]}`.
- **Which route gives word timings (measured 2026-11-28):** `POST /v1/audio/transcriptions` (multipart: `file`, `response_format=verbose_json`, `timestamp_granularities[]=word`, key as `Authorization: Bearer`). It returns one segment per word with `start` and `end`. The ElevenLabs-style `POST /elevenlabs/v1/speech-to-text` returned the correct text but an **empty** `words` list for both `word` and `character` granularity, so the app does not use it (`src/providers/voicestudio.ts`).
- The server also has `POST /elevenlabs/v1/text-to-speech/{voice}/with-timestamps` (speech plus timings in one call); it was not tested.
- Check it worked: after a sample, the `.words.json` file next to the mp3 should have one entry per spoken word, not 2. Measured on the Hindi samples: 20 and 22 timings (about 6.5 s of speech each), e.g. `नमस्ते 0.0 to 0.6 s`, `दोस्तों 0.6 to 1.04 s`. Whisper's transcript of the Hindi sample matched the spoken text.

### Step 5: distinct voices per role
Without this every request uses the server's single default voice, so the male and female narrators sound alike. A voice is a "profile" built from a text description:
1. `POST /design/describe` with `{"description":"young adult male, moderate pitch, energetic"}` returns design settings (`attrs`) and an `instruct` string. It understands gender, age, pitch, style and accent words; other words (such as "warm" or "gruff") come back as `unmatched` and are ignored.
2. `POST /profiles` (multipart form) with `name`, `kind=design`, `vd_states=<the attrs JSON>`, `instruct`, `seed`, `language=Auto` creates the profile and returns its `id`. The seed fixes the voice, so the same seed gives the same voice.
3. Tell the app: `node scripts/set-voicestudio.js <address> --voice narrator=<id> --voice male-0=<id> --voice male-1=<id> --voice female-0=<id> --voice female-1=<id>`. The slots are `narrator`, `male-N` and `female-N`; a slot with no voice falls back to its role, then to the default.

Voices made on 2026-11-28 (descriptions and seeds; the ids belong to that one server session and are not reusable):

| Slot | Description | Seed |
|---|---|---|
| narrator | deep calm adult male, low pitch | 101 |
| male-0 | young adult male, moderate pitch | 202 |
| male-1 | middle-aged male, low pitch | 303 |
| female-0 | young adult female, high pitch | 404 |
| female-1 | middle-aged female, moderate pitch | 505 |

**Profiles live on the Colab disk and vanish when the session ends**, so each fresh server needs this step again (about 5 calls). Because the seed fixes the voice, recreating them with the same descriptions and seeds should give the same voices, but that has not been tested.

Note: the commercial-use warning is real. If a channel using these voices is monetized, check the licence terms first, or switch to an Apache-2.0 model (VoxCPM2, which has Hindi but no Urdu).

## What each file does
| File | Role |
|---|---|
| `kaggle/flux-server.sh` | FLUX launcher (build or restore, models, server, tunnel, heartbeat) |
| `kaggle/voicestudio-server.sh` | VoiceStudio launcher (install, server, tunnel, heartbeat) |
| `backend/src/providers/fluxLocal.ts` | The app's FLUX client |
| `backend/src/providers/voicestudio.ts` | The app's VoiceStudio client; word timings from VoiceStudio's transcription, falling back to speech span |
| `backend/src/net/reachable.ts`, `httpx.ts` | Pick a Cloudflare address that really answers (see below) |
| `backend/scripts/set-flux-url.js`, `set-voicestudio.js` | Save the new address in the app |
| `backend/scripts/check-gpu.ts`, `flux-bench.ts`, `voice-sample.ts` | Check, measure, and sample |

## Drive cache: what is saved and why only some of it
Measured on 2026-11-28:

| Item | Size | Cached? |
|---|---|---|
| FLUX server program and libraries | not measured yet (the build had not finished); the estimate was about 100 MB or a few hundred MB | Yes, if Drive is mounted |
| FLUX models | about 6 GB | No: they re-download in minutes |
| VoiceStudio Python environment (`.venv`) | 8.4 GB | No: too big |
| Python interpreter used by uv | 97 MB | Saved together with the environment only |
| OmniVoice model folder | 4.6 GB (weights 3.3 GB) | No: too big |
| Google Drive | 15 GB, 13 GB used, 2.9 GB free | |

The Drive had only 2.9 GB free, so VoiceStudio is **not** cached: each fresh session costs about 5.5 minutes (4 for packages, 1.5 for the model). The script checks free space before saving and says "not saving ... Drive has N MB free" instead of failing, so if you free about 9 GB on Drive it will start saving the environment by itself.

## Things that went wrong, and the fix
- **A Colab session ends by itself** after about 2 hours of this use ("Runtime disconnected"). Both tunnels then answer Cloudflare error 530 and a new session starts empty. Start again from Step 0.
- **Cloudflare error 1033** means the tunnel name exists but nothing is connected. It happens when the script that owns the tunnel was stopped (for example by Ctrl+C in the terminal). Restart the script.
- **Terminal says `[disconnected]`**: only the window lost its connection. Close its tab, click Terminal again. The `nohup` job keeps running.
- **Stray keys in the Terminal** (typed by hand or by a browser agent) can stop the script. Never type into the terminal that runs it; use a second terminal window for checks.
- **The FLUX cell looks stuck** after "Build cuda_...": the compile output is going to `build.log`. Run `tail -n 3 /content/flux/build.log` in the Terminal.
- **This PC reached only one of two Cloudflare addresses.** The operating system's name lookup kept returning a dead address while a direct DNS query returned two. `reachable.ts` tests each address and `httpx.ts` uses the one that answers. Node's built-in `fetch` cannot do this, so the tunnels are not called through it.
- **This PC's internet was about 50 KB/s** to GitHub, Hugging Face and PyPI on 2026-11-28, so big downloads (the 2.4 GB model, Python packages) must happen on Colab, which downloads at 25 to 45 MB/s.
- **A Python script that talks to the voice server needs `import "dotenv/config"`** to read the key from `backend/.env`; only the backend server loads it automatically.
- **Browser automation was unreliable** (tab groups changed between calls, and the "started debugging this browser" bar shifts the page down about 70 pixels, so clicks land in the wrong place). Colab steps are easier to do by hand.
- **Colab terms:** the free tier restricts serving web services and Stable-Diffusion-style use. The owner was told and chose to use it.

## Status when this was written (2026-11-28)
- FLUX build on Colab was still compiling (not finished), so no new FLUX address existed yet.
- VoiceStudio server was running, the OmniVoice model was installed (3.27 GB, 13 files) and its licence accepted. The first three samples were made with the single default voice (Urdu male narrator, Urdu female, Hindi narrator; about 250 s for each of the first two, 13.8 s for the Hindi one): each had only 2 word timings, because no ASR model was installed yet.
- Then: Whisper large-v3 Turbo was installed and five voices were created and saved in the app (`storage/voice-settings.json`). The owner chose **Hindi instead of Urdu**: Hindi is now the default and the only non-English choice in the new-project and channel menus (the backend still supports Urdu for projects 13 and 14).
- Hindi samples with the new voices: `backend/storage/voice-test/narrator-hindi.mp3` and `female-hindi.mp3` (13 to 17 s to make about 6.5 s of speech). Word timings now work (20 and 22 per file). **Not verified:** how the voices sound (nobody has judged them yet) and whether the male and female voices are clearly different to a listener.
- Veoframe video generation stays off (`VEOFRAME_ENABLED=false`) and project 14 stays paused until the owner says otherwise.
