// Niche profiles: format fit, default lengths, subject modes and rules, from docs/Niche-Research-Complete.md
// (section 4 "Which format fits which niche", section 5 evidence tables) and the hook library ids in hooks/library.ts.

import type { NicheProfile } from "./types";

export const PROFILES: NicheProfile[] = [
  {
    id: "space_science",
    label: "Space and science explainers",
    formatFit: { short: "medium", long: "strong" },
    defaultLengthSeconds: { short: 35, long: 840 },
    subjectMode: "subject",
    structure: "explainer",
    visualRules: [
      "One recurring celestial or scientific subject (a planet, a star, a machine) in every shot, identical shape and colour.",
      "No people and no realistic human faces.",
      "No text, labels or logos inside the frame.",
      "Scale and motion over detail: one clear focal object per shot.",
    ],
    preferredHookTypes: ["visual_shock", "curiosity_gap", "shocking_stat", "contrarian"],
    factsRequired: true,
    policyNotes: ["Low policy risk; every number and claim must be verified before it is spoken."],
    voice: "Calm, precise and awestruck; short sentences, key noun early.",
    keywords: [
      "space", "planet", "saturn", "jupiter", "mars", "venus", "mercury", "neptune", "uranus", "pluto", "moon", "sun",
      "star", "galaxy", "black hole", "nebula", "comet", "asteroid", "universe", "cosmos", "nasa", "astronaut",
      "orbit", "solar system", "supernova", "telescope", "physics", "quantum", "gravity", "science", "light year",
    ],
  },
  {
    id: "history_documentary",
    label: "History documentary",
    formatFit: { short: "weak", long: "strong" },
    defaultLengthSeconds: { short: 40, long: 1200 },
    subjectMode: "place",
    structure: "story",
    visualRules: [
      "Recurring places, maps and objects (a city, a fortress, a sword); no realistic human faces.",
      "Atmosphere and reenactment from behind or at a distance; no gore.",
      "Period-correct architecture, clothing and tools; no modern items.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["in_medias_res", "cold_open", "curiosity_gap", "contrarian"],
    factsRequired: true,
    policyNotes: ["Needs sourced scripts; avoid sleep-history clone templates; do not present contested events as settled."],
    voice: "Measured documentary narrator; concrete dates and names written as words.",
    keywords: [
      "history", "historical", "empire", "ancient", "rome", "roman", "medieval", "war", "battle", "dynasty", "king",
      "queen", "emperor", "revolution", "civilization", "collapse", "fall of", "siege", "viking", "pharaoh", "egypt",
      "ottoman", "crusade", "century", "colonial", "world war", "ww2", "ww1",
    ],
  },
  {
    id: "mystery_horror",
    label: "Mystery, horror and the unexplained",
    formatFit: { short: "weak", long: "strong" },
    defaultLengthSeconds: { short: 35, long: 900 },
    subjectMode: "place",
    structure: "story",
    visualRules: [
      "Recurring locations and atmosphere (a house, a corridor, a forest road); no recognisable faces.",
      "Atmosphere and implication, never gore or graphic injury.",
      "Low light, fog and shadow; one focal moment per shot.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["in_medias_res", "cold_open", "curiosity_gap", "pattern_interrupt"],
    factsRequired: false,
    policyNotes: [
      "Fiction and folklore only unless sourced; never about real named victims or private people.",
      "Shorts work best only as trailers for the long video.",
    ],
    voice: "Low, slow and deliberate; build dread with understatement.",
    keywords: [
      "mystery", "horror", "haunted", "ghost", "unexplained", "creepy", "scary", "paranormal", "disappearance",
      "abandoned", "cursed", "urban legend", "cryptid", "conspiracy", "strange", "eerie", "unsolved", "nightmare",
      "creature", "legend",
    ],
  },
  {
    id: "curiosity_what_if",
    label: "Curiosity and what-if animation",
    formatFit: { short: "strong", long: "strong" },
    defaultLengthSeconds: { short: 30, long: 600 },
    subjectMode: "subject",
    structure: "what_if",
    visualRules: [
      "One recurring subject that the what-if happens to (the Earth, a city, an object).",
      "Impossible but simple visuals; escalate scale each beat.",
      "No text in the frame; no realistic human faces.",
    ],
    preferredHookTypes: ["curiosity_gap", "visual_shock", "raise_stakes", "pattern_interrupt"],
    factsRequired: true,
    policyNotes: ["Ground each escalation in a real mechanism or number; label speculation as speculation."],
    voice: "Playful, escalating and confident; questions answered one beat at a time.",
    keywords: [
      "what if", "what would happen", "imagine", "if the earth", "if you", "what happens if", "hypothetical",
      "could we", "would it", "scenario", "thought experiment", "stopped spinning", "disappeared",
    ],
  },
  {
    id: "mythology_folklore",
    label: "Mythology and folklore",
    formatFit: { short: "weak", long: "medium" },
    defaultLengthSeconds: { short: 40, long: 900 },
    subjectMode: "mixed",
    structure: "story",
    visualRules: [
      "Recurring symbolic objects, creatures and places (a sword, a labyrinth, a river); no realistic human faces.",
      "Painterly, mythic lighting; no gore.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["in_medias_res", "curiosity_gap", "cold_open", "foreshadow"],
    factsRequired: true,
    policyNotes: [
      "Retell classical and folk myths with named sources; never produce religious devotional story farms.",
      "High AI-slop competition: vary structure and add a real point of view.",
    ],
    voice: "Storyteller with gravity and a dry edge.",
    keywords: [
      "mythology", "myth", "folklore", "zeus", "odin", "thor", "greek god", "norse", "titan", "minotaur", "legend of",
      "hero", "gods", "goddess", "fable", "epic of", "gilgamesh", "olympus", "valhalla", "medusa",
    ],
  },
  {
    id: "character_series",
    label: "Original character series",
    formatFit: { short: "strong", long: "medium" },
    defaultLengthSeconds: { short: 30, long: 600 },
    subjectMode: "cast",
    structure: "story",
    visualRules: [
      "A small cast (two to four) with locked features: shape, colour and outfit identical in every shot.",
      "Stylised or non-human characters (robots, animals, creatures) rather than realistic people.",
      "The situation changes every episode; same cast, new scenario.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["pattern_interrupt", "in_medias_res", "relatable_problem", "text_subtext"],
    factsRequired: false,
    policyNotes: ["Each episode must change the situation (inauthentic-content policy); never a manufactured emotional formula."],
    voice: "Warm, light and character-driven; dialogue summarised by the narrator.",
    keywords: [
      "series", "episode", "cast", "characters", "robot", "robots", "friends", "friend", "buddy", "buddies", "duo",
      "sidekick", "mascot", "roommates", "adventures of", "cartoon", "sitcom",
    ],
  },
  {
    id: "anime_story",
    label: "Anime story",
    formatFit: { short: "strong", long: "medium" },
    defaultLengthSeconds: { short: 48, long: 600 },
    subjectMode: "cast",
    structure: "story",
    visualStyle: "anime",
    visualRules: [
      "Anime look in every shot: clean cel-shaded linework, expressive eyes, painterly backgrounds, dramatic skies and light.",
      "A small cast (one to three) of original characters with locked features: hair colour and style, eye colour, outfit and one signature item, identical in every shot.",
      "Original characters only: no existing anime, manga, game or film characters, and no copied studio styles by name.",
      "No text, speech bubbles, captions or logos inside the frame.",
    ],
    preferredHookTypes: ["in_medias_res", "cold_open", "pattern_interrupt", "curiosity_gap"],
    factsRequired: false,
    policyNotes: [
      "Original characters and an original plot; no named existing franchises.",
      "Each episode changes the situation (inauthentic-content policy); no gore, no sexualised characters.",
    ],
    voice: "Dramatic, emotional and fast-moving; short punchy lines with a cliffhanger.",
    keywords: ["anime", "manga", "shonen", "shojo", "samurai", "ninja", "isekai", "otaku", "cel shaded", "anime style"],
  },
  {
    id: "geopolitics_business",
    label: "Geopolitics, economics and business",
    formatFit: { short: "weak", long: "strong" },
    defaultLengthSeconds: { short: 40, long: 900 },
    subjectMode: "mixed",
    structure: "explainer",
    visualRules: [
      "Recurring maps, cities, ports and objects (a container ship, a pipeline); no realistic politicians' faces.",
      "Data-style visuals without readable text; one focal moment per shot.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["shocking_stat", "contrarian", "raise_stakes", "curiosity_gap"],
    factsRequired: true,
    policyNotes: [
      "Explain, never advise: no investment, trading or financial advice from a persona.",
      "Name sources for every figure; present contested claims with both sides.",
    ],
    voice: "Analytical and even-handed; numbers written as words, one claim per sentence.",
    keywords: [
      "geopolitics", "economy", "economic", "trade", "tariff", "sanctions", "china", "russia", "nato", "oil", "supply chain",
      "inflation", "recession", "central bank", "currency", "gdp", "business", "company", "market", "strategy", "country",
      "election", "diplomacy", "military",
    ],
  },
  {
    id: "nature_animals",
    label: "Nature and animals",
    formatFit: { short: "strong", long: "medium" },
    defaultLengthSeconds: { short: 30, long: 600 },
    subjectMode: "subject",
    structure: "list",
    visualRules: [
      "One recurring animal or habitat subject with locked features.",
      "Natural behaviour only; no animal distress, injury, cruelty or staged rescue.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["visual_shock", "numbered", "curiosity_gap", "shocking_stat"],
    factsRequired: true,
    policyNotes: ["Never depict animal distress or fake rescues; AI animal comedy has extreme variance."],
    voice: "Warm, curious and vivid; one surprising fact per beat.",
    keywords: [
      "animal", "animals", "wildlife", "nature", "ocean", "deep sea", "shark", "whale", "octopus", "bird", "insect",
      "jungle", "rainforest", "predator", "species", "dinosaur", "forest", "reef", "wolf", "lion", "bear",
    ],
  },
  {
    id: "tech_explainer",
    label: "Tech and AI explainers",
    formatFit: { short: "weak", long: "medium" },
    defaultLengthSeconds: { short: 35, long: 720 },
    subjectMode: "subject",
    structure: "explainer",
    visualRules: [
      "One recurring device, chip or abstract machine as the subject.",
      "Avoid fake screenshots, UI text and logos.",
      "No text in the frame.",
    ],
    preferredHookTypes: ["curiosity_gap", "contrarian", "shocking_stat", "relatable_problem"],
    factsRequired: true,
    policyNotes: ["Needs real screens for tutorials, so keep to concept explainers; verify every claim."],
    voice: "Clear, direct and jargon-light; explain the one idea that matters.",
    keywords: [
      "tech", "technology", "ai", "artificial intelligence", "chip", "processor", "software", "algorithm", "internet",
      "computer", "robotics", "smartphone", "gpu", "machine learning", "chatgpt", "startup", "app", "battery", "semiconductor",
    ],
  },
  {
    id: "generic_explainer",
    label: "General explainer",
    formatFit: { short: "medium", long: "medium" },
    defaultLengthSeconds: { short: 30, long: 600 },
    subjectMode: "mixed",
    structure: "explainer",
    visualRules: [
      "At most one or two recurring subjects; choose whatever the idea is actually about.",
      "No text in the frame; no realistic human faces.",
    ],
    preferredHookTypes: ["curiosity_gap", "direct_promise", "contrarian", "visual_shock"],
    factsRequired: false,
    policyNotes: ["Fallback profile: keep claims modest and verified."],
    voice: "Clear, friendly and specific.",
    keywords: [],
  },
];

export function getProfile(id: string): NicheProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (!k) continue;
    // whole-word match, optional plural
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(k)}${k.length <= 2 ? "" : "(?:s|es)?"}($|[^a-z0-9])`, "i");
    if (re.test(text)) hits += 1 + (k.includes(" ") ? 1 : 0);
  }
  return hits;
}

/** Pick the profile for an idea. An explicit niche id wins; 'auto' or unknown ids use keyword matching. */
export function pickProfile(idea: string, niche?: string): NicheProfile {
  const generic = getProfile("generic_explainer") as NicheProfile;
  if (niche && niche !== "auto") {
    const direct = getProfile(niche);
    if (direct) return direct;
  }
  const text = ` ${idea.toLowerCase()} `;
  let best: NicheProfile = generic;
  let bestScore = 0;
  for (const p of PROFILES) {
    if (p.id === "generic_explainer") continue;
    const s = keywordHits(text, p.keywords);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

const BLOCK_RULES: { re: RegExp; reason: string }[] = [
  {
    re: /\b(bed ?time stor(y|ies)|nursery rhymes?|lullab(y|ies)|kids?'? (moral )?stor(y|ies)|moral stor(y|ies) for (kids|children)|stories for (kids|children|toddlers)|children'?s stor(y|ies)|cocomelon|toddler (songs?|videos?))\b/i,
    reason: "Kids and bedtime-story channels are blocked: YouTube treats mass-produced children's content as inauthentic and made-for-kids rules restrict it.",
  },
  {
    re: /\b(bible stor(y|ies)|quran(ic)? stor(y|ies)|stories? of the prophets?|prophet stor(y|ies)|hindu stories|devotional stor(y|ies)|religious stor(y|ies)|ramayana stor(y|ies)|mahabharata stor(y|ies)|sunday school)\b/i,
    reason: "Religious-story farms are blocked: this niche is saturated with AI slop and carries a high risk of misrepresenting sacred material.",
  },
  {
    re: /\b(financial advice|investment advice|what (stock|stocks|crypto|coin) to buy|which (stock|stocks|crypto|coin) to buy|stock tips?|trading signals?|get rich quick|how to invest|best stocks? to buy|should i (buy|sell|invest)|medical advice|health advice|diagnos(e|is) (your|my)|cure (for )?(cancer|diabetes)|treat your (illness|disease)|legal advice|should i sue|how to win your (case|lawsuit))\b/i,
    reason: "Finance, health and legal advice from an AI persona is blocked: it is ineligible for monetisation and can harm viewers. Explain a topic instead of advising.",
  },
  {
    re: /\b(true crime|murder(ed)? of|serial killer|killer of|victim'?s? (of|named)|(real )?murder case|unsolved murder of|cold case of|the (murder|killing|disappearance) of [A-Z])\b/i,
    reason: "True crime about real people or named victims is blocked: it is a high policy and harm risk. Use fiction or an unnamed historical case.",
  },
  {
    re: /\b(animal (abuse|cruelty|torture)|abused (dog|cat|puppy|animal)|dying (dog|cat|puppy|animal)|injured (dog|cat|puppy)|animal rescue (prank|fake)|fake (animal )?rescue|(dog|cat|puppy|kitten|monkey) (in distress|being (hurt|beaten|tortured)|crying for help)|starving (dog|cat|puppy))\b/i,
    reason: "Animal-distress content is blocked: it is a policy violation and a common engagement-bait pattern.",
  },
  {
    re: /\b(fake (movie )?trailer|movie trailer|film trailer|trailer for (a |an |the )?(movie|film|show|series)|(avengers|batman|marvel|star wars|gta ?6|harry potter) (trailer|teaser))\b/i,
    reason: "Fake movie trailers are blocked: they use others' IP and are repeatedly demonetised as misleading.",
  },
];

export function checkBlocked(idea: string): { blocked: boolean; reason?: string } {
  for (const r of BLOCK_RULES) {
    if (r.re.test(idea)) return { blocked: true, reason: r.reason };
  }
  return { blocked: false };
}
