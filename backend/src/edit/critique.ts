// The director checklist and anti-slop list as code. Every check says which research section it comes from, and
// most of them repair the plan automatically (at most 2 rounds). The input plan is never mutated.

import { sfxGapViolations } from "./filters";
import {
  CAPTION_BOTTOM_MAX_Y,
  END_SCREEN_S,
  GRAIN_MAX,
  HOOK_WINDOW_S,
  IMPACT_HOLD_S,
  MAX_TRANSITION_KINDS,
  PUNCH_MAX,
  RISER_S,
  RISER_SILENCE_S,
  SFX_MIN_GAP_S,
  SFX_OFFSET_S,
  SFX_PRIORITY,
  SFX_TAKES,
  STATIC_MAX_S,
  END_CLEAN_S,
  textHold,
} from "./rules";
import type { EditBeat, EditCheck, EditPlan, EditReview } from "./types";

interface Rule {
  id: string;
  ref: string;
  test: (p: EditPlan) => string | null; // null = fine, else the problem
  fix?: (p: EditPlan) => void;
  okMessage: string;
}

const allSfx = (p: EditPlan) => p.beats.flatMap((b) => b.sfx.map((s) => ({ b, s }))).sort((x, y) => x.s.at - y.s.at);
const removeSfx = (p: EditPlan, s: EditBeat["sfx"][number]) => p.beats.forEach((b) => (b.sfx = b.sfx.filter((x) => x !== s)));
const otherPunch = (p: EditPlan, i: number) => [1.12, 1.2, 1].find((v) => v !== p.beats[i - 1]?.punch && v !== p.beats[i + 1]?.punch && v !== p.beats[i].punch) ?? 1.12;

