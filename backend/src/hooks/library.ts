// Hook library: the hook types and fill-in templates from the project's hook research
// (docs/Viral-Video-Research-Complete.md, sections 2.2, 3.1 and 4). Examples are only included
// where a cited source supplied them; all other templates carry the formula and the rule only.

export type HookFormat = "short" | "long";

export type HookType =
  | "curiosity_gap"
  | "in_medias_res"
  | "relatable_problem"
  | "direct_promise"
  | "raise_stakes"
  | "contrarian"
  | "visual_shock"
  | "shocking_stat"
  | "numbered"
  | "pattern_interrupt"
  | "regret"
  | "foreshadow"
  | "cold_open"
  | "text_subtext";

export interface HookTypeInfo {
  label: string;
  how: string;
  failure: string;
}

export const HOOK_TYPES: Record<HookType, HookTypeInfo> = {
  curiosity_gap: {
    label: "Curiosity gap / unanswered question",
    how: "Opens a gap the viewer wants closed.",
    failure: "The question is vague, or the answer is given too soon.",
  },
  in_medias_res: {
    label: "In medias res",
    how: "Starts mid-moment and skips the setup.",
    failure: "The context is never delivered, so the viewer is confused.",
  },
  relatable_problem: {
    label: "Relatable problem",
    how: "Names the viewer's pain and promises a fix.",
    failure: "Generic 'you' claims with no specifics.",
  },
  direct_promise: {
    label: "Direct or time promise",
    how: "States a specific outcome, often with a time frame.",
    failure: "The promise is bigger than the payoff.",
  },
  raise_stakes: {
    label: "Raise the stakes",
    how: "Puts something at risk.",
    failure: "Fake stakes lose trust.",
  },
  contrarian: {
    label: "Contrarian / myth-bust",
    how: "Challenges something the viewer believes.",
    failure: "No proof follows the claim.",
  },
  visual_shock: {
    label: "Visual hook",
    how: "A striking, simple image before any words; understandable on mute.",
    failure: "An image unrelated to the topic.",
  },
  shocking_stat: {
    label: "Shocking statistic",
    how: "A surprising number, then the reason.",
    failure: "An unverified number spoken with confidence.",
  },
  numbered: {
    label: "Numbered / listicle",
    how: "The count is promised up front.",
    failure: "The count is buried or unclear.",
  },
  pattern_interrupt: {
    label: "Pattern interrupt",
    how: "Two surprising elements together.",
    failure: "Surprise with no payoff.",
  },
  regret: {
    label: "Regret opener",
    how: "Signals an avoidable obstacle.",
    failure: "Overused, vague action.",
  },
  foreshadow: {
    label: "Foreshadowed payoff",
    how: "States what is coming but withholds it.",
    failure: "Stated, then never delivered.",
  },
  cold_open: {
    label: "Cold open on the strongest moment",
    how: "Shows the best moment first, then rewinds to explain.",
    failure: "The moment is never tied back in.",
  },
  text_subtext: {
    label: "Text-based subtext",
    how: "An on-screen phrase adds a second layer of meaning.",
    failure: "Text is unreadable or too long.",
  },
};

export interface HookTemplate {
  id: string;
  type: HookType;
  format: HookFormat;
  formula: string;
  /** Only present when a cited source supplied the example. */
  example?: string;
  source?: string;
  niches: string[];
  rule: string;
}

