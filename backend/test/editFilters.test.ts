import { describe, expect, it } from "vitest";
import {
  buildVideoGraph,
  computeTimeline,
  dropoutWindows,
  editMixGraph,
  finishVideoGraph,
  loudnormFilter,
  needsVideoGraph,
  punchFilter,
  resolveNarration,
  shiftWords,
  sfxVolumeDb,
  timelineGraph,
  voiceChain,
  xfadeName,
} from "../src/edit/filters";
import { editQaChecks } from "../src/shorts/qa";
import { DEFAULT_STYLE } from "../src/edit/styles";
import { buildAss } from "../src/shorts/captions";
import { makeShort, words } from "./editFixture";

const seam = (k: string, s = 0.3) => ({ transitionIn: k as never, transitionSeconds: k === "cut" ? 0 : s });

describe("timeline and xfade offsets", () => {
  it("each transition shortens the film and offsets equal the incoming start", () => {
    const beats = [seam("cut"), seam("cut"), seam("fade"), seam("cut"), seam("zoomin")].map((s, i) => ({ ...s, punch: 1, shotId: `s${i}` })) as never[];
    const tl = computeTimeline([8, 8, 8, 8, 8], beats);
    expect(tl.starts).toEqual([0, 8, 15.7, 23.7, 31.4]);
    expect(tl.total).toBeCloseTo(39.4);
    const g = buildVideoGraph(beats, [8, 8, 8, 8, 8], 1080, 1920);
    expect(g.transitions).toBe(2);
    expect(g.graph).toContain("[c0][c1]concat=n=2");
    expect(g.graph).toContain("xfade=transition=fade:duration=0.3:offset=15.7");
    expect(g.graph).toContain("xfade=transition=zoomin:duration=0.3:offset=31.4");
    expect(g.graph).toContain("[vout]");
    expect(g.total).toBeCloseTo(39.4);
  });
  it("hard cuts only need no graph when there are no punches", () => {
    const flat = [seam("cut"), seam("cut")].map((s) => ({ ...s, punch: 1 })) as never[];
    expect(needsVideoGraph(flat)).toBe(false);
    expect(needsVideoGraph([seam("cut"), { ...seam("cut"), punch: 1.12 }] as never[])).toBe(true);
    expect(xfadeName("dip")).toBe("fadewhite");
  });
});

describe("word timing shift", () => {
  it("narration follows the beat start, J-cuts lead and overlaps are pushed", () => {
    const starts = [0, 7.7, 15.4];
    const place = resolveNarration(starts, [0, -0.3, 0], [6, 6, 6], 0.25);
    expect(place[0]!.startSec).toBeCloseTo(0.25);
    // second narration wants 7.65 and the first ends at 6.25: no push
    expect(place[1]!.startSec).toBeCloseTo(7.65);
    const pushed = resolveNarration([0, 4], [0, 0], [6, 3], 0.25);
    expect(pushed[1]!.startSec).toBeGreaterThanOrEqual(pushed[0]!.endSec);
    const w = shiftWords(words(3), place[1]!.startSec);
    expect(w[0].start).toBeCloseTo(7.65);
    expect(w[2].end).toBeCloseTo(7.65 + 0.42 * 3 - 0.05);
  });
  it("a plan's caption words stay inside the final timeline", () => {
    const p = makeShort();
    const tl = computeTimeline(p.beats.map(() => 8), p.beats);
    const place = resolveNarration(tl.starts, p.beats.map((b) => b.narrationOffset), p.beats.map(() => 5.9), 0.25);
    place.forEach((x) => expect(x!.endSec).toBeLessThanOrEqual(tl.total + 0.01));
  });
});

