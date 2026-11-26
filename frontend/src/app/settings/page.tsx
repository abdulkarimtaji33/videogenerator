"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/studio";
import { fetchImageStatus, fetchTextStatus, fetchVoiceStatus, saveImageSettings, saveTextSettings, saveVoiceSettings, testImageProvider, testTextProvider, testVoice } from "@/lib/api";
import type { ImageTestResult, TextTestResult, VoiceTestResult } from "@/types";
import { Badge, Button, Card, ErrorNote, Field, Page, inputCls, useLoad } from "@/components/ui";

export default function SettingsPage() {
  const settings = useLoad<any>(() => api("GET", "/api/system/settings"));
  const overview = useLoad<any>(() => api("GET", "/api/system/overview"));
  const jobs = useLoad<any[]>(() => api("GET", "/api/system/jobs?limit=30"), 6000);
  const yt = useLoad<any>(() => api("GET", "/api/youtube/status"));
  const [order, setOrder] = useState<string[]>([]);
  const [pacing, setPacing] = useState(8);
  const [msg, setMsg] = useState<string | null>(null);
  const images = useLoad(() => fetchImageStatus());
  const [imgDefault, setImgDefault] = useState("flux-local");
  const [fluxUrl, setFluxUrl] = useState("");
  const [fluxModel, setFluxModel] = useState("");
  const [fluxSteps, setFluxSteps] = useState(4);
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImageTestResult | null>(null);

  useEffect(() => {
    if (images.data) {
      setImgDefault(images.data.default);
      setFluxUrl(images.data.flux?.url ?? "");
      setFluxModel(images.data.flux?.model ?? "");
      setFluxSteps(images.data.flux?.steps ?? 4);
    }
  }, [images.data]);

  async function saveImages() {
    setImgMsg(null);
    try {
      await saveImageSettings({ default: imgDefault, fluxUrl, fluxModel, fluxSteps });
      setImgMsg("Saved.");
      await images.reload();
    } catch (e: any) {
      setImgMsg(e.message);
    }
  }

  async function testImages() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testImageProvider(imgDefault));
    } catch (e: any) {
      setTestResult({ ok: false, provider: imgDefault, ms: 0, error: e.message });
    } finally {
      setTesting(false);
    }
  }

  const voice = useLoad(() => fetchVoiceStatus());
  const [voiceProvider, setVoiceProvider] = useState("edge");
  const [voiceUrl, setVoiceUrl] = useState("");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [voiceTesting, setVoiceTesting] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceTestResult | null>(null);

  useEffect(() => {
    if (voice.data) {
      setVoiceProvider(voice.data.provider);
      setVoiceUrl(voice.data.url);
    }
  }, [voice.data]);

  async function saveVoice() {
    setVoiceMsg(null);
    try {
      await saveVoiceSettings({ provider: voiceProvider, voicestudioUrl: voiceUrl.trim() });
      setVoiceMsg("Saved.");
      await voice.reload();
    } catch (e: any) {
      setVoiceMsg(e.message);
    }
  }

  async function runVoiceTest() {
    setVoiceTesting(true);
    setVoiceResult(null);
    try {
      await saveVoiceSettings({ provider: voiceProvider, voicestudioUrl: voiceUrl.trim() });
      setVoiceResult(await testVoice());
      await voice.reload();
    } catch (e: any) {
      setVoiceResult({ ok: false, provider: voiceProvider, ms: 0, error: e.message });
    } finally {
      setVoiceTesting(false);
    }
  }

  const text = useLoad(() => fetchTextStatus());
  const [txtProvider, setTxtProvider] = useState("gemini");
  const [geminiModel, setGeminiModel] = useState("");
  const [geminiThinking, setGeminiThinking] = useState("minimal");
  const [txtFallback, setTxtFallback] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [ollamaThink, setOllamaThink] = useState(false);
  const [ollamaCtx, setOllamaCtx] = useState(32768);
  const [txtMsg, setTxtMsg] = useState<string | null>(null);
  const [txtTesting, setTxtTesting] = useState(false);
  const [txtResult, setTxtResult] = useState<TextTestResult | null>(null);

  useEffect(() => {
    if (text.data) {
      setTxtProvider(text.data.provider);
      setGeminiModel(text.data.gemini?.model ?? "");
      setGeminiThinking(text.data.gemini?.thinking ?? "minimal");
      setTxtFallback(text.data.fallback);
      setOllamaUrl(text.data.ollama.url);
      setOllamaModel(text.data.ollama.model);
      setOllamaThink(text.data.ollama.think);
      setOllamaCtx(text.data.ollama.numCtx);
    }
  }, [text.data]);

  async function saveText() {
    setTxtMsg(null);
    try {
      await saveTextSettings({ provider: txtProvider, geminiModel, geminiThinking, fallback: txtFallback, ollamaUrl, ollamaModel, ollamaThink, ollamaNumCtx: ollamaCtx });
      setTxtMsg("Saved.");
      await text.reload();
    } catch (e: any) {
      setTxtMsg(e.message);
    }
  }

  async function testText() {
    setTxtTesting(true);
    setTxtResult(null);
    try {
      // Save first so the test runs on what is on screen.
      await saveTextSettings({ provider: txtProvider, geminiModel, geminiThinking, fallback: txtFallback, ollamaUrl, ollamaModel, ollamaThink, ollamaNumCtx: ollamaCtx });
      setTxtResult(await testTextProvider(txtProvider));
      await text.reload();
    } catch (e: any) {
      setTxtResult({ ok: false, provider: txtProvider, ms: 0, error: e.message });
    } finally {
      setTxtTesting(false);
    }
  }

  useEffect(() => {
    if (settings.data) {
      setOrder(settings.data.provider_order);
      setPacing(settings.data.pacing_seconds);
    }
  }, [settings.data]);

  const move = (i: number, d: number) => {
    const o = [...order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };

  async function save() {
    setMsg(null);
    try {
      await api("PUT", "/api/system/settings", { provider_order: order, pacing_seconds: pacing });
      setMsg("Saved.");
      await settings.reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function connectYoutube() {
    try {
      const r = await api("GET", "/api/youtube/auth-url");
      window.open(r.url, "_blank", "noopener");
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <Page title="Settings" subtitle="Provider order, pacing, connections and the job queue.">
      <ErrorNote error={settings.error ?? msg} />
      <Card title="Video flow order" right={<Button onClick={save}>Save</Button>}>
        <p className="mb-3 text-sm text-muted-foreground">The first available provider with quota left is used; if it fails the next one is tried.</p>
        <ul className="space-y-2">
          {order.map((id, i) => {
            const p = overview.data?.providers.clips.find((c: any) => c.id === id);
            return (
              <li key={id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>{i + 1}. {p?.label ?? id}</span>
                <span className="flex items-center gap-2">
                  {p && (p.ok ? <Badge tone="ok">ready</Badge> : <Badge>{p.reason ? "off" : "unavailable"}</Badge>)}
                  <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>Up</Button>
                  <Button variant="ghost" onClick={() => move(i, 1)} disabled={i === order.length - 1}>Down</Button>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 max-w-xs">
          <Field label="Pause between requests (seconds)" hint="Keeps browser-driven flows polite.">
            <input type="number" className={inputCls} value={pacing} min={0} max={120} onChange={(e) => setPacing(Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card title="Text model (writing)" right={<Button onClick={saveText}>Save</Button>}>
        <p className="mb-3 text-sm text-muted-foreground">
          Writes the brief, facts, hooks, SEO, script, review and the Urdu/Hindi translation. Gemini is the default; OpenAI and Ollama are the other choices
          and stand in when the first one fails. API keys are set in backend/.env, never here.
        </p>
        <ErrorNote error={text.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model to use">
            <select className={inputCls} value={txtProvider} onChange={(e) => setTxtProvider(e.target.value)}>
              {(text.data?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}{p.configured ? "" : " (not configured)"}</option>
              ))}
            </select>
          </Field>
          <Field label="If it fails, try the others" hint="Gemini, OpenAI and Ollama stand in for each other (only those that are set up). Off = never use another.">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={txtFallback} onChange={(e) => setTxtFallback(e.target.checked)} />
              {txtFallback ? "On" : "Off"}
            </label>
          </Field>
          <Field label="Gemini thinking" hint="How long Gemini thinks before answering. Minimal is fastest and right for writing.">
            <select className={inputCls} value={geminiThinking} onChange={(e) => setGeminiThinking(e.target.value)}>
              {(text.data?.gemini?.thinkingLevels ?? ["minimal", "low", "medium", "high"]).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Gemini model" hint="Gemini 3.5 Flash-Lite is the default; 3.8 Flash is the stronger choice (often busy on a free key). If one is busy, the other is used.">
            <input className={inputCls} list="gemini-models" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} placeholder="gemini-3.5-flash-lite" />
            <datalist id="gemini-models">
              {(text.data?.gemini?.recommended ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.note}</option>
              ))}
            </datalist>
          </Field>
          <Field label="Ollama model" hint="Pick an installed or recommended model, or type any Ollama tag.">
            <input className={inputCls} list="ollama-models" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} placeholder="qwen3.8:27b" />
            <datalist id="ollama-models">
              {[...new Set([...(text.data?.ollama.installed ?? []), ...(text.data?.ollama.recommended ?? []).map((r) => r.id)])].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Ollama address">
            <input className={inputCls} value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://127.0.0.1:11434" />
          </Field>
          <Field label="Context size (tokens)" hint="Ollama's own default (4096) is too small for scripts.">
            <input type="number" className={inputCls} value={ollamaCtx} min={2048} max={262144} step={1024} onChange={(e) => setOllamaCtx(Number(e.target.value))} />
          </Field>
          <Field label="Reasoning mode" hint="Off is faster and right for writing. Qwen3.8 over-thinks when it is on.">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ollamaThink} onChange={(e) => setOllamaThink(e.target.checked)} />
              {ollamaThink ? "On (slow)" : "Off"}
            </label>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {text.data?.providers?.map((p) => (
            <Badge key={p.id} tone={!p.configured ? "neutral" : p.online === false ? "error" : "ok"} >
              {p.id === "gemini" ? "Gemini" : p.id === "ollama" ? "Ollama" : "OpenAI"}: {!p.configured ? "not configured" : p.online === false ? "not ready" : p.online ? "ready" : "key set"}
            </Badge>
          ))}
        </div>
        {text.data?.providers?.filter((p) => p.detail && p.online !== true).map((p) => (
          <p key={p.id} className="mt-2 text-xs text-muted-foreground">{p.detail}</p>
        ))}
        {txtMsg && <p className="mt-2 text-sm text-muted-foreground">{txtMsg}</p>}
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={testText} disabled={txtTesting}>{txtTesting ? "Testing (the first call loads the model)..." : "Test text model"}</Button>
            {txtTesting && <span className="spinner" />}
          </div>
          {txtResult && (
            <div className="mt-3" aria-live="polite">
              {txtResult.ok ? (
                <p className="text-sm text-success">{txtResult.model} answered in {(txtResult.ms / 1000).toFixed(1)} s: <code>{txtResult.sample}</code></p>
              ) : (
                <ErrorNote error={txtResult.error ?? "The test failed."} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Speech (voices)" right={<Button onClick={saveVoice}>Save</Button>}>
        <p className="mb-3 text-sm text-muted-foreground">
          Who speaks the narration and the characters. VoiceStudio runs on the GPU server (its address changes whenever that session restarts); the free Microsoft Edge
          voices are the alternative. The server key is set in backend/.env, never here.
        </p>
        <ErrorNote error={voice.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Speech engine">
            <select className={inputCls} value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value)}>
              {(voice.data?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}{p.configured ? "" : " (no address)"}</option>
              ))}
            </select>
          </Field>
          <Field label="VoiceStudio address" hint="For example https://xxxx.trycloudflare.com (no trailing slash).">
            <input className={inputCls} value={voiceUrl} onChange={(e) => setVoiceUrl(e.target.value)} placeholder="https://..." />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {voice.data?.providers?.map((p) => (
            <Badge key={p.id} tone={!p.configured ? "neutral" : p.online === false ? "error" : "ok"}>
              {p.id === "voicestudio" ? "VoiceStudio" : "Edge"}: {!p.configured ? "no address" : p.online === false ? "not ready" : p.online ? "ready" : "free"}
            </Badge>
          ))}
          {voice.data && <Badge tone={voice.data.keySet ? "ok" : "neutral"}>server key: {voice.data.keySet ? "set" : "not set"}</Badge>}
          {voice.data?.server?.device && <span className="text-xs text-muted-foreground">{voice.data.server.device}, engine {voice.data.server.engine ?? "none loaded"}, {voice.data.server.voices.length} voice(s)</span>}
        </div>
        {voice.data?.providers?.filter((p) => p.id === "voicestudio" && p.detail && p.online !== true && p.configured).map((p) => (
          <p key={p.id} className="mt-2 text-xs text-muted-foreground">{p.detail}</p>
        ))}
        {voice.data && voice.data.active !== voice.data.provider && <p className="mt-2 text-xs text-muted-foreground">Videos use &quot;{voice.data.active}&quot; because TTS_PROVIDER is set in backend/.env.</p>}
        {voiceMsg && <p className="mt-2 text-sm text-muted-foreground">{voiceMsg}</p>}
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={runVoiceTest} disabled={voiceTesting}>{voiceTesting ? "Testing (the first call can take minutes)..." : "Test speech"}</Button>
            {voiceTesting && <span className="spinner" />}
          </div>
          {voiceResult && (
            <div className="mt-3" aria-live="polite">
              {voiceResult.ok ? (
                <p className="text-sm text-success">{voiceResult.note ?? `Spoke a test sentence (${voiceResult.seconds} s of audio) in ${(voiceResult.ms / 1000).toFixed(1)} s.`}</p>
              ) : (
                <ErrorNote error={voiceResult.error ?? "The test failed."} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Image model" right={<Button onClick={saveImages}>Save</Button>}>
        <ErrorNote error={images.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default provider">
            <select className={inputCls} value={imgDefault} onChange={(e) => setImgDefault(e.target.value)}>
              {(images.data?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}{p.configured ? "" : " (not configured)"}</option>
              ))}
            </select>
          </Field>
          <Field label="FLUX server URL">
            <input className={inputCls} value={fluxUrl} onChange={(e) => setFluxUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
          </Field>
          <Field label="FLUX model name">
            <input className={inputCls} value={fluxModel} onChange={(e) => setFluxModel(e.target.value)} />
          </Field>
          <Field label="Steps" hint="Fewer steps are faster; 4 suits the Klein models.">
            <input type="number" className={inputCls} value={fluxSteps} min={1} max={50} onChange={(e) => setFluxSteps(Number(e.target.value))} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {images.data?.providers?.map((p) => (
            <Badge key={p.id} tone={!p.configured ? "neutral" : p.online === false ? "error" : "ok"}>
              {p.label}: {!p.configured ? "not configured" : p.online === false ? "offline" : p.online ? "online" : "ready"}
            </Badge>
          ))}
          {images.data?.flux?.lastMs ? <span className="text-xs text-muted-foreground">last FLUX image {(images.data.flux.lastMs / 1000).toFixed(1)} s</span> : null}
        </div>
        {imgMsg && <p className="mt-2 text-sm text-muted-foreground">{imgMsg}</p>}
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={testImages} disabled={testing}>{testing ? "Testing (can take minutes on CPU)..." : "Test image model"}</Button>
            {testing && <span className="spinner" />}
          </div>
          {testResult && (
            <div className="mt-3" aria-live="polite">
              {testResult.ok ? (
                <>
                  <p className="text-sm text-success">Made one image with {testResult.provider} in {(testResult.ms / 1000).toFixed(1)} s.</p>
                  {testResult.imageBase64 && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={testResult.imageBase64.startsWith("data:") ? testResult.imageBase64 : `data:image/png;base64,${testResult.imageBase64}`}
                      alt="Test image"
                      className="mt-2 max-h-72 w-auto max-w-full rounded-lg border border-border"
                    />
                  )}
                </>
              ) : (
                <ErrorNote error={testResult.error ?? "The test failed."} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Connections">
        <div className="flex flex-wrap items-center gap-2">
          {overview.data && Object.entries<boolean>(overview.data.integrations).map(([k, v]) => <Badge key={k} tone={v ? "ok" : "neutral"}>{k}: {v ? "set" : "not set"}</Badge>)}
        </div>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <span>YouTube: {yt.data?.connected ? <Badge tone="ok">connected</Badge> : yt.data?.configured ? <Badge tone="warn">sign-in needed</Badge> : <Badge>add client id and secret to backend/.env</Badge>}</span>
          {yt.data?.configured && !yt.data?.connected && <Button onClick={connectYoutube}>Connect YouTube</Button>}
        </div>
      </Card>

      <Card title="Job queue" right={<Button variant="ghost" onClick={() => void jobs.reload()}>Refresh</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3">#</th><th className="pr-3">Type</th><th className="pr-3">Status</th><th className="pr-3">Tries</th><th>Error</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {jobs.data?.map((j) => (
                <tr key={j.id}>
                  <td className="py-1.5 pr-3">{j.id}</td>
                  <td className="pr-3">{j.type}</td>
                  <td className="pr-3"><Badge tone={j.status === "done" ? "ok" : j.status === "dead" || j.status === "failed" ? "error" : "neutral"}>{j.status}</Badge></td>
                  <td className="pr-3">{j.attempts}/{j.max_attempts}</td>
                  <td className="max-w-[260px] truncate text-xs text-muted-foreground" title={j.last_error ?? ""}>{j.last_error ?? ""}</td>
                  <td>{["failed", "dead"].includes(j.status) && <Button variant="ghost" onClick={async () => { await api("POST", `/api/system/jobs/${j.id}/retry`); await jobs.reload(); }}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