export const HOOK_TEMPLATES: HookTemplate[] = [
  // ---- Long-form
  { id: "L1", type: "curiosity_gap", format: "long", formula: "[Striking specific fact]. [One-line promise of what the video shows.]", niches: ["explainer"], rule: "The same fact appears in the title." },
  { id: "L2", type: "in_medias_res", format: "long", formula: "It's [time]. [Specific event in progress]. [Problem.]", example: "It's 2am. I just lost 43 subscribers in one hour. I made a huge mistake.", source: "vidIQ", niches: ["story", "crime"], rule: "Deliver the context within 20 seconds." },
  { id: "L3", type: "contrarian", format: "long", formula: "You've been told [X]. [Contradiction.]", example: "What if everything you know about success is wrong?", source: "vidIQ", niches: ["myth-bust"], rule: "Proof begins within 30 seconds." },
  { id: "L4", type: "shocking_stat", format: "long", formula: "Only [number] of [group] [outcome]. [Why.]", example: "Only 6.6% of YouTube channels ever reach 1,000 subscribers.", source: "vidIQ", niches: ["business", "science"], rule: "The number must be verified." },
  { id: "L5", type: "direct_promise", format: "long", formula: "In the next [time], I'll show you [specific result].", example: "In the next 60 seconds, I'll show you the thumbnail strategy that doubled my click-through rate.", source: "vidIQ", niches: ["tutorial"], rule: "The result is delivered by the stated time." },
  { id: "L6", type: "cold_open", format: "long", formula: "[Cold-open best moment], then 'to understand this, go back to [start]'.", niches: ["challenge", "build"], rule: "Bring the moment back later in the video." },
  { id: "L7", type: "raise_stakes", format: "long", formula: "If [outcome fails], [consequence].", example: "If this video doesn't hit 10,000 views, I'm quitting YouTube.", source: "vidIQ", niches: ["challenge"], rule: "Stakes are real and resolved." },
  { id: "L8", type: "curiosity_gap", format: "long", formula: "[Question the viewer can't answer]. [Image.]", example: "When was the last time you were actually proud of something you made?", source: "vidIQ", niches: ["reflective"], rule: "The answer arrives." },
  { id: "L9", type: "foreshadow", format: "long", formula: "Here are [N] reasons why [X].", niches: ["listicle"], rule: "Deliver all N." },
  { id: "L10", type: "relatable_problem", format: "long", formula: "[Problem the viewer has] versus [the solution].", example: "You're losing 40% of viewers in the first 30 seconds because your intros are too slow.", source: "vidIQ", niches: ["advice"], rule: "Specific, not generic." },
  { id: "L11", type: "visual_shock", format: "long", formula: "[Impossible visual] plus one line of context.", niches: ["space", "what-if"], rule: "The visual matches the title." },
  { id: "L12", type: "regret", format: "long", formula: "This is the advice I wish I had before [mistake].", example: "This is the advice I wish I had before wasting two years on YouTube.", source: "vidIQ", niches: ["advice"], rule: "Name the mistake early." },
  // ---- Shorts
  { id: "S1", type: "curiosity_gap", format: "short", formula: "[Unexpected claim about results].", example: "I made more money after I stopped posting daily", source: "Opus", niches: ["advice"], rule: "The payoff arrives inside the Short." },
  { id: "S2", type: "curiosity_gap", format: "short", formula: "Why do [X] [bad outcome]?", example: "Why do your Shorts die at 40% watch time?", source: "Opus", niches: ["education"], rule: "Answer it by the end." },
  { id: "S3", type: "contrarian", format: "short", formula: "[Claim], and I'll prove it in [N] seconds.", example: "Longer Shorts actually get more views, and I'll prove it in 30 seconds.", source: "Opus", niches: ["education"], rule: "Proof arrives within the stated time." },
  { id: "S4", type: "numbered", format: "short", formula: "[N] [things] that [fix].", example: "3 settings that fix blurry Shorts", source: "Opus", niches: ["tutorial"], rule: "The count is visible on screen." },
  { id: "S5", type: "direct_promise", format: "short", formula: "[Time]-[thing] that actually [quality].", example: "60-second pasta that actually tastes good.", source: "Opus", niches: ["food"], rule: "The time is truthful." },
  { id: "S6", type: "pattern_interrupt", format: "short", formula: "Somebody keeps [problem]. So I [unexpected action].", example: "Somebody keeps ripping my for-sale signs out of the yards. So I bought a baseball bat.", source: "Scott (Social Media Examiner)", niches: ["story"], rule: "The unexpected element comes first." },
  { id: "S7", type: "regret", format: "short", formula: "I wish I had known this before I [action].", source: "Scott (Social Media Examiner)", niches: ["advice"], rule: "Name a specific action." },
  { id: "S8", type: "text_subtext", format: "short", formula: "[On-screen text contrast: 'X says' versus 'X means'].", example: "What marketers say to their clients vs. what they want to say.", source: "Scott (Social Media Examiner)", niches: ["humor"], rule: "The text is readable within 2 seconds." },
  { id: "S9", type: "visual_shock", format: "short", formula: "[Impossible visual, no words for the first beat].", niches: ["ai-visuals", "space"], rule: "It must work on mute." },
  { id: "S10", type: "cold_open", format: "short", formula: "[Flash the end result], then show how.", niches: ["craft"], rule: "The result is shown in the first second." },
  { id: "S11", type: "relatable_problem", format: "short", formula: "Are you [self-identifier]?", example: "Are you editing Shorts on your phone and feeling limited?", source: "Opus", niches: ["niche-advice"], rule: "Narrow the audience." },
  { id: "S12", type: "foreshadow", format: "short", formula: "[Twist ending that answers the opening].", niches: ["any"], rule: "The ending echoes the first frame so a replay feels natural." },
];

export function templatesFor(format: HookFormat): HookTemplate[] {
  return HOOK_TEMPLATES.filter((t) => t.format === format);
}
