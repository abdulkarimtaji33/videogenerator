// Pure generators for the HyperFrames overlay pass (Editing-Quality-Plan 1.4, Phase 6): card planning, timings, safe boxes and the
// composition HTML/GSAP for each card type. Nothing here touches the disk or a browser, so it is unit-testable.
// Research: §05 titles and lower thirds, §06 kinetic type, §16 callouts, §17 counters, §21 end card; HyperFrames overlays.md.

import { CAPTION_BOTTOM_MAX_Y, END_CARD_S, END_CLEAN_S, SAFE_BOX, textHold } from "../rules";
import type { EditPlan, EditStyle } from "../types";

export type CardType = "chapter" | "stat" | "lower_third" | "end";

export interface StatValue {
  prefix: string;
  num: number;
  suffix: string;
  decimals: number;
  grouped: boolean;
}

export interface CardSpec {
  id: string;
  type: CardType;
  start: number; // seconds on the final timeline
  duration: number;
  text: string; // chapter title / stat label / citation / end headline
  stat?: StatValue;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Fact {
  text: string;
  value?: string;
}

export const ENTER_S = 0.45; // entrance 0.35-0.6 s (§05, overlays.md), expo.out with blur
export const EXIT_FACTOR = 0.55; // exit 40-50% faster than the entrance (§05)
export const EXIT_S = Math.round(ENTER_S * EXIT_FACTOR * 1000) / 1000;
export const COUNT_S = 1.0; // ease-out count-up length (§17)
export const BLUR_PX = 8;
export const CAPTION_ZONE_H = 0.14; // caption block height as a share of the frame height
export const MIN_CARD_GAP_S = 0.2;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// ------------------------------------------------------------------ zones

export const isPortrait = (w: number, h: number) => h > w;

/** The 80% title-safe box (§05). */
export function safeBox(w: number, h: number): Box {
  const m = (1 - SAFE_BOX) / 2;
  return { x: r3(w * m), y: r3(h * m), w: r3(w * SAFE_BOX), h: r3(h * SAFE_BOX) };
}

/** Where the captions live: portrait bottom edge at plan.captionBottomY (<= 1248 on 1920), landscape at 90% height. */
export function captionZone(w: number, h: number, captionBottomY?: number): { top: number; bottom: number } {
  const bottom = isPortrait(w, h) ? Math.min(captionBottomY ?? CAPTION_BOTTOM_MAX_Y, CAPTION_BOTTOM_MAX_Y) * (h / 1920) : h * 0.9;
  return { top: r3(bottom - h * CAPTION_ZONE_H), bottom: r3(bottom) };
}

/** Box a card occupies. Every box lies in the safe box and never overlaps the caption zone. */
export function cardBox(type: CardType, w: number, h: number, captionBottomY?: number): Box {
  const s = safeBox(w, h);
  const cz = captionZone(w, h, captionBottomY);
  const p = isPortrait(w, h);
  let y: number;
  let bh: number;
  if (type === "end") return s;
  if (type === "chapter") {
    y = p ? 0.1 * h : 0.36 * h;
    bh = p ? 0.14 * h : 0.2 * h;
  } else if (type === "stat") {
    y = p ? 0.2 * h : 0.32 * h;
    bh = p ? 0.18 * h : 0.3 * h;
  } else {
    // lower third: portrait sits just above the captions (below them is the platform UI zone, y > ~1300 on 1920);
    // landscape sits above the caption band in the bottom 30% zone
    bh = (p ? 0.1 : 0.14) * h;
    y = p ? cz.top - 0.02 * h - bh : 0.62 * h;
  }
  y = Math.max(y, s.y);
  if (y + bh > s.y + s.h) bh = s.y + s.h - y;
  return { x: s.x, y: r3(y), w: s.w, h: r3(bh) };
}

/** Font size in px: landscape base from the short side, portrait x1.3 (titles x1.35, stats x1.4) per overlays.md. */
export function fontSizes(w: number, h: number): { title: number; stat: number; small: number; label: number } {
  const short = Math.min(w, h);
  const p = isPortrait(w, h);
  return {
    title: Math.round(short * 0.065 * (p ? 1.35 : 1)),
    stat: Math.round(short * 0.14 * (p ? 1.4 : 1)),
    small: Math.round(short * 0.036 * (p ? 1.3 : 1)),
    label: Math.round(short * 0.026 * (p ? 1.3 : 1)),
  };
}

// ------------------------------------------------------------------ stats from facts

const NUM_RE = /([$€£]?)(\d[\d,]*(?:\.\d+)?)(\s?(?:%|[KMBkmb]\b|[A-Za-z]{1,3}\b)?)/;

export function parseStat(text: string): { stat: StatValue; label: string } | null {
  const m = NUM_RE.exec(text);
  if (!m) return null;
  const raw = m[2];
  const num = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const label = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { stat: { prefix: m[1], num, suffix: m[3], decimals: (raw.split(".")[1] ?? "").length, grouped: raw.includes(",") }, label };
}

const numbersIn = (s: string): number[] => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);

