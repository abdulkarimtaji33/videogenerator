// Demo data: two channels (English space/science, Urdu history), 30 topic ideas from the niche research, and six plan-only
// "Demo:" projects (no images or clips; two have a saved edit plan) so every UI panel has content.
// Safe to run twice: existing channels (by slug) and topics (by channel and title) are skipped.
//   node scripts/seed.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const { migrate } = require("./migrate");

const CHANNELS = [
  { name: "Space Curiosity", slug: "space-curiosity", language: "en", niche: "space_science_curiosity", slots: ["09:00", "18:00"], tz: "UTC", banned: ["gambling", "medical advice", "investment advice"] },
  { name: "Tareekh Ki Kahani", slug: "tareekh-ki-kahani", language: "ur", niche: "south_asian_history", slots: ["12:00"], tz: "UTC", banned: ["gambling", "sectarian content"] },
];

const SPACE = [
  "What actually happens to a body falling into a black hole, at each distance from the horizon",
  "The day Earth had two Moons: the giant-impact hypothesis and the evidence still argued over",
  "Why Venus is the failed Earth: how it lost its oceans",
  "The solar system's loudest places: what spacecraft actually recorded, and why most space sounds are sonified data",
  "The 1,000-year journey: what would have to go right to reach another star with today's physics",
  "What dies first in a vacuum, minute by minute",
  "How a 1960s computer with less memory than a photo guided Apollo 11 to the Moon",
  "The Great Dying: Earth's worst extinction, 252 million years ago, read from the rock record",
  "What if the Sun vanished? The first 24 hours",
  "How scientists weigh a star, a planet and the Milky Way using only light",
  "The Wow! signal: the strongest candidate ever recorded and every explanation proposed",
  "Why the deepest hole humans drilled stopped at 12 km, and what the Kola borehole found",
  "Snowball Earth: how a frozen planet restarted",
  "Engineering mistakes that nearly doomed famous missions: Hubble's mirror and the Mars Climate Orbiter",
  "How we know the age of the universe: three measurements that disagree",
  "Saturn would float on water",
];

const HISTORY = [
  "The 1947 Radcliffe Line: how two men with outdated maps drew a border in five weeks",
  "Lahore's Anarkali and why historians doubt the legend",
  "The Indus Valley drainage and city planning, and why the script is still undeciphered",
  "The Siege of Multan and its impact on Indus trade routes",
  "Sher Shah Suri's five-year reign and what the Mughals inherited: the Grand Trunk Road and the rupee",
  "The 1857 uprising from the view of Delhi's residents",
  "How the Mughal postal and information network worked before telegraphs",
  "The 1905 partition of Bengal: a failed experiment that foreshadowed 1947",
  "Forgotten Muslim scientists of Mughal India: observatories and Lahore astrolabe makers",
  "Taxila: the ancient university city and what archaeologists found",
  "The 1970 Bhola cyclone, the deadliest ever, and its political fallout",
  "Tipu Sultan's rocket corps and how the British copied them",
  "The Lahore Resolution of 1940: what was said, what was not, and the 1946 revision debate",
  "How the Khyber Pass shaped 3,000 years of invasions and trade",
  "The canal colonies of Punjab: the engineering project that reshaped the Indus basin",
];

// ---------------------------------------------------------------------------------------------------------------
// Plan-only demo projects ("Demo: ..."). No images, clips or API calls are made: the rows only fill the UI panels
// (brief, facts, SEO, hook, script, review, anchors, shots, image model badge, and for two of them an edit plan).
// Idempotent: a demo is skipped when a project with the same title exists. Existing projects are never touched.
// ---------------------------------------------------------------------------------------------------------------
const SHOT_S = 8;
const wc = (s) => s.trim().split(/\s+/).length;
const A = (key, kind, name, lockedFeatures, needsReference = true) => ({ key, kind, name, lockedFeatures, needsReference });
const S = (role, link, narration, visual, anchorKeys, continuesPrevious = false, extra = {}) => ({ role, link, narration, visual, anchorKeys, continuesPrevious, ...extra });