const RULES: Rule[] = [
  {
    id: "hook_first",
    ref: "§13",
    okMessage: "the film opens on the hook with a hard cut and nothing covering the first 2 s",
    test: (p) => {
      const b = p.beats[0];
      if (!b) return "no beats";
      if (b.role !== "hook") return "first beat is not the hook";
      if (b.transitionIn !== "cut") return "the hook has a transition";
      if (b.card && b.card.at < HOOK_WINDOW_S) return "a card covers the hook";
      return null;
    },
    fix: (p) => {
      const b = p.beats[0];
      b.role = "hook";
      b.transitionIn = "cut";
      b.transitionSeconds = 0;
      if (b.card && b.card.at < HOOK_WINDOW_S) delete b.card;
    },
  },
  {
    id: "transition_kinds",
    ref: "§02",
    okMessage: `at most ${MAX_TRANSITION_KINDS} transition kinds`,
    test: (p) => {
      const k = new Set(p.beats.map((b) => b.transitionIn).filter((x) => x !== "cut"));
      return k.size > MAX_TRANSITION_KINDS ? `${k.size} transition kinds (${[...k].join(", ")})` : null;
    },
    fix: (p) => {
      const count = new Map<string, number>();
      p.beats.forEach((b) => b.transitionIn !== "cut" && count.set(b.transitionIn, (count.get(b.transitionIn) || 0) + 1));
      const keep = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TRANSITION_KINDS).map((e) => e[0]);
      p.beats.forEach((b) => {
        if (b.transitionIn !== "cut" && !keep.includes(b.transitionIn)) b.transitionIn = keep[0] as EditBeat["transitionIn"];
      });
      p.transitionKinds = keep as EditPlan["transitionKinds"];
    },
  },
  {
    id: "payoff_clean_cut",
    ref: "§20",
    okMessage: "the payoff arrives on a hard cut so the impact lands with the picture",
    test: (p) => (p.beats.some((b) => b.role === "payoff" && b.transitionIn !== "cut") ? "the payoff has a transition" : null),
    fix: (p) => p.beats.forEach((b) => b.role === "payoff" && ((b.transitionIn = "cut"), (b.transitionSeconds = 0))),
  },
  {
    id: "punch_cap",
    ref: "§09",
    okMessage: `punch-ins stay at or below ${PUNCH_MAX}`,
    test: (p) => (p.beats.some((b) => b.punch > PUNCH_MAX + 1e-9 || b.punch < 1) ? "a punch-in is outside 1.0-1.2" : null),
    fix: (p) => p.beats.forEach((b) => (b.punch = Math.min(PUNCH_MAX, Math.max(1, b.punch)))),
  },
  {
    id: "punch_repeat",
    ref: "§09",
    okMessage: "no punch level repeats twice in a row",
    test: (p) => (p.beats.some((b, i) => i > 0 && b.punch > 1 && b.punch === p.beats[i - 1].punch) ? "the same punch-in repeats" : null),
    fix: (p) =>
      p.beats.forEach((b, i) => {
        if (i > 0 && b.punch > 1 && b.punch === p.beats[i - 1].punch) {
          b.punch = otherPunch(p, i);
          b.layout = b.punch > 1 ? "punch" : b.layout;
        }
      }),
  },
  {
    id: "static_frame",
    ref: "§12",
    okMessage: `no shot stays unchanged longer than ${STATIC_MAX_S} s`,
    test: (p) => {
      const bad = p.beats.filter((b) => b.end - b.start > STATIC_MAX_S && b.punch <= 1 && !b.card);
      return bad.length ? `shot ${bad.map((b) => b.index).join(", ")} is static for over ${STATIC_MAX_S} s` : null;
    },
    fix: (p) =>
      p.beats.forEach((b, i) => {
        if (b.end - b.start > STATIC_MAX_S && b.punch <= 1 && !b.card) {
          b.punch = otherPunch(p, i) > 1 ? otherPunch(p, i) : 1.12;
          b.punchAt = 4;
          b.punchSeconds = 0.35;
          b.layout = "punch";
        }
      }),
  },
  {
    id: "layout_variety",
    ref: "skill anti-slop",
    okMessage: "no three identical layouts in a row",
    test: (p) => (p.beats.some((b, i) => i >= 2 && b.layout === p.beats[i - 1].layout && b.layout === p.beats[i - 2].layout) ? "three identical layouts in a row" : null),
    fix: (p) =>
      p.beats.forEach((b, i) => {
        if (i >= 2 && b.layout === p.beats[i - 1].layout && b.layout === p.beats[i - 2].layout) {
          // Change the middle of the run (never the hook or payoff): a different layout with a punch level unlike its neighbours.
          const j = b.role === "payoff" || b.role === "hook" ? i - 1 : i;
          const t = p.beats[j];
          t.layout = "punch";
          t.punch = [1.12, 1.2].find((v) => v !== p.beats[j - 1]?.punch && v !== p.beats[j + 1]?.punch) ?? 1.12;
          t.punchAt = 0;
        }
      }),
  },
  {
    id: "sfx_density",
    ref: "§20",
    okMessage: `sound effects are at least ${SFX_MIN_GAP_S} s apart`,
    test: (p) => {
      const v = sfxGapViolations(allSfx(p).map((x) => ({ kind: x.s.kind, at: x.s.at })));
      return v.length ? `${v.length} effect pair(s) closer than ${SFX_MIN_GAP_S} s` : null;
    },
    fix: (p) => {
      for (let guard = 0; guard < 50; guard++) {
        const list = allSfx(p);
        const v = sfxGapViolations(list.map((x) => ({ kind: x.s.kind, at: x.s.at })));
        if (!v.length) break;
        const a = list.find((x) => x.s.at === v[0][0])!;
        const b = list.find((x) => x.s.at === v[0][1])!;
        removeSfx(p, (SFX_PRIORITY[a.s.kind] >= SFX_PRIORITY[b.s.kind] ? b : a).s);
      }
    },
  },
  {
    id: "sfx_repeat",
    ref: "§20",
    okMessage: "no identical sound effect twice in a row",
    test: (p) => {
      const l = allSfx(p);
      return l.some((x, i) => i > 0 && x.s.kind === l[i - 1].s.kind && x.s.take === l[i - 1].s.take) ? "the same effect take repeats back to back" : null;
    },
    fix: (p) => {
      const l = allSfx(p);
      l.forEach((x, i) => {
        if (i > 0 && x.s.kind === l[i - 1].s.kind && x.s.take === l[i - 1].s.take) x.s.take = (x.s.take + 1) % SFX_TAKES;
      });
    },
  },
  {
    id: "sfx_once",
    ref: "§20",
    okMessage: "one riser and one impact per film",
    test: (p) => {
      const l = allSfx(p);
      return l.filter((x) => x.s.kind === "riser").length > 1 || l.filter((x) => x.s.kind === "impact").length > 1 ? "more than one riser or impact" : null;
    },
    fix: (p) => {
      for (const kind of ["riser", "impact"]) {
        const l = allSfx(p).filter((x) => x.s.kind === kind);
        l.slice(0, -1).forEach((x) => removeSfx(p, x.s));
      }
    },
  },
  {
    id: "payoff_impact",
    ref: "§20",
    okMessage: "the payoff lands with an impact one frame after the picture",
    test: (p) => {
      const pay = p.beats.find((b) => b.role === "payoff");
      if (!pay) return null;
      return allSfx(p).some((x) => x.s.kind === "impact" && Math.abs(x.s.at - (pay.start + SFX_OFFSET_S)) < 0.05) ? null : "the payoff has no impact on its first frame";
    },
    fix: (p) => {
      const pay = p.beats.find((b) => b.role === "payoff")!;
      const at = Math.round((pay.start + SFX_OFFSET_S) * 1000) / 1000;
      allSfx(p).forEach((x) => {
        if (x.s.kind === "impact" || (Math.abs(x.s.at - at) < SFX_MIN_GAP_S && x.s.kind !== "riser")) removeSfx(p, x.s);
      });
      pay.sfx.push({ kind: "impact", at, gainDb: 6, take: 0 });
      if (!allSfx(p).some((x) => x.s.kind === "riser") && at - RISER_S - RISER_SILENCE_S >= 0.5) {
        const ra = Math.round((at - SFX_OFFSET_S - RISER_SILENCE_S - RISER_S) * 1000) / 1000;
        const owner = p.beats.find((b) => ra >= b.start && ra < b.end) ?? pay;
        if (!allSfx(p).some((x) => Math.abs(x.s.at - ra) < SFX_MIN_GAP_S)) owner.sfx.push({ kind: "riser", at: ra, gainDb: 5, take: 0 });
      }
    },
  },
  {
    id: "caption_safe_zone",
    ref: "§04",
    okMessage: `captions end at or above y ${CAPTION_BOTTOM_MAX_Y}`,
    test: (p) => ((p.captionBottomY ?? CAPTION_BOTTOM_MAX_Y) > CAPTION_BOTTOM_MAX_Y ? `caption bottom edge y ${p.captionBottomY} is below ${CAPTION_BOTTOM_MAX_Y}` : null),
    fix: (p) => (p.captionBottomY = CAPTION_BOTTOM_MAX_Y),
  },
  {
    id: "text_hold",
    ref: "§05",
    okMessage: "cards stay up long enough to read (0.5 s + 0.3 s per word)",
    test: (p) => (p.beats.some((b) => b.card && b.card.seconds + 1e-6 < textHold(b.card.text.split(/\s+/).length)) ? "a card is shorter than its reading time" : null),
    fix: (p) => p.beats.forEach((b) => b.card && (b.card.seconds = Math.max(b.card.seconds, textHold(b.card.text.split(/\s+/).length)))),
  },
  {
    id: "end_clean",
    ref: "§21",
    okMessage: "the film ends on a clean frame (Short) or with a proper end-screen window (long)",
    test: (p) => {
      const last = p.beats[p.beats.length - 1];
      if (!last) return null;
      if (p.format === "short") {
        if (p.endCard) return "a Short has an end card";
        if (last.card && last.card.at + last.card.seconds > p.totalSeconds - END_CLEAN_S) return "a card runs to the last frame";
        if (last.sfx.some((s) => s.at > p.totalSeconds - END_CLEAN_S)) return "an effect plays on the last frame";
        return null;
      }
      return p.endCard && (p.endCard.seconds < END_SCREEN_S[0] || p.endCard.seconds > END_SCREEN_S[1]) ? "end card length is outside the end-screen slot" : null;
    },
    fix: (p) => {
      const last = p.beats[p.beats.length - 1];
      if (p.format === "short") {
        p.endCard = null;
        if (last.card && last.card.at + last.card.seconds > p.totalSeconds - END_CLEAN_S) delete last.card;
        last.sfx = last.sfx.filter((s) => s.at <= p.totalSeconds - END_CLEAN_S);
      } else if (p.endCard) p.endCard.seconds = Math.min(END_SCREEN_S[1], Math.max(END_SCREEN_S[0], p.endCard.seconds));
    },
  },
  {
    id: "texture_levels",
    ref: "§18",
    okMessage: "grain and vignette stay subtle",
    test: (p) => (p.style.grain > GRAIN_MAX || p.style.vignette > 0.25 ? "grain or vignette is too strong" : null),
    fix: (p) => {
      p.style = { ...p.style, grain: Math.min(GRAIN_MAX, p.style.grain), vignette: Math.min(0.25, p.style.vignette) };
    },
  },
  {
    id: "short_loop",
    ref: "§14",
    okMessage: "a Short loops back into its first frame",
    test: (p) => (p.format === "short" && !p.loop ? "the Short does not loop" : null),
    fix: (p) => (p.loop = true),
  },
  {
    id: "music_bed",
    ref: "§11",
    okMessage: "music bed chosen",
    test: () => null,
  },
];