/** A stat card is allowed only when its number appears in the supplied facts (never invented). */
export function matchFact(text: string, facts: Fact[] | undefined): { stat: StatValue; label: string; fact: Fact } | null {
  const parsed = parseStat(text);
  if (!parsed || !facts?.length) return null;
  for (const f of facts) {
    const nums = [...numbersIn(f.value ?? ""), ...numbersIn(f.text)];
    if (nums.includes(parsed.stat.num)) return { ...parsed, label: parsed.label || f.text, fact: f };
  }
  return null;
}

export function formatStat(s: StatValue, v: number = s.num): string {
  const body = v.toLocaleString("en-US", { minimumFractionDigits: s.decimals, maximumFractionDigits: s.decimals, useGrouping: s.grouped });
  return `${s.prefix}${body}${s.suffix}`;
}

// ------------------------------------------------------------------ timing

export interface CardTiming {
  enter: number;
  /** Time the card is fully landed (a stat lands when its count ends). */
  landAt: number;
  hold: number;
  exit: number;
  exitStart: number;
  duration: number;
  minDuration: number;
}

/** Entrance, landed hold (0.5 s + 0.3 s/word) and an exit 45% faster than the entrance. Landed text is dead still. */
export function cardTiming(spec: Pick<CardSpec, "type" | "text" | "duration" | "stat">): CardTiming {
  const enter = ENTER_S;
  const landAt = spec.type === "stat" ? Math.max(enter, COUNT_S) : enter;
  const words = wordCount(spec.text) + (spec.type === "stat" ? 1 : 0);
  const hold = spec.type === "end" ? 2 : textHold(words); // §21 last line holds >= 2 s
  const exit = spec.type === "end" ? END_CLEAN_S : EXIT_S;
  const minDuration = r3(landAt + hold + exit);
  const duration = r3(Math.max(spec.duration, minDuration));
  return { enter, landAt, hold, exit, exitStart: r3(duration - exit), duration, minDuration };
}

// ------------------------------------------------------------------ planning

