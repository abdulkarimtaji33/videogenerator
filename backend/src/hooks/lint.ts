// Rule-based hook checker. Every rule comes from the hook research (sections 2.2, 3.1 and 4 of
// docs/Viral-Video-Research-Complete.md). It scores a hook line out of 100 and explains each failure,
// so a hook can be improved before any video is generated. The weights are my own judgment of the
// relative importance of the research findings; they are not YouTube numbers.

import type { HookFormat, HookType } from "./library";

export interface HookInput {
  line: string;
  /** What the viewer sees while the line is spoken (first frame / first seconds). */
  visual?: string;
  format: HookFormat;
  /** Working title, used to check the hook delivers the title's promise. */
  title?: string;
  type?: HookType;
  /** Hook types used in the last few videos; repeating one is penalised (policy: varied hooks). */
  recentTypes?: HookType[];
  /** Result of checking the hook's claims against verified facts. undefined = not checked. */
  factOk?: boolean;
  factNote?: string;
}

export interface HookCheck {
  id: string;
  ok: boolean;
  weight: number;
  critical?: boolean;
  message: string;
}

export interface HookReport {
  score: number;
  passed: boolean;
  words: number;
  estSeconds: number;
  readingGrade: number;
  checks: HookCheck[];
}

const GREETINGS = [
  /^\s*(hey|hi|hello|yo|what'?s up|welcome( back)?|good (morning|evening))\b/i,
  /\b(in this video|today we('| a)re|today i('| a)m|before we (start|begin)|don'?t forget to|like and subscribe|smash that|subscribe to|my name is)\b/i,
  /^\s*(so|well|um|uh|okay|ok|alright)\b[, ]/i,
];

const STOPWORDS = new Set(
  "a an the and or but if then than that this these those of to in on at by for from with without as is are was were be been being it its it's you your we our i my me they them he she his her not no do does did can could will would should may might must so just very more most less least over under into out up down about after before again also only own same too s t".split(" ")
);

// Contrast and counter-intuitive claims ("lighter than water", "can't", "not") open a gap on their own.
const CURIOSITY_MARKERS = /\b(why|how|what|who|never|always|still|actually|only|nobody|no one|really|wrong|myth|before|until|stop|impossible|hidden|real reason|without|than|can'?t|cannot|won'?t|wouldn'?t|doesn'?t|isn'?t|aren'?t|not|float|vanish|disappear)\b/i;
const COMMON_STARTERS = new Set("the a an this that these those it its what why how when where who if you your imagine think ever did do does is are was were can could would will should one every some most no not there here soon today now".split(" "));
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|billion|trillion|half|double|triple)\b/i;
// Anything that carries writing: AI video renders text badly.
const VISUAL_BANNED = /\b(text|captions?|subtitles?|title card|logo|watermark|words?|lettering|labell?ed|labels?|signs?|charts?|graphs?|diagrams?|posters?|textbooks?|books?|screens?|calendars?|clocks?|symbols?|marked|markings?|numbers?|digital|gauge|dial|display|icons?|arrows?)\b/i;
// People and hands are where AI video artifacts show most.
const VISUAL_PEOPLE = /\b(person|people|man|men|woman|women|child|children|kid|kids|boy|girl|student|students|scientists?|teacher|astronauts?|faces?|crowd|hands?|fingers?|eyes?)\b/i;
// Composited layouts Veo does not produce reliably.
const VISUAL_COMPOSITE = /\b(split[- ]screen|side[- ]by[- ]side|picture[- ]in[- ]picture|collage|multiple panels|before and after)\b/i;
// A meta-promise tells the viewer something will be revealed instead of stating the surprising thing.
const META_PROMISE = /\b(you'?ll (see|learn|find out|know|discover|understand|never)|you will (see|learn|find out|know|discover)|find out|here'?s (why|how|what)|(stay|watch) (till|until|to)|at the end|in (one|this|the next) (minute|video|moment|clip)|soon,|(secret|truth) (will|that|behind)|will make you|let me show|i'?ll show|coming up|you won'?t believe|rethink|do the impossible|why it matters)\b/i;
const FIRST_PERSON = /\b(i|i'd|i'm|i've|i'll|my|me|we|our)\b/i;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function readingGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length || 1);
  const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length === 0) return 0;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
  return Math.round(Math.max(0, grade) * 10) / 10;
}