export function critiqueEditPlan(input: EditPlan): { plan: EditPlan; review: EditReview } {
  const plan: EditPlan = JSON.parse(JSON.stringify(input));
  const fixedIds = new Set<string>();
  let rounds = 0;
  for (let r = 0; r < 2; r++) {
    const failing = RULES.filter((x) => x.test(plan));
    if (!failing.length) break;
    rounds++;
    for (const f of failing) if (f.fix) (f.fix(plan), fixedIds.add(f.id));
  }
  plan.transitionKinds = [...new Set(plan.beats.map((b) => b.transitionIn).filter((x) => x !== "cut"))];
  const checks: EditCheck[] = RULES.map((x) => {
    const problem = x.test(plan);
    const fixed = fixedIds.has(x.id) && !problem;
    return { id: x.id, ref: x.ref, ok: !problem, fixed: fixed || undefined, message: problem ? problem : fixed ? `fixed automatically: ${x.okMessage}` : x.okMessage };
  });
  if (plan.totalSeconds >= 15 && !plan.music?.file) {
    const c = checks.find((x) => x.id === "music_bed")!;
    c.message = "warning: no music file found in assets/audio/music; the video is made without music";
  }
  return { plan, review: { passed: checks.every((c) => c.ok), rounds, checks } };
}