/** Turns plan.beats[].card and plan.endCard into timed cards; drops anything unsafe and says why. */
export function planCards(
  plan: EditPlan,
  w: number,
  h: number,
  totalSeconds: number,
  facts?: Fact[],
): { cards: CardSpec[]; warnings: string[] } {
  const warnings: string[] = [];
  const cards: CardSpec[] = [];
  const tail = totalSeconds - END_CLEAN_S;
  let n = 0;
  const push = (type: CardType, text: string, at: number, seconds: number, stat?: StatValue) => {
    const spec: CardSpec = { id: `${type}-${++n}`, type, start: r3(Math.max(0, at)), duration: seconds, text, stat };
    const t = cardTiming(spec);
    spec.duration = t.duration;
    const limit = type === "end" ? totalSeconds : tail;
    if (spec.start + spec.duration > limit + 1e-6) {
      spec.duration = r3(limit - spec.start);
      if (spec.duration < t.minDuration) {
        warnings.push(`${type} card "${text}" at ${spec.start}s dropped: needs ${t.minDuration}s but only ${Math.max(0, spec.duration)}s left`);
        return;
      }
    }
    cards.push(spec);
  };

  for (const b of plan.beats) {
    const c = b.card;
    if (!c || c.type === "end") continue;
    if (c.type === "chapter") {
      if (plan.format !== "long") {
        warnings.push(`chapter card "${c.text}" skipped: chapter cards are long-form only`);
        continue;
      }
      push("chapter", c.text, c.at, c.seconds);
    } else if (c.type === "stat") {
      const m = matchFact(c.text, facts);
      if (!m) {
        warnings.push(`stat card "${c.text}" dropped: number not present in the supplied facts`);
        continue;
      }
      push("stat", m.label, c.at, c.seconds, m.stat);
    } else if (c.type === "lower_third") {
      push("lower_third", c.text, c.at, c.seconds);
    }
  }

  if (plan.format === "long" && plan.endCard) {
    const secs = Math.min(Math.max(plan.endCard.seconds, END_CARD_S[0]), END_CARD_S[1], totalSeconds);
    push("end", plan.endCard.text, totalSeconds - secs, secs);
  }

  // one card of a kind at a time, and never two overlay cards on top of each other
  cards.sort((a, b) => a.start - b.start);
  const out: CardSpec[] = [];
  for (const c of cards) {
    const clash = out.find((o) => o.start + o.duration + MIN_CARD_GAP_S > c.start); // one card on screen at a time (§05: one card per 6-8 s)
    if (clash) {
      warnings.push(`${c.type} card "${c.text}" at ${c.start}s dropped: overlaps ${clash.type} card at ${clash.start}s`);
      continue;
    }
    out.push(c);
  }
  return { cards: out, warnings };
}

// ------------------------------------------------------------------ HTML