const DEMOS = [
  {
    title: "Demo: Saturn would float on water",
    niche: "space_science", format: "short", provider: "flux-local", fallback: 0, edit: "space", language: "en", tone: "wonder, curious",
    idea: "Saturn is so light that it would float on water.",
    promise: "Show why the second-biggest planet is lighter than water, and what that says about what it is made of.",
    audience: "Curious viewers who like quick science facts",
    subjectMode: "subject",
    anchors: [A("saturn", "subject", "Saturn", "Pale gold banded gas giant, wide thin ring system with a dark Cassini gap, no surface"), A("bathtub", "object", "Giant cosmic bathtub", "Round white tub filled with calm blue water, soft studio light", false)],
    styleBible: "Photoreal space documentary look, deep black sky, soft gold light, sharp detail, no text.",
    hook: { type: "visual_shock", line: "A planet that would float in your bathtub.", visual: "Saturn bobbing on a pool of water" },
    facts: [["Saturn's mean density is about 0.687 g/cm3, less than water at 1.0.", "NASA Saturn Fact Sheet"], ["Saturn is mostly hydrogen and helium.", "NASA Solar System Exploration"], ["Saturn is about 95 times the mass of Earth.", "NASA Saturn Fact Sheet"]],
    seo: { keyword: "saturn density", titles: [["curiosity", "Saturn Would Float on Water"], ["question", "Why Is Saturn Lighter Than Water?"], ["shock", "The Planet That Floats"]], tags: ["saturn", "planets", "space facts", "astronomy", "science"] },
    shots: [
      S("hook", null, "Saturn is so light it would float in water.", "Saturn drifting on a calm pool of water", ["saturn", "bathtub"]),
      S("foreshadow", "therefore", "Not a trick: it is lighter than water, and the numbers prove it.", "Saturn, rings glowing, against black space", ["saturn"], true),
      S("body", "but", "But it weighs ninety-five Earths, so how can it float?", "A scale with Earth versus Saturn", ["saturn"]),
      S("rehook", "therefore", "Because it is mostly hydrogen and helium, not rock or iron.", "Swirling gas layers cut open", ["saturn"], true, { loopOpened: "where would it sink?" }),
      S("payoff", "therefore", "Density is mass over size, and Saturn is enormous. So it floats.", "Saturn resting on the water surface", ["saturn", "bathtub"], true, { loopClosed: "float" }),
      S("loop", "but", "You would just need a bathtub wider than Saturn itself.", "Saturn bobbing again, ring tilted", ["saturn", "bathtub"], true),
    ],
  },
  {
    title: "Demo: The canal colonies of Punjab",
    niche: "history_documentary", format: "long", provider: "openai", fallback: 0, edit: "history", language: "en", tone: "serious, warm",
    idea: "The canal colonies of Punjab: the engineering project that reshaped the Indus basin.",
    promise: "Explain how a few canals turned dry plains into the breadbasket of South Asia, and who paid the price.",
    audience: "History fans who like clear, sourced stories",
    subjectMode: "place",
    anchors: [A("upper-bari-doab", "place", "Upper Bari Doab canal", "Wide earthen canal with brick headworks, flat plains, dusk light"), A("surveyor", "character", "Colonial surveyor", "Man in 1890s khaki, pith helmet, theodolite on a wooden tripod")],
    styleBible: "Warm archival documentary look, sepia-leaning colours, film grain, wide plains, soft dusty light.",
    hook: { type: "curiosity_gap", line: "In thirty years, empty desert became the richest farmland in South Asia.", visual: "Dry plain turning green" },
    facts: [["The Upper Bari Doab Canal opened in 1859.", "Punjab Irrigation Department history"], ["The Chenab Canal colony was settled from 1892.", "Imran Ali, The Punjab under Imperialism"], ["Canal colonies brought about 14 million acres under irrigation by 1947.", "Imran Ali, The Punjab under Imperialism"]],
    seo: { keyword: "canal colonies punjab", titles: [["story", "How Punjab's Canals Rebuilt a Land"], ["curiosity", "The Desert That Became a Breadbasket"], ["cost", "Who Paid for Punjab's Canals?"]], tags: ["punjab history", "canal colonies", "indus basin", "british india", "irrigation"] },
    shots: [
      S("hook", null, "In thirty years, empty desert became South Asia's richest farmland.", "Dry plain on the left turning green on the right", ["upper-bari-doab"]),
      S("foreshadow", "therefore", "But the water came with a price few people talk about.", "Canal water cutting across dust", ["upper-bari-doab"], true),
      S("body", "therefore", "In 1859 the Upper Bari Doab Canal opened near Madhopur.", "Brick headworks, water gates opening", ["upper-bari-doab"], false, { beat: 1 }),
      S("rehook", "but", "But rivers do not move on their own. Someone had to survey them.", "Surveyor and theodolite at dawn", ["surveyor", "upper-bari-doab"], false, { beat: 2 }),
      S("side_story", "therefore", "One surveyor walked the plain for months, measuring slope by hand.", "Surveyor writing in a field notebook", ["surveyor"], true, { beat: 3 }),
      S("body", "therefore", "By 1892 the Chenab colony was settled with thousands of farming families.", "Rows of new villages along a canal", ["upper-bari-doab"], false, { beat: 4 }),
      S("payoff", "but", "By 1947, fourteen million acres were irrigated, and local herders lost their land.", "Aerial of green fields beside dry rangeland", ["upper-bari-doab"], false, { beat: 5 }),
      S("bridge", "therefore", "That story shaped the 1947 partition lines. Next, how a border cut canals in two.", "Canal map with a red line drawn through it", ["upper-bari-doab"], true, { beat: 6 }),
    ],
  },
  {
    title: "Demo: The Wow! signal",
    niche: "mystery_horror", format: "short", provider: "flux-local", fallback: 1, edit: null, language: "en", tone: "tense, quiet",
    idea: "The Wow! signal: the strongest candidate ever recorded and every explanation proposed.",
    promise: "Tell what the 1977 signal looked like and why no one has been able to explain it.",
    audience: "Mystery and space viewers",
    subjectMode: "mixed",
    anchors: [A("big-ear", "place", "Big Ear radio telescope", "Huge flat metal reflector with a tilted mesh dish, Ohio field at night"), A("printout", "object", "The Wow! printout", "Green-and-white computer paper with the code 6EQUJ5 circled in red ink")],
    styleBible: "Dark moody night photography, deep blue shadows, cold light, slight grain, no text overlays.",
    hook: { type: "cold_open", line: "In 1977 someone circled a signal and wrote one word: Wow.", visual: "Red pen circling a printout" },
    facts: [["The signal was recorded on 15 August 1977 by the Big Ear telescope.", "Ohio State University Radio Observatory"], ["It lasted 72 seconds, the full time the sky drifted across the beam.", "NAAPO archive"], ["Jerry Ehman wrote Wow! next to the code 6EQUJ5.", "Ehman, 1977 printout"]],
    seo: { keyword: "wow signal", titles: [["cold open", "The Wow! Signal Nobody Can Explain"], ["question", "Was the Wow! Signal Aliens?"], ["fact", "72 Seconds That Haunt Astronomers"]], tags: ["wow signal", "seti", "big ear", "mystery", "space"] },
    shots: [
      S("hook", null, "In 1977 a man circled a signal and wrote one word: Wow.", "Red ink circling code on a printout", ["printout"]),
      S("foreshadow", "therefore", "It lasted seventy-two seconds, and it has never repeated since.", "Night sky over a field, faint radio waves", ["big-ear"], true),
      S("body", "but", "But the telescope only saw it once, in one narrow band of frequency.", "Telescope turning slowly under stars", ["big-ear"]),
      S("rehook", "therefore", "Comets, reflections, a secret satellite: every answer has failed a test.", "Bright dot crossing the night sky", ["big-ear"], true, { loopOpened: "what was it?" }),
      S("payoff", "but", "So the oldest strong candidate stays unexplained. And that is the whole point.", "Printout alone on a dark desk", ["printout"], false, { loopClosed: "unexplained" }),
      S("loop", "therefore", "In 1977 a man circled a signal. He is still waiting for an answer.", "Red ink circling code again", ["printout"], true),
    ],
  },
  {
    title: "Demo: What if the Sun vanished",
    niche: "curiosity_what_if", format: "short", provider: "openai", fallback: 0, edit: null, language: "en", tone: "playful, serious facts",
    idea: "What if the Sun vanished? The first 24 hours.",
    promise: "Walk through the first day after the Sun disappears, minute by minute, with real physics.",
    audience: "What-if and science fans",
    subjectMode: "subject",
    anchors: [A("earth", "subject", "Earth", "Blue ocean planet with white cloud swirls, thin bright atmosphere edge"), A("sun", "subject", "The Sun", "Bright yellow-white sphere, soft corona glow", false)],
    styleBible: "Cinematic space render, strong contrast between light and shadow, crisp stars, no text.",
    hook: { type: "direct_promise", line: "If the Sun vanished, here is the first day.", visual: "The Sun blinking out above Earth" },
    facts: [["Sunlight takes about 8 minutes 20 seconds to reach Earth.", "NASA Sun Fact Sheet"], ["Gravity changes travel at the speed of light, so Earth keeps orbiting for 8 minutes.", "General relativity, Einstein 1915"], ["Earth would fly off in a straight line afterward.", "Newton's first law"]],
    seo: { keyword: "what if the sun disappeared", titles: [["what-if", "What If the Sun Vanished?"], ["time", "The First 24 Hours Without the Sun"], ["fact", "Earth Would Not Notice for 8 Minutes"]], tags: ["what if", "sun", "earth", "space", "physics"] },
    shots: [
      S("hook", null, "If the Sun vanished, here is the first day.", "The Sun blinks out above Earth", ["sun", "earth"]),
      S("foreshadow", "therefore", "For eight minutes, nothing would change. Light and gravity both take time.", "Earth lit, sun missing", ["earth"], true),
      S("body", "but", "But then the sky goes dark, and the temperature starts falling.", "Earth's day side fading to black", ["earth"]),
      S("rehook", "therefore", "Earth would not fall. It would keep flying, in a straight line.", "Earth drifting along a straight path", ["earth"], true, { loopOpened: "where does it go?" }),
      S("payoff", "therefore", "Within a week the surface freezes, and the oceans stay liquid only at the bottom.", "Frozen planet from orbit", ["earth"], true, { loopClosed: "straight line" }),
      S("loop", "but", "And the Sun? It was only ever eight minutes away.", "A faint star where the Sun used to be", ["sun", "earth"], true),
    ],
  },
  {
    title: "Demo: Robo-Rik and the lost map",
    niche: "character_series", format: "short", provider: "flux-local", fallback: 0, edit: null, language: "en", tone: "warm, funny",
    idea: "Robo-Rik, a small robot courier, loses the map on his first delivery day.",
    promise: "A recurring cast episode: Rik finds a way to deliver the parcel without the map.",
    audience: "Families and fans of short animated series",
    subjectMode: "cast",
    anchors: [A("rik", "character", "Rik the robot courier", "Small round teal robot, one big round eye, yellow antenna, orange delivery satchel"), A("pip", "character", "Pip the pigeon", "Grey pigeon with a white wing patch and a tiny red scarf")],
    styleBible: "Soft 3D animated look, bright pastel colours, rounded shapes, gentle light, no text.",
    hook: { type: "pattern_interrupt", line: "Rik lost the map, and the parcel was due in ten minutes.", visual: "Rik holding an empty satchel" },
    facts: [["This is a fictional story; no factual claims are made.", "n/a"]],
    seo: { keyword: "robot cartoon for kids", titles: [["story", "Robo-Rik Loses the Map"], ["question", "Can Rik Deliver Without a Map?"], ["series", "Robo-Rik Episode 1"]], tags: ["robo-rik", "cartoon", "robot", "kids", "series"] },
    shots: [
      S("hook", null, "Rik lost the map, and the parcel was due in ten minutes.", "Rik staring into an empty satchel", ["rik"]),
      S("foreshadow", "therefore", "So he asked the only local who flew everywhere: Pip.", "Pip landing on Rik's antenna", ["rik", "pip"], true),
      S("body", "but", "But Pip only knew the way by smell, and pigeons love bakeries.", "Pip tugging toward a bakery window", ["pip", "rik"]),
      S("rehook", "therefore", "Rik had an idea: follow the bakery, then the clock tower.", "Rik pointing at a clock tower in the distance", ["rik"], true),
      S("payoff", "therefore", "They reached the door with one minute to spare, and a warm loaf.", "Rik handing the parcel to a smiling baker", ["rik", "pip"], true),
      S("loop", "but", "But the parcel was a map. Rik laughed, and the pigeon sighed.", "Rik and Pip looking at the delivered map", ["rik", "pip"], true),
    ],
  },
  {
    title: "Demo: Why the Strait of Hormuz matters",
    niche: "geopolitics_business", format: "long", provider: "flux-local", fallback: 1, edit: null, language: "en", tone: "calm, analytic",
    idea: "Why a narrow strait between Iran and Oman matters to the whole world economy.",
    promise: "Explain what passes through the Strait of Hormuz, why it cannot be easily bypassed, and what a closure would do.",
    audience: "Viewers who follow world news and economics",
    subjectMode: "place",
    anchors: [A("hormuz", "place", "Strait of Hormuz", "Narrow blue channel between brown coastlines, tankers in lanes, hazy light"), A("tanker", "object", "Crude oil tanker", "Very large dark-hulled tanker with a red waterline and white bridge")],
    styleBible: "Clean documentary look, muted blue-grey colours, aerial and map views, no text on frames.",
    hook: { type: "shocking_stat", line: "About one fifth of the world's oil passes through a strait only 33 kilometres wide.", visual: "Aerial of tankers in a narrow lane" },
    facts: [["About 20 percent of global petroleum liquids consumption moves through the strait.", "U.S. Energy Information Administration"], ["The strait is 33 km wide at its narrowest point.", "UN maritime boundary data"], ["Each shipping lane is only about 3 km wide.", "International Maritime Organization"]],
    seo: { keyword: "strait of hormuz", titles: [["stat", "The 33 km Strait That Runs the World's Oil"], ["question", "What If the Strait of Hormuz Closed?"], ["explainer", "Hormuz Explained in Ten Minutes"]], tags: ["strait of hormuz", "oil", "geopolitics", "shipping", "economy"] },
    shots: [
      S("hook", null, "A fifth of the world's oil sails through a strait 33 kilometres wide.", "Aerial of tankers in a narrow channel", ["hormuz", "tanker"]),
      S("foreshadow", "therefore", "And there is almost no way around it. Here is why.", "Map zoom into the strait", ["hormuz"], true),
      S("body", "therefore", "Each shipping lane is only three kilometres wide, so traffic moves in single file.", "Tankers in two narrow lanes", ["tanker", "hormuz"], false, { beat: 1 }),
      S("rehook", "but", "But pipelines should fix this, right? They only cover a small share.", "Pipeline running across desert", ["hormuz"], false, { beat: 2 }),
      S("side_story", "therefore", "During the 1980s Tanker War, shipping insurance prices jumped sharply.", "A tanker with a scorched hull in harbour", ["tanker"], false, { beat: 3 }),
      S("body", "therefore", "Insurers raised war-risk premiums, and the cost reached every petrol pump.", "Gas station price board blurred", ["tanker"], true, { beat: 4 }),
      S("payoff", "therefore", "So a closure would not just stop oil. It would raise the price of everything.", "Dark strait with no ships", ["hormuz"], false, { beat: 5 }),
      S("bridge", "but", "But closure is rare, because everyone loses. Next, who could actually enforce it.", "Naval ship crossing the strait", ["hormuz", "tanker"], true, { beat: 6 }),
    ],
  },
];