describe("filter strings", () => {
  it("punch-in is an eased scale+crop capped at 1.2", () => {
    const f = punchFilter({ punch: 1.5, punchAt: 4, punchSeconds: 0.35 }, 1080, 1920);
    expect(f).toContain("scale=w='trunc(1080*");
    expect(f).toContain("eval=frame");
    expect(f).toContain("0.2*"); // capped
    expect(f).toContain("crop=1080:1920");
    expect(punchFilter({ punch: 1 }, 1080, 1920)).toBe("");
  });
  it("voice chain, loudness and sfx levels follow the research", () => {
    expect(voiceChain()).toContain("highpass=f=80");
    expect(voiceChain()).toContain("acompressor=threshold=-18dB:ratio=3");
    expect(voiceChain()).toContain("deesser");
    expect(loudnormFilter()).toBe("loudnorm=I=-14:TP=-1.5:LRA=11");
    expect(sfxVolumeDb(5, -18)).toBe(-13);
  });
  it("mix graph: sidechain ducking, SFX with adelay over amix normalize=0, bed dropout before the impact", () => {
    const p = makeShort();
    const g = editMixGraph({ ambient: 1, narration: 2, music: 3, sfx: [{ input: 4, at: 12.5, gainDb: 4 }], total: 40, ambientGain: 0.22, musicGain: 0.126, musicEntryAt: 0, duckDb: 9, dropouts: dropoutWindows(p) });
    expect(g).toContain("sidechaincompress");
    expect(g).toContain("adelay=12500|12500");
    expect(g).toContain("amix=inputs=3:normalize=0");
    expect(g).toContain("volume=0:enable='between(t,");
    expect(dropoutWindows(p).length).toBe(1);
  });
  it("timeline graph places each file with adelay and trims to the total", () => {
    const g = timelineGraph([{ input: 0, startSec: 0.25 }, { input: 1, startSec: 7.65 }], 20);
    expect(g).toContain("adelay=250|250");
    expect(g).toContain("adelay=7650|7650");
    expect(g).toContain("amix=inputs=2:normalize=0");
    expect(g).toContain("atrim=0:20");
  });
  it("finish chain ends with grade, vignette, then noise; captions before grade; loop fade", () => {
    const g = finishVideoGraph({ total: 30, style: DEFAULT_STYLE, captions: "captions.ass", loop: true });
    const order = ["fade=t=in:st=29.6", "ass=captions.ass", "eq=contrast", "vignette=angle=PI/5", "noise=alls="];
    let at = -1;
    for (const s of order) {
      const i = g.indexOf(s);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
    expect(g.trim().endsWith("[v]")).toBe(true);
    expect(finishVideoGraph({ total: 30, style: DEFAULT_STYLE, captions: null, loop: false })).not.toContain("ass=");
  });
});

describe("edit QA checks", () => {
  it("catches captions below 1248, fast captions, dense SFX and too many transition kinds", () => {
    const w = words(8, 0, 0.1);
    const ass = buildAss(w, { wordsPerChunk: 3, fontSize: 92, marginBottom: 672 });
    const good = editQaChecks({ ass, words: words(8), edit: makeShort(), duration: 30 });
    expect(good.every((c) => c.ok)).toBe(true);
    expect(good.map((c) => c.id)).toEqual(expect.arrayContaining(["caption_safe_zone", "cps", "sfx_density", "transition_kinds", "end_clean"]));
    const badEdit = JSON.parse(JSON.stringify(makeShort()));
    badEdit.beats[1].sfx.push({ kind: "pop", at: 0.5, gainDb: 3, take: 0 }, { kind: "pop", at: 1, gainDb: 3, take: 1 });
    ["fade", "zoomin", "smoothleft", "dip"].forEach((k, i) => (badEdit.beats[i + 1].transitionIn = k));
    const bad = editQaChecks({ ass: ass.replace(/pos\(540,1248\)/g, "pos(540,1320)"), words: w, edit: badEdit, duration: 30 });
    for (const id of ["caption_safe_zone", "cps", "sfx_density", "transition_kinds"]) expect(bad.find((c) => c.id === id)!.ok, id).toBe(false);
  });
});