/** ASS "&HAABBGGRR&" to "#RRGGBB". */
export function assToCss(ass: string, fallback = "#FFD700"): string {
  const m = /&H([0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})&?/i.exec(ass ?? "");
  return m ? `#${m[4]}${m[3]}${m[2]}`.toUpperCase() : fallback;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = `"Inter", "Montserrat", sans-serif`;

function endSlots(w: number, h: number): Box[] {
  const s = safeBox(w, h);
  if (isPortrait(w, h)) {
    const sw = s.w;
    const sh = (sw * 9) / 16;
    const d = s.w * 0.4;
    return [
      { x: s.x, y: r3(h * 0.4), w: r3(sw), h: r3(sh) },
      { x: r3(s.x + (s.w - d) / 2), y: r3(h * 0.4 + sh + h * 0.03), w: r3(d), h: r3(d) },
    ];
  }
  const vw = s.w * 0.52;
  const d = s.w * 0.26;
  return [
    { x: s.x, y: r3(h * 0.4), w: r3(vw), h: r3((vw * 9) / 16) },
    { x: r3(s.x + s.w - d), y: r3(h * 0.4 + ((vw * 9) / 16 - d) / 2), w: r3(d), h: r3(d) },
  ];
}

export function endCardSlots(w: number, h: number): Box[] {
  return endSlots(w, h);
}

const px = (n: number) => `${Math.round(n)}px`;

/** The scene file (inside <template>) for one card. Host id, root composition id and timeline key are all `spec.id`. */
export function cardCompositionHtml(spec: CardSpec, w: number, h: number, style: Pick<EditStyle, "accent">, captionBottomY?: number): string {
  const t = cardTiming(spec);
  const f = fontSizes(w, h);
  const box = cardBox(spec.type, w, h, captionBottomY);
  const accent = assToCss(style.accent);
  const id = spec.id;
  const text = escapeHtml(spec.text);
  const enterFrom = `{ opacity: 0, y: 24, filter: "blur(${BLUR_PX}px)" }`;
  const enterTo = (d: number) => `{ opacity: 1, y: 0, filter: "blur(0px)", duration: ${d}, ease: "expo.out" }`;
  const exitTo = (d: number) => `{ opacity: 0, filter: "blur(${BLUR_PX}px)", duration: ${d}, ease: "power2.in" }`;
  let body = "";
  let script = "";

  if (spec.type === "chapter") {
    body = `<div id="${id}-card" class="clip card" data-start="0" data-duration="${t.duration}">
      <div id="${id}-rule" class="rule"></div>
      <h1 id="${id}-text" class="title">${text}</h1>
    </div>`;
    script = `tl.fromTo("#${id}-rule", { scaleX: 0 }, { scaleX: 1, duration: ${t.enter}, ease: "expo.out" }, 0);
    tl.fromTo("#${id}-text", ${enterFrom}, ${enterTo(t.enter)}, 0.08);
    tl.to("#${id}-text", ${exitTo(t.exit)}, ${t.exitStart});
    tl.to("#${id}-rule", { opacity: 0, duration: ${t.exit}, ease: "power2.in" }, ${t.exitStart});`;
  } else if (spec.type === "stat") {
    const s = spec.stat as StatValue;
    body = `<div id="${id}-card" class="clip card" data-start="0" data-duration="${t.duration}">
      <div id="${id}-value" class="stat">${escapeHtml(formatStat(s, 0))}</div>
      <div id="${id}-label" class="label">${text}</div>
    </div>`;
    script = `const counter = { v: 0 };
    tl.fromTo("#${id}-value", ${enterFrom}, ${enterTo(t.enter)}, 0);
    tl.fromTo("#${id}-label", ${enterFrom}, ${enterTo(t.enter)}, 0.1);
    tl.to(counter, { v: ${s.num}, duration: ${COUNT_S}, ease: "power3.out", onUpdate: () => { document.getElementById("${id}-value").textContent = fmt(counter.v); } }, 0);
    tl.to(["#${id}-value", "#${id}-label"], ${exitTo(t.exit)}, ${t.exitStart});`;
    script =
      `const fmt = (v) => ${JSON.stringify(s.prefix)} + v.toLocaleString("en-US", { minimumFractionDigits: ${s.decimals}, maximumFractionDigits: ${s.decimals}, useGrouping: ${s.grouped} }) + ${JSON.stringify(s.suffix)};\n    ` +
      script;
  } else if (spec.type === "lower_third") {
    body = `<div id="${id}-card" class="clip card" data-start="0" data-duration="${t.duration}">
      <div id="${id}-bar" class="bar"></div>
      <div class="lt-text"><div id="${id}-tag" class="tag">SOURCE</div><div id="${id}-text" class="cite">${text}</div></div>
    </div>`;
    script = `tl.fromTo("#${id}-bar", { scaleX: 0 }, { scaleX: 1, duration: ${t.enter}, ease: "expo.out" }, 0);
    tl.fromTo(["#${id}-tag", "#${id}-text"], ${enterFrom}, ${enterTo(t.enter)}, 0.1);
    tl.to(["#${id}-tag", "#${id}-text"], ${exitTo(t.exit)}, ${t.exitStart});
    tl.to("#${id}-bar", { scaleX: 0, transformOrigin: "right center", duration: ${t.exit}, ease: "power2.in" }, ${t.exitStart});`;
  } else {
    const [vs, cs] = endSlots(w, h);
    const slot = (b: Box, round: boolean, sid: string) =>
      `<div id="${id}-${sid}" class="slot${round ? " round" : ""}" style="left:${px(b.x - box.x)};top:${px(b.y - box.y)};width:${px(b.w)};height:${px(b.h)}"></div>`;
    body = `<div id="${id}-card" class="clip card" data-start="0" data-duration="${t.duration}">
      <div id="${id}-scrim" class="scrim"></div>
      <h1 id="${id}-text" class="title end-title">${text}</h1>
      ${slot(vs, false, "slot-video")}
      ${slot(cs, true, "slot-channel")}
    </div>`;
    script = `tl.fromTo("#${id}-scrim", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 0);
    tl.fromTo("#${id}-text", ${enterFrom}, ${enterTo(t.enter)}, 0.15);
    tl.fromTo(["#${id}-slot-video", "#${id}-slot-channel"], { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 0.5);
    tl.to("#${id}-card", { opacity: 0, duration: ${t.exit}, ease: "power2.in" }, ${t.exitStart});`;
  }

  const cardCss: Record<CardType, string> = {
    chapter: `.card { position: absolute; left: ${px(box.x)}; top: ${px(box.y)}; width: ${px(box.w)}; height: ${px(box.h)}; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: ${px(f.small * 0.4)}; padding: ${px(f.small * 0.6)}; background: linear-gradient(90deg, rgba(0,0,0,.38), rgba(0,0,0,0)); }
    .rule { width: ${px(w * 0.12)}; height: ${px(Math.max(4, f.title * 0.07))}; background: ${accent}; transform-origin: left center; }
    .title { font-size: ${px(f.title)}; line-height: 1.08; font-weight: 900; letter-spacing: -0.02em; color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,.55); }`,
    stat: `.card { position: absolute; left: ${px(box.x)}; top: ${px(box.y)}; width: ${px(box.w)}; height: ${px(box.h)}; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: ${px(f.small * 0.3)}; background: radial-gradient(closest-side, rgba(0,0,0,.4), rgba(0,0,0,0)); }
    .stat { font-size: ${px(f.stat)}; line-height: 1; font-weight: 900; color: ${accent}; font-variant-numeric: tabular-nums; text-shadow: 0 2px 24px rgba(0,0,0,.6); }
    .label { max-width: 62%; font-size: ${px(f.small)}; font-weight: 700; color: #fff; text-align: center; text-shadow: 0 2px 14px rgba(0,0,0,.6); }`,
    lower_third: `.card { position: absolute; left: ${px(box.x)}; top: ${px(box.y)}; width: ${px(box.w)}; height: ${px(box.h)}; display: flex; align-items: center; }
    .bar { position: absolute; inset: 0; background: rgba(12,14,20,.78); border-left: ${px(Math.max(6, f.small * 0.2))} solid ${accent}; border-radius: 6px; transform-origin: left center; }
    .lt-text { position: relative; padding: 0 ${px(f.small * 0.7)}; display: flex; flex-direction: column; gap: ${px(f.label * 0.3)}; }
    .tag { font-size: ${px(f.label)}; font-weight: 700; letter-spacing: .12em; color: ${accent}; }
    .cite { font-size: ${px(f.small)}; font-weight: 700; color: #fff; line-height: 1.15; }`,
    end: `.card { position: absolute; left: ${px(box.x)}; top: ${px(box.y)}; width: ${px(box.w)}; height: ${px(box.h)}; }
    .scrim { position: absolute; inset: ${px(-Math.max(box.x, box.y))}; background: rgba(5,6,10,.62); }
    .end-title { position: absolute; left: 0; right: 0; top: ${px(h * 0.12)}; text-align: center; font-size: ${px(f.title)}; line-height: 1.1; font-weight: 900; color: #fff; }
    .slot { position: absolute; border: 3px solid rgba(255,255,255,.28); border-radius: 14px; background: rgba(255,255,255,.04); }
    .slot.round { border-radius: 50%; }`,
  };

  return `<template>
  <style>
    #root { position: absolute; inset: 0; background: transparent; font-family: ${FONT}; }
    .card { opacity: 1; }
    ${cardCss[spec.type]}
  </style>
  <div id="root" data-composition-id="${id}" data-width="${w}" data-height="${h}">
    ${body}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${script}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

/** index.html: a transparent root that mounts one scene per card (one scene per file keeps `check` under the track-density limit). */
export function rootHtml(cards: CardSpec[], w: number, h: number, totalSeconds: number, fps = 30): string {
  const hosts = cards
    .map(
      (c, i) =>
        `      <div id="${c.id}" data-composition-id="${c.id}" data-composition-src="compositions/${c.id}.html" data-start="${c.start}" data-duration="${c.duration}" data-track-index="${1 + (i % 2)}" data-track-kind="graphics" data-width="${w}" data-height="${h}"></div>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: transparent; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${r3(totalSeconds)}" data-width="${w}" data-height="${h}" data-fps="${fps}">
${hosts}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}