const ACCENT_STOP = new Set("the a an and or but of to in on at is are was were it its this that with for as by from so not no".split(" "));
const keywordOf = (text) => {
  const ws = text.replace(/[^\p{L}\p{N}\s']/gu, "").split(/\s+/).filter((w) => w && !ACCENT_STOP.has(w.toLowerCase()));
  return (ws.sort((a, b) => b.length - a.length)[0] || "").toLowerCase();
};
const r3 = (n) => Math.round(n * 1000) / 1000;
const EDIT_STYLES = {
  space: { id: "space", label: "Space (cool, low grain)", grade: { contrast: 1.08, saturation: 1.08, gamma: 0.98, warmth: -0.35 }, vignette: 0.12, grain: 2, accent: "&H00FFD24D&", musicMood: "wonder", musicGainDb: -18, duckDb: 9 },
  history: { id: "history", label: "History (warm, more grain)", grade: { contrast: 1.05, saturation: 0.92, gamma: 1.02, warmth: 0.4 }, vignette: 0.12, grain: 3.8, accent: "&H002FA5FF&", musicMood: "dark", musicGainDb: -18, duckDb: 9 },
};

// A saved EditPlan (src/edit/types.ts) that follows the director rules, built from the demo script. Tests/QA only need it to look real.
function buildDemoEdit(demo) {
  const style = EDIT_STYLES[demo.edit];
  const isShort = demo.format === "short";
  const cycle = [1, 1.12, 1, 1.2];
  let ci = 0;
  let lastPunch = 1;
  const total = demo.shots.length * SHOT_S;
  const beats = demo.shots.map((s, i) => {
    const start = i * SHOT_S;
    const sfx = [];
    let transitionIn = "cut";
    let transitionSeconds = 0;
    let punch = 1;
    let layout;
    let card;
    if (s.role === "hook") punch = 1.12;
    else {
      punch = cycle[ci++ % cycle.length];
      if (punch > 1 && punch === lastPunch) punch = 1;
    }
    lastPunch = punch;
    if (s.role === "rehook") {
      transitionIn = "zoomin";
      transitionSeconds = 0.3;
      sfx.push({ kind: "whoosh", at: r3(start), gainDb: 4, take: 0 });
      layout = "keyword";
      if (!isShort) card = { type: "chapter", text: `Part ${s.beat || i}`, at: 0.4, seconds: 1.4 };
    } else if (s.role === "side_story") {
      transitionIn = "smoothleft";
      transitionSeconds = 0.3;
      sfx.push({ kind: "whoosh", at: r3(start), gainDb: 4, take: 1 });
      layout = "lower_third";
      card = { type: "lower_third", text: "Side story", at: 0.5, seconds: 2.5 };
    } else if (s.role === "payoff") {
      layout = "punch";
      punch = punch > 1 ? punch : 1.12;
      sfx.push({ kind: "impact", at: r3(start + 1 / 30), gainDb: 6, take: 0 });
    } else if (s.role === "hook") layout = "punch";
    else layout = punch > 1 ? "punch" : i % 2 ? "keyword" : "full";
    if (s.role === "hook") lastPunch = 1.12;
    // the riser belongs to the beat before the payoff: 2 s long, 3 frames of silence before the impact
    if (demo.shots[i + 1] && demo.shots[i + 1].role === "payoff") sfx.push({ kind: "riser", at: r3(start + SHOT_S - 2 - 0.1 - 1 / 30 + 0.0), gainDb: 5, take: 0 });
    return {
      shotId: `shot-${i + 1}`, index: i + 1, start, end: start + SHOT_S, role: s.role, layout, punch,
      transitionIn, transitionSeconds, sfx, keyword: keywordOf(s.narration), ...(card ? { card } : {}),
      narrationOffset: s.continuesPrevious && s.role !== "payoff" ? -0.3 : s.role === "payoff" ? 0.5 : 0,
      ...(punch > 1 && s.role !== "hook" ? { punchAt: 4, punchSeconds: 0.35 } : s.role === "hook" ? { punchAt: 0, punchSeconds: 0.4 } : {}),
    };
  });
  const chapters = isShort ? [] : [{ at: 0, title: "Intro" }, ...beats.filter((b) => b.card && b.card.type === "chapter").map((b) => ({ at: b.start, title: b.card.text }))];
  return {
    version: 1, style, format: demo.format, totalSeconds: total, beats,
    music: { file: `assets/audio/music/${style.musicMood}/${style.musicMood}-pad-1.mp3`, mood: style.musicMood, gain: 0.126, entryAt: 0 },
    loop: isShort,
    endCard: isShort ? null : { seconds: 12, text: "Subscribe for the next part" },
    chapters,
    transitionKinds: [...new Set(beats.map((b) => b.transitionIn).filter((t) => t !== "cut"))],
    captionBottomY: 1248, narrationDelay: 0.25,
  };
}

const EDIT_CHECKS = [
  ["hook_first", "§13", "the film opens on the hook with a hard cut and nothing covering the first 2 s"],
  ["transition_kinds", "§02", "at most 3 transition kinds"],
  ["payoff_clean_cut", "§20", "the payoff arrives on a hard cut so the impact lands with the picture"],
  ["punch_cap", "§09", "punch-ins stay at or below 1.2"],
  ["punch_repeat", "§09", "no punch level repeats twice in a row"],
  ["static_frame", "§12", "no shot stays unchanged longer than 8 s"],
  ["layout_variety", "skill anti-slop", "no three identical layouts in a row"],
  ["sfx_density", "§20", "sound effects are at least 3 s apart"],
  ["sfx_repeat", "§20", "no identical sound effect twice in a row"],
  ["sfx_once", "§20", "one riser and one impact per film"],
  ["payoff_impact", "§20", "the payoff lands with an impact one frame after the picture"],
  ["caption_safe_zone", "§04", "captions end at or above y 1248"],
  ["text_hold", "§05", "cards stay up long enough to read (0.5 s + 0.3 s per word)"],
  ["end_clean", "§21", "the film ends on a clean frame (Short) or with a proper end-screen window (long)"],
  ["texture_levels", "§18", "grain and vignette stay subtle"],
  ["short_loop", "§14", "a Short loops back into its first frame"],
  ["music_bed", "§11", "music bed chosen"],
];
const buildDemoEditReview = () => ({
  passed: true,
  rounds: 1,
  checks: EDIT_CHECKS.map(([id, ref, message]) => ({ id, ref, ok: true, message: id === "punch_repeat" ? `fixed automatically: ${message}` : message, ...(id === "punch_repeat" ? { fixed: true } : {}) })),
});

function demoJson(d) {
  const lengthSeconds = d.shots.length * SHOT_S;
  const brief = {
    niche: d.niche, format: d.format, lengthSeconds, promise: d.promise, audience: d.audience, subjectMode: d.subjectMode,
    anchors: d.anchors, styleBible: d.styleBible, tone: d.tone, avoid: ["on-screen text", "real people's faces", "logos"],
  };
  const facts = d.facts.map(([claim, source], i) => ({ id: i + 1, claim, source }));
  const titles = d.seo.titles.map(([angle, title]) => ({ angle, title }));
  const seo = {
    mainKeyword: d.seo.keyword, relatedKeywords: d.seo.tags.slice(0, 3), titles, chosenTitle: titles[0].title,
    description: `${d.promise}\n\n#${d.seo.tags[0].replace(/\s+/g, "")} #shorts`, tags: d.seo.tags, hashtags: [`#${d.seo.tags[0].replace(/\s+/g, "")}`],
    category: "Education",
    thumbnailConcepts: [{ focalSubject: d.hook.visual, words: titles[0].title.split(" ").slice(0, 3).join(" "), anchorKey: d.anchors[0].key }, { focalSubject: d.anchors[0].name, words: "", anchorKey: d.anchors[0].key }],
  };
  const hook = { ...d.hook, score: 78 };
  const script = {
    format: d.format, promise: d.promise, hook: d.hook,
    shots: d.shots.map((s, i) => ({ index: i + 1, role: s.role, link: s.link, narration: s.narration, visual: s.visual, anchorKeys: s.anchorKeys, continuesPrevious: s.continuesPrevious, ...(s.loopOpened ? { loopOpened: s.loopOpened } : {}), ...(s.loopClosed ? { loopClosed: s.loopClosed } : {}), factIds: facts.length ? [Math.min(facts.length, (i % facts.length) + 1)] : [], ...(s.beat ? { beat: s.beat } : {}) })),
  };
  const review = {
    enabled: true, passed: true, rounds: 1,
    checks: [
      { id: "no_first_person", ok: true, message: "The hook line has no first person." },
      { id: d.format === "short" ? "short_structure" : "long_structure", ok: true, message: d.format === "short" ? "Short structure is hook, foreshadow, body, payoff, loop." : "Long structure has re-hooks, a mid side story and a closing bridge." },
      { id: "narration_fits", ok: true, fixed: true, message: "Every line fits its 8 s clip (15 words or fewer)." },
    ],
  };
  return { lengthSeconds, brief, facts, seo, hook, script, review };
}

async function seedDemos(conn) {
  let made = 0;
  for (const d of DEMOS) {
    for (const s of d.shots) if (wc(s.narration) > 15) throw new Error(`demo narration over 15 words: "${s.narration}"`);
    const [ex] = await conn.query("SELECT id FROM projects WHERE title = ?", [d.title]);
    if (ex.length) continue;
    const j = demoJson(d);
    const edit = d.edit ? buildDemoEdit(d) : null;
    const [r] = await conn.query(
      `INSERT INTO projects (idea_prompt, shot_count, shot_duration_seconds, status, stage, run_mode, title, niche, format, language, aspect, length_seconds,
         review_enabled, auto_publish, brief_json, facts_json, seo_json, hook_json, script_json, review_json, chosen_title, image_provider, image_fallback, edit_json, edit_review_json)
       VALUES (?,?,?,'story','planned','plan',?,?,?,?,?,?,1,0,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.idea, d.shots.length, SHOT_S, d.title, d.niche, d.format, d.language, d.format === "short" ? "9:16" : "16:9", j.lengthSeconds,
        JSON.stringify(j.brief), JSON.stringify(j.facts), JSON.stringify(j.seo), JSON.stringify(j.hook), JSON.stringify(j.script), JSON.stringify(j.review),
        j.seo.chosenTitle, d.provider, d.fallback, edit ? JSON.stringify(edit) : null, edit ? JSON.stringify(buildDemoEditReview()) : null,
      ]
    );
    const pid = r.insertId;
    for (const a of d.anchors) {
      await conn.query("INSERT INTO anchors (project_id, `key`, kind, name, locked_features, image_prompt, image_path, status) VALUES (?,?,?,?,?,?,NULL,'pending')", [
        pid, a.key, a.kind, a.name, a.lockedFeatures, `${a.name}. ${a.lockedFeatures}. ${d.styleBible}`,
      ]);
    }
    for (let i = 0; i < d.shots.length; i++) {
      const s = d.shots[i];
      await conn.query(
        `INSERT INTO shots (project_id, shot_number, title, duration, duration_seconds, description, voiceover, narration_text, image_prompt, status,
           beat_role, beat_index, anchor_keys, continues_previous, link, narration_fits)
         VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,1)`,
        [pid, i + 1, `${s.role} ${i + 1}`, `${SHOT_S}s`, SHOT_S, s.visual, s.narration, s.narration, `${s.visual}. ${d.styleBible}`, s.role, s.beat ?? null, JSON.stringify(s.anchorKeys), s.continuesPrevious ? 1 : 0, s.link]
      );
    }
    made++;
  }
  return made;
}

module.exports = { DEMOS, buildDemoEdit, buildDemoEditReview, demoJson };

if (require.main === module) (async () => {
  await migrate();
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "videogenerator",
  });
  let channels = 0;
  let topics = 0;
  let demos = 0;
  try {
    demos = await seedDemos(conn);
    for (const c of CHANNELS) {
      let [rows] = await conn.query("SELECT id FROM channels WHERE slug = ?", [c.slug]);
      if (!rows.length) {
        const [r] = await conn.query(
          "INSERT INTO channels (name, slug, language, niche, style_guide, publish_mode, publish_slots, timezone) VALUES (?,?,?,?,?,?,?,?)",
          [c.name, c.slug, c.language, c.niche, JSON.stringify({ banned_topics: c.banned }), "review", JSON.stringify(c.slots), c.tz]
        );
        rows = [{ id: r.insertId }];
        channels++;
      }
      const id = rows[0].id;
      for (const title of c.language === "en" ? SPACE : HISTORY) {
        const [ex] = await conn.query("SELECT id FROM topics WHERE channel_id = ? AND title = ?", [id, title]);
        if (ex.length) continue;
        await conn.query("INSERT INTO topics (channel_id, title, source, research_notes, status) VALUES (?,?,?,?, 'idea')", [
          id,
          title,
          "claude_research",
          "Idea from the niche research. Every fact must be verified against a primary source before a plan is written.",
        ]);
        topics++;
      }
    }
  } finally {
    await conn.end();
  }
  console.log(`Seeded ${channels} channel(s) and ${topics} topic(s) and ${demos} demo project(s).`);
})().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
