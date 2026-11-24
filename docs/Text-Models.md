# Text model: Ollama by default, OpenAI as the other choice

Researched 2026-11-25. Hardware was deliberately **not** a factor (owner's decision): the question was "which Ollama model is best for this app".

## What the text model does here
Every writing step goes through `generateText()` in `backend/src/openai.ts`: creative brief, fact list and its strict check, ten hook candidates and their fact check, SEO package, the script (one call for a Short; outline plus several calls for long-form), the script review fixer, and narration shortening. Nearly all of them must return **valid JSON** (the pipeline parses, validates with zod and retries once: `jsonStep`). Quality needs: follows long structured instructions exactly, writes plain spoken narration, stays inside the facts it is given, never breaks the JSON.

## What was checked
- Ollama's real library pages (ollama.com/library, read 2026-11-25): which models exist, tags, sizes, context, capabilities.
- The official Qwen3.8-27B model card (sampling settings, how to turn thinking off, IFBench).
- Ollama API docs (`/api/chat`: `think`, `format`, `options`, streaming), Ollama issue tracker reports, creative-writing and SimpleQA leaderboards, and blogs (treated as weak evidence, since most are SEO pages).

## Candidates on Ollama

| Model (tag) | Size | Context | Verdict |
|---|---|---|---|
| **qwen3.8:27b** | 18 GB (Q4_K_M) | 256K | **Chosen.** Newest (released 2026-08-14), dense, Apache 2.0, text+image, tools, thinking. IFBench 79.5 vs 69.1 for Qwen3.6-27B on the same card. Consistently the family reviewers rate best for structured output. |
| qwen3.6:35b-a3b | 23 GB | 256K | Faster MoE (3B active), a bit weaker. Offered as the speed option. |
| qwen3.6:27b | 18 GB | 256K | Previous dense Qwen. Kept as a pick if 3.8 misbehaves. |
| gemma4:31b | 20 GB | 256K | Good prose, but open Ollama issues (#15386, #15502): with a JSON-schema constraint it can loop or disagree with its own reasoning; ignores JSON-only prompts by wrapping in code fences. Higher risk for a JSON-heavy pipeline. |
| gpt-oss:120b | 65 GB | 128K | Strong reasoning, but the lowest creative-writing score seen on one aggregator board (about 1041; boards differ, so only the ordering is meaningful) and a reported 78% hallucination rate on SimpleQA. Wrong trade for writing narration from supplied facts. |
| deepseek-v4-pro / v4.1-flash, glm-5.x, kimi-k2.x/k3 | hundreds of GB | up to 1M | Cloud-only or multi-GPU. They top the writing boards (Kimi K3, GLM) but Ollama's cloud route has no structured-output support and needs an account; they stay available by typing a `:cloud` tag in Settings. |
| llama4, mistral-small3.2, magistral | 24B-109B | 128K | A year old; behind the 2026 Qwen and Gemma releases. |

## Decision
**`qwen3.8:27b`**, thinking off, sampling temperature 0.7 / top_p 0.8 / top_k 20 (the card's non-thinking settings), 32K context.

Why:
1. Highest instruction-following score on a model card we could verify, and the largest gain over its predecessor on exactly the skill this app needs.
2. Best-supported structured output of the strong models: no known Ollama JSON bugs of the Gemma 4 kind.
3. Competitive writing quality at dense 27B; the writing boards that rank bigger models higher (Kimi, GLM) are cloud-only.
4. Apache 2.0, free, runs locally, 256K context (scripts and fact lists fit easily).

## Choices made in the code (and why)
- **Native `/api/chat`, streamed.** `think` is only reliable on the native route (Ollama issues #17969 and #17292: `/v1` ignores it for Qwen3 and reasoning then eats the output budget). Streaming avoids request timeouts on slow generations.
- **`think: false` by default.** Qwen3.8's default is maximum reasoning ("wildly overthinking", Simon Willison, 2026-08-16: 21 minutes for one answer). The steps here are writing and JSON, so reasoning is off; a Settings switch turns it on. A model with no thinking mode gets the request again without the field.
- **`num_ctx` 32768.** Ollama's own default is 4096 and silently truncates long prompts (the long-form review prompt alone is about 9K tokens).
- **No `format` / JSON-schema constraint.** Grammar-constrained decoding is the path with the loop bugs; the pipeline already validates and retries JSON itself.
- **No presence penalty.** The card suggests 1.5 against repetition, but a high penalty fights the repeated quotes and keys of JSON.
- `num_predict` capped (8192; 32768 with thinking) so a runaway generation stops.

## Real test results (2026-11-25)
The model was installed on a real Ollama on the VPS (Ubuntu 24.04, 2 vCPU, 7.8 GB RAM, no GPU; Ollama is limited to 6 GB, bound to localhost, low CPU priority and killed first on memory pressure so the production apps are safe) and reached from this PC through an SSH tunnel (`npm run ollama:tunnel`).

- **`qwen3.8:27b` did not load.** Downloaded fine (17 GB), but Ollama failed with `insufficient memory (attempted to allocate 11012 MB)`. A dense 27B model needs about 20-24 GB of RAM; this server cannot run it. It was removed from the server. It stays the recommendation for a machine with enough RAM.
- **`qwen3.5:4b` works.** `npm run check:text` through the real code path: a JSON answer in 15 s (includes loading the model) and a correct Urdu translation with a word-for-word Roman line in 10 s.
- The 4B is a clear step down in writing quality from the 27B, and the script still goes through the same checks (hook lint, fact check, script review, narration fitting), which is what keeps weak output from reaching a video. If a plan fails with "did not return valid JSON", try `qwen3.5:9b` on a bigger machine.

## Switching, fallback, and where to change it
Settings page, "Text model (writing)": choose Ollama or OpenAI, pick or type any Ollama tag, turn the standby on or off, test. The same values can be set in `backend/.env` (`TEXT_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_THINK`, `OLLAMA_NUM_CTX`, `TEXT_FALLBACK_TO_OTHER`); the saved Settings (`backend/storage/text-settings.json`) win. Order of attempts: chosen model, then the other one (if the standby is on, and for OpenAI only if a key is set), then Claude or Gemini if a key is set (`textFallback.ts`).

Setup: install Ollama (ollama.com), then `ollama pull qwen3.8:27b`.

## What this does not change
Images (FLUX or OpenAI), speech (Edge TTS) and caption timing are separate and untouched. OpenAI is now optional for a default run.

## Caveats
- The ranking leans on a model card, Ollama's library and issue tracker, plus weaker blog evidence; no head-to-head JSON-reliability test of these exact models exists. Before relying on it for a long run, do one plan-only run (`mode: "plan"`) and watch for "did not return valid JSON" errors; if they appear, try `qwen3.6:35b-a3b` or `qwen3.6:27b` from the same picker.
- Tags and sizes were read on 2026-11-25 and will drift.
