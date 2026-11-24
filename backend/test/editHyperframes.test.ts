import { describe, expect, it } from "vitest";
import {
  ENTER_S,
  EXIT_S,
  cardBox,
  cardCompositionHtml,
  cardTiming,
  captionZone,
  matchFact,
  planCards,
  rootHtml,
  safeBox,
  assToCss,
} from "../src/edit/hyperframes/html";
import { alphaExpr, buildDrawtextOverlayFilters, escapeDrawtext } from "../src/edit/hyperframes/fallbackCards";
import { checkErrorCount } from "../src/edit/hyperframes/overlays";
import { textHold } from "../src/edit/rules";
import type { EditBeat, EditPlan, EditStyle } from "../src/edit/types";

const style: EditStyle = { id: "default", label: "d", grade: { contrast: 1, saturation: 1, gamma: 1, warmth: 0 }, vignette: 0.1, grain: 2, accent: "&H0000D7FF&", musicMood: "wonder", musicGainDb: -18, duckDb: 8 };

function beat(i: number, start: number, card?: EditBeat["card"]): EditBeat {
  return { shotId: `shot-${i}`, index: i, start, end: start + 8, role: "body", layout: "full", punch: 1, transitionIn: "cut", transitionSeconds: 0, sfx: [], card, narrationOffset: 0 };
}

function plan(format: "short" | "long", beats: EditBeat[], endCard: EditPlan["endCard"], total: number): EditPlan {
  return { version: 1, style, format, totalSeconds: total, beats, music: null, loop: false, endCard, chapters: [], transitionKinds: [], captionBottomY: 1248 };
}

const facts = [{ text: "Saturn is 95 times Earth mass", value: "95" }, { text: "Revenue hit 1,200 units" }];

const longPlan = plan(
  "long",
  [
    beat(1, 0),
    beat(2, 8, { type: "chapter", text: "How density works", at: 8.2, seconds: 2.5 }),
    beat(3, 16, { type: "stat", text: "95", at: 16.4, seconds: 2.5 }),
    beat(4, 24, { type: "stat", text: "777", at: 24.4, seconds: 2.5 }), // not in facts
    beat(5, 32, { type: "lower_third", text: "NASA Planetary Fact Sheet", at: 33, seconds: 3 }),
  ],
  { seconds: 12, text: "Watch the next video" },
  90,
);

