// FFmpeg-only version of the overlay cards (drawbox + drawtext with enable='between(t,a,b)' and alpha fades), used when
// HyperFrames is unavailable or fails. Pure: the caller passes the font file (src/media/fonts.ts ensureFont) and runs ffmpeg.

import { assToCss, cardBox, cardTiming, endCardSlots, fontSizes, formatStat, planCards } from "./html";
import type { CardSpec, Fact } from "./html";
import type { EditPlan } from "../types";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Escapes text for a drawtext `text='...'` option inside a filter graph. */
export function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/[\r\n]+/g, " ");
}

/** Escapes a font path for `fontfile=`: forward slashes, drive colon escaped. */
export function escapeFontPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Linear fade-in over `enter`, hold, fade-out over `exit`, as an ffmpeg alpha expression (commas escaped for a filter graph). */
export function alphaExpr(a: number, b: number, enter: number, exit: number): string {
  const e = (s: string) => s.replace(/,/g, "\\,");
  return e(`if(lt(t,${a}),0,if(lt(t,${r3(a + enter)}),(t-${a})/${enter},if(lt(t,${r3(b - exit)}),1,if(lt(t,${b}),(${b}-t)/${exit},0))))`);
}

const hex = (css: string) => `0x${css.replace("#", "")}`;

function cardFilters(c: CardSpec, w: number, h: number, font: string, accent: string, captionBottomY?: number): string[] {
  const t = cardTiming(c);
  const a = r3(c.start);
  const b = r3(c.start + t.duration);
  const en = `enable='between(t,${a},${b})'`;
  const f = fontSizes(w, h);
  const box = cardBox(c.type, w, h, captionBottomY);
  const alpha = alphaExpr(a, b, t.enter, t.exit);
  const text = (txt: string, size: number, x: string, y: string, color = "white") =>
    `drawtext=fontfile='${font}':text='${escapeDrawtext(txt)}':fontsize=${size}:fontcolor=${color}:alpha='${alpha}':x=${x}:y=${y}:shadowcolor=black@0.6:shadowx=2:shadowy=2:${en}`;
  const out: string[] = [];
  if (c.type === "chapter") {
    out.push(`drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=black@0.30:t=fill:${en}`);
    out.push(`drawbox=x=${box.x}:y=${box.y + 4}:w=${Math.round(w * 0.12)}:h=${Math.max(4, Math.round(f.title * 0.07))}:color=${hex(accent)}@0.95:t=fill:${en}`);
    out.push(text(c.text, f.title, `${box.x}+${Math.round(f.small * 0.6)}`, `${box.y}+(${box.h}-text_h)/2`));
  } else if (c.type === "stat") {
    const val = c.stat ? formatStat(c.stat) : c.text;
    out.push(text(val, f.stat, `${box.x}+(${box.w}-text_w)/2`, `${box.y}+${Math.round(box.h * 0.12)}`, hex(accent)));
    out.push(text(c.type === "stat" ? c.text : "", f.small, `${box.x}+(${box.w}-text_w)/2`, `${box.y}+${Math.round(box.h * 0.12 + f.stat * 1.15)}`));
  } else if (c.type === "lower_third") {
    out.push(`drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=0x0C0E14@0.78:t=fill:${en}`);
    out.push(`drawbox=x=${box.x}:y=${box.y}:w=${Math.max(6, Math.round(f.small * 0.2))}:h=${box.h}:color=${hex(accent)}@1:t=fill:${en}`);
    out.push(text("SOURCE", f.label, `${box.x}+${Math.round(f.small * 0.9)}`, `${box.y}+${Math.round(box.h * 0.18)}`, hex(accent)));
    out.push(text(c.text, f.small, `${box.x}+${Math.round(f.small * 0.9)}`, `${box.y}+${Math.round(box.h * 0.18 + f.label * 1.5)}`));
  } else {
    out.push(`drawbox=x=0:y=0:w=${w}:h=${h}:color=0x05060A@0.62:t=fill:${en}`);
    out.push(text(c.text, f.title, `(w-text_w)/2`, `${Math.round(h * 0.12)}`));
    for (const s of endCardSlots(w, h)) out.push(`drawbox=x=${s.x}:y=${s.y}:w=${s.w}:h=${s.h}:color=white@0.28:t=3:${en}`);
  }
  return out.filter((x) => !x.includes("text=''"));
}

/**
 * Filter fragment (comma-joined, no pad labels) that draws every chapter, stat, lower-third and end card of the plan on the
 * incoming video. Returns "" when the plan has no cards. Use as `[v]<fragment>[vo]`.
 */
export function buildDrawtextOverlayFilters(
  plan: EditPlan,
  width: number,
  height: number,
  fontFile: string,
  facts?: Fact[],
  totalSeconds: number = plan.totalSeconds,
): string {
  const { cards } = planCards(plan, width, height, totalSeconds, facts);
  if (!cards.length) return "";
  const font = escapeFontPath(fontFile);
  const accent = assToCss(plan.style.accent);
  return cards.flatMap((c) => cardFilters(c, width, height, font, accent, plan.captionBottomY)).join(",");
}