export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function lintHook(input: HookInput): HookReport {
  const line = input.line.trim();
  const words = line.split(/\s+/).filter(Boolean).length;
  const estSeconds = Math.round((words / 2.7) * 10) / 10; // ~160 words per minute narration
  const grade = readingGrade(line);
  const short = input.format === "short";
  const maxWords = short ? 12 : 28;
  const maxGrade = short ? 6 : 8;
  const checks: HookCheck[] = [];
  const add = (id: string, ok: boolean, weight: number, message: string, critical = false) =>
    checks.push({ id, ok, weight, critical, message });

  const greeting = GREETINGS.some((r) => r.test(line));
  add("no_greeting", !greeting, 20, greeting ? "Starts with a greeting or filler; cut it and open with the specific claim (research: greetings and intros are retention killers)." : "No greeting or filler opener.", greeting);

  const meta = META_PROMISE.test(line);
  add("states_claim", !meta, 15, meta ? "Promises a reveal ('you'll see', 'find out', 'at the end', 'secret will...') instead of stating the surprising fact itself. State the fact; the curiosity comes from the fact." : "States the claim or question itself, not a promise of one.", true);

  if (input.factOk !== undefined) {
    add(
      "supported_by_facts",
      input.factOk,
      20,
      input.factOk ? "Every claim is supported by the verified facts." : `A claim is not supported by the verified facts${input.factNote ? ": " + input.factNote : ""}. Never publish an unverified claim.`,
      true
    );
  }

  const firstPerson = FIRST_PERSON.test(line);
  add("no_first_person", !firstPerson, 5, firstPerson ? "First-person framing implies a human narrator; a faceless factual channel should state the fact directly." : "No first-person framing.");

  const lenOk = words >= 4 && words <= maxWords;
  add("length", lenOk, 15, lenOk ? `${words} words (about ${estSeconds}s spoken).` : `${words} words is outside 4-${maxWords}; a ${short ? "Shorts hook should be about 3 seconds or less" : "long-form first line should land in the first seconds"}.`);

  const gradeOk = grade <= maxGrade;
  add("readability", gradeOk, 10, gradeOk ? `Reading grade ${grade}.` : `Reading grade ${grade} is above ${maxGrade}; use shorter words and sentences (Shorts creators aim for fifth grade or below).`);

  const hasDigit = /\d/.test(line);
  const hasNumberWord = NUMBER_WORDS.test(line);
  // A named subject counts even at the start of the line ("Saturn is lighter than water."), unless the first
  // word is just a common sentence starter ("The", "What", "If"...).
  const first = (line.split(/\s+/)[0] || "").replace(/[^A-Za-z]/g, "");
  const firstIsName = /^[A-Z][a-z]{2,}$/.test(first) && !COMMON_STARTERS.has(first.toLowerCase());
  const hasProper = firstIsName || /(?<!^)(?<![.!?]\s)\b[A-Z][a-z]{2,}\b/.test(line);
  const hasQuestion = /\?/.test(line);
  const hasComparison = /\b\w+er than\b|\bmore than\b|\bless than\b|\b(bigger|smaller|faster|slower|older|younger|hotter|colder|heavier|lighter)\b/i.test(line);
  const specific = hasDigit || hasNumberWord || hasProper || hasQuestion || hasComparison;
  add("specific", specific, 15, specific ? "Contains a concrete number, name or question." : "Add a concrete number, named subject or direct question; vague claims do not hook.");

  const curiosity = hasQuestion || CURIOSITY_MARKERS.test(line);
  add("curiosity", curiosity, 15, curiosity ? "Opens a curiosity gap." : "No curiosity gap; frame it as a question, a contradiction ('but', 'never', 'still') or an unfinished claim.");

  const visual = (input.visual || "").trim();
  const vWords = visual ? visual.split(/\s+/).length : 0;
  const visualOk = vWords >= 6 && vWords <= 45 && !VISUAL_BANNED.test(visual) && (visual.match(/\band\b/gi) || []).length <= 3;
  add("visual_first", visualOk, 10, visualOk ? "Has a simple visual for the first frame." : visual ? "Visual is too long, mentions text, labels, screens or other writing carriers, or has too many subjects; describe one focal subject with no on-screen writing." : "No first-frame visual given; the hook must be understandable on mute.");
  const people = VISUAL_PEOPLE.test(visual);
  add("visual_no_people", !people, 10, people ? "Visual includes people, faces or hands; AI video renders these badly. Use an object, planet or landscape as the single focal subject." : "No people or hands in the first frame.");
  const composite = VISUAL_COMPOSITE.test(visual);
  add("visual_single_scene", !composite, 5, composite ? "Visual asks for a split screen, collage or similar composite; describe one continuous scene." : "One continuous scene.");

  if (input.title) {
    const tw = new Set(contentWords(input.title));
    const overlap = contentWords(line).filter((w) => tw.has(w));
    add("matches_title", overlap.length >= 1, 10, overlap.length >= 1 ? `Shares '${overlap[0]}' with the title.` : "Hook shares no key word with the title; the first seconds must match the title's promise (YouTube: Intro retention).");
  }

  if (input.type && input.recentTypes) {
    const dup = input.recentTypes.slice(-3).includes(input.type);
    add("rotation", !dup, 5, dup ? `Hook type '${input.type}' was used in the last 3 videos; rotate types (templated content is ineligible for monetization).` : "Hook type differs from recent videos.");
  }

  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0);
  const score = Math.round((got / total) * 100);
  const failedCritical = checks.some((c) => c.critical && !c.ok);
  return { score, passed: score >= 80 && !failedCritical, words, estSeconds, readingGrade: grade, checks };
}