describe("hyperframes card planning", () => {
  it("builds chapter, stat, lower-third and end cards at the plan times", () => {
    const { cards } = planCards(longPlan, 1920, 1080, 90, facts);
    expect(cards.map((c) => c.type)).toEqual(["chapter", "stat", "lower_third", "end"]);
    expect(cards[0].start).toBeCloseTo(8.2);
    expect(cards[1].start).toBeCloseTo(16.4);
    expect(cards[2].start).toBeCloseTo(33);
  });

  it("creates a counter only for numbers present in the facts", () => {
    const { cards, warnings } = planCards(longPlan, 1920, 1080, 90, facts);
    const stats = cards.filter((c) => c.type === "stat");
    expect(stats).toHaveLength(1);
    expect(stats[0].stat?.num).toBe(95);
    expect(warnings.some((w) => w.includes("777"))).toBe(true);
    expect(planCards(longPlan, 1920, 1080, 90, undefined).cards.some((c) => c.type === "stat")).toBe(false);
    expect(matchFact("1,200", facts)?.stat.num).toBe(1200);
    expect(matchFact("42", facts)).toBeNull();
  });

  it("counts up from a zero baseline with an ease-out and then stays still", () => {
    const { cards } = planCards(longPlan, 1920, 1080, 90, facts);
    const stat = cards.find((c) => c.type === "stat")!;
    const html = cardCompositionHtml(stat, 1920, 1080, style);
    expect(html).toContain("const counter = { v: 0 }");
    expect(html).toContain("v: 95");
    expect(html).toContain('ease: "power3.out"');
    expect(html).toMatch(/id="stat-\d+-value"[^>]*>0</);
  });

  it("skips chapter cards on a Short and the end card too", () => {
    const p = plan("short", [beat(1, 0, { type: "chapter", text: "Part 2", at: 2, seconds: 2.5 })], { seconds: 12, text: "x" }, 40);
    const { cards, warnings } = planCards(p, 1080, 1920, 40, facts);
    expect(cards).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("holds each card 0.5 s + 0.3 s per word, with entrance 0.35-0.6 s and an exit 40-50% faster", () => {
    expect(ENTER_S).toBeGreaterThanOrEqual(0.35);
    expect(ENTER_S).toBeLessThanOrEqual(0.6);
    const faster = 1 - EXIT_S / ENTER_S;
    expect(faster).toBeGreaterThanOrEqual(0.4);
    expect(faster).toBeLessThanOrEqual(0.5);
    const t = cardTiming({ type: "chapter", text: "one two three four five six seven eight", duration: 1 });
    expect(t.hold).toBeCloseTo(textHold(8));
    expect(t.duration).toBeCloseTo(ENTER_S + textHold(8) + EXIT_S, 2);
    const long = cardTiming({ type: "chapter", text: "Intro", duration: 4 });
    expect(long.duration).toBe(4);
    expect(long.exitStart).toBeCloseTo(4 - EXIT_S, 3);
  });

  it("makes the end card 10-15 s with two empty slots and a clean last frame", () => {
    const { cards } = planCards(longPlan, 1920, 1080, 90, facts);
    const end = cards.find((c) => c.type === "end")!;
    expect(end.duration).toBeGreaterThanOrEqual(10);
    expect(end.duration).toBeLessThanOrEqual(15);
    expect(end.start + end.duration).toBeCloseTo(90);
    const html = cardCompositionHtml(end, 1920, 1080, style);
    expect(html.match(/class="slot/g)).toHaveLength(2);
    expect(html).not.toMatch(/class="slot[^"]*"[^>]*>[^<]+</); // slots hold no content
  });

  it("never lets a non-end card run into the last 0.3 s", () => {
    const p = plan("long", [beat(1, 0, { type: "lower_third", text: "Source A", at: 39.5, seconds: 3 })], null, 40);
    const { cards } = planCards(p, 1920, 1080, 40, facts);
    expect(cards).toHaveLength(0);
  });

  it("shows one card at a time", () => {
    const p = plan("long", [beat(1, 0, { type: "chapter", text: "A", at: 5, seconds: 2.5 }), beat(2, 4, { type: "chapter", text: "B", at: 6, seconds: 2.5 })], null, 60);
    expect(planCards(p, 1920, 1080, 60).cards).toHaveLength(1);
  });
});

describe("hyperframes boxes and caption zone", () => {
  it.each([
    [1080, 1920],
    [1920, 1080],
  ])("keeps every card inside the 80%% safe box and out of the caption zone (%ix%i)", (w, h) => {
    const s = safeBox(w, h);
    expect(s.w).toBeCloseTo(w * 0.8);
    expect(s.h).toBeCloseTo(h * 0.8);
    const cz = captionZone(w, h, 1248);
    for (const type of ["chapter", "stat", "lower_third"] as const) {
      const b = cardBox(type, w, h, 1248);
      expect(b.x).toBeGreaterThanOrEqual(s.x - 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(s.y - 1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(s.x + s.w + 1e-6);
      expect(b.y + b.h).toBeLessThanOrEqual(s.y + s.h + 1e-6);
      const overlapsCaptions = b.y < cz.bottom && b.y + b.h > cz.top;
      expect(overlapsCaptions).toBe(false);
    }
  });

  it("puts the portrait caption bottom at y <= 1248 and the lower third above the captions, clear of the platform UI zone", () => {
    const cz = captionZone(1080, 1920, 5000);
    expect(cz.bottom).toBeLessThanOrEqual(1248);
    const lt = cardBox("lower_third", 1080, 1920, 1248);
    expect(lt.y + lt.h).toBeLessThanOrEqual(cz.top);
  });

  it("scales portrait type by x1.3 or more relative to landscape", () => {
    const land = cardCompositionHtml({ id: "chapter-1", type: "chapter", start: 1, duration: 3, text: "Hello" }, 1920, 1080, style);
    const port = cardCompositionHtml({ id: "chapter-1", type: "chapter", start: 1, duration: 3, text: "Hello" }, 1080, 1920, style);
    const size = (h: string) => Number(/\.title \{ font-size: (\d+)px/.exec(h)![1]);
    expect(size(port) / size(land)).toBeGreaterThanOrEqual(1.3);
  });
});

describe("hyperframes composition html", () => {
  const spec = { id: "chapter-1", type: "chapter" as const, start: 2, duration: 3, text: "How density works" };

  it("uses expo.out blur entrances, an accelerated exit and no tweens while landed", () => {
    const html = cardCompositionHtml(spec, 1920, 1080, style);
    expect(html).toContain('ease: "expo.out"');
    expect(html).toContain("blur(8px)");
    expect(html).toContain("window.__timelines[\"chapter-1\"]");
    expect(html.startsWith("<template>")).toBe(true);
    const t = cardTiming(spec);
    const times = [...html.matchAll(/, (\d+(?:\.\d+)?)\);\n/g)].map((m) => Number(m[1]));
    // every tween starts either during the entrance or at the exit, never between
    for (const at of times) expect(at <= t.enter || Math.abs(at - t.exitStart) < 1e-6).toBe(true);
    expect(html).not.toMatch(/Date\.now|Math\.random|repeat:\s*-1/);
  });

  it("uses the style accent colour and a transparent root", () => {
    expect(assToCss("&H0000D7FF&")).toBe("#FFD700");
    const html = cardCompositionHtml({ ...spec, type: "lower_third", text: "NASA" }, 1920, 1080, style);
    expect(html).toContain("#FFD700");
    expect(html).toContain("background: transparent");
  });

  it("builds a transparent root with one scene host per card", () => {
    const { cards } = planCards(longPlan, 1920, 1080, 90, facts);
    const html = rootHtml(cards, 1920, 1080, 90, 30);
    expect(html.match(/data-composition-src=/g)).toHaveLength(cards.length);
    expect(html).toContain('data-duration="90"');
    expect(html).toContain("background: transparent");
  });

  it("escapes card text", () => {
    const html = cardCompositionHtml({ ...spec, text: '<b>"x"</b>' }, 1920, 1080, style);
    expect(html).not.toContain("<b>");
  });

  it("reads the error count from check output", () => {
    expect(checkErrorCount('{"ok":true,"errorCount":0}')).toBe(0);
    expect(checkErrorCount('log\n{"errorCount":2}')).toBe(2);
    expect(checkErrorCount('{"errors":[{"a":1}]}')).toBe(1);
  });
});

describe("drawtext fallback", () => {
  const font = "C:\\Windows\\Fonts\\arialbd.ttf";

  it("returns an empty fragment without cards", () => {
    expect(buildDrawtextOverlayFilters(plan("long", [beat(1, 0)], null, 30), 1920, 1080, font, facts)).toBe("");
  });

  it("emits drawtext/drawbox with enable windows and alpha fades at the card times", () => {
    const f = buildDrawtextOverlayFilters(longPlan, 1920, 1080, font, facts);
    expect(f).toContain("drawtext=");
    expect(f).toContain("drawbox=");
    expect(f).toContain("enable='between(t,8.2,");
    expect(f).toContain("enable='between(t,33,");
    expect(f).toContain("alpha='");
    expect(f).toContain("fontfile='C\\:/Windows/Fonts/arialbd.ttf'");
    expect(f).toContain("How density works");
    expect(f).toContain("95");
    expect(f).not.toContain("777");
    expect(f).toContain("SOURCE");
    expect(f).toContain("Watch the next video");
  });

  it("matches the HyperFrames timings", () => {
    const { cards } = planCards(longPlan, 1920, 1080, 90, facts);
    const c = cards[0];
    const t = cardTiming(c);
    const f = buildDrawtextOverlayFilters(longPlan, 1920, 1080, font, facts);
    expect(f).toContain(`between(t,${c.start},${Math.round((c.start + t.duration) * 1000) / 1000})`);
  });

  it("escapes drawtext specials and builds a fade expression", () => {
    expect(escapeDrawtext("a:b, 50%")).toBe("a\\:b\\, 50\\%");
    const a = alphaExpr(2, 5, 0.45, 0.25);
    expect(a).toContain("(t-2)/0.45");
    expect(a).toContain("(5-t)/0.25");
  });

  it("keeps portrait lower thirds out of the caption zone", () => {
    const p = plan("long", [beat(1, 0, { type: "lower_third", text: "NASA", at: 5, seconds: 3 })], null, 60);
    const f = buildDrawtextOverlayFilters(p, 1080, 1920, font, facts);
    const y = Number(/drawbox=x=\d+:y=(\d+(?:\.\d+)?):/.exec(f)![1]);
    expect(y + cardBox("lower_third", 1080, 1920, 1248).h).toBeLessThanOrEqual(captionZone(1080, 1920, 1248).top + 1e-6);
  });
});
