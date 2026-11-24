// Scores candidate niches for the question: "which niche gives the best single Short made with Veo today?".
// The 0-10 scores are my judgment, each tied to measured evidence in docs/Niche-Research-Complete.md
// (sections 4, 5.3 and 6.4). They are inputs you can change; the ranking is just the weighted sum.

export interface NicheCriteria {
  aiVisualFit: number;
  shortsProof: number;
  policySafety: number;
  originality: number;
  oneVideoFeasibility: number;
  hookPotential: number;
}

export const WEIGHTS: NicheCriteria = {
  aiVisualFit: 0.22,
  shortsProof: 0.2,
  policySafety: 0.18,
  originality: 0.1,
  oneVideoFeasibility: 0.16,
  hookPotential: 0.14,
};

export interface NicheEntry {
  id: string;
  name: string;
  scores: NicheCriteria;
  evidence: string;
}

export const NICHES: NicheEntry[] = [
  {
    id: "space_science_curiosity",
    name: "Space and science curiosity (one surprising fact, impossible visuals)",
    scores: { aiVisualFit: 10, shortsProof: 8, policySafety: 9, originality: 8, oneVideoFeasibility: 9, hookPotential: 9 },
    evidence:
      "Strongest Shorts evidence in the research: Zack D. Films (Shorts ratio 0.14), AstroKobi 0.13, Astrum 0.12, Kurzgesagt Shorts median 1.4M. Nobody expects real footage of a planet or the Sun, so Veo imperfections matter least; no faces or text needed; low policy risk when facts are sourced; the same visual style holds across clips.",
  },
  {
    id: "character_comedy_series",
    name: "Original-character AI comedy series",
    scores: { aiVisualFit: 6, shortsProof: 8, policySafety: 4, originality: 7, oneVideoFeasibility: 4, hookPotential: 7 },
    evidence:
      "Neural Viz (ratio 0.5, thin sample) and Bandar Apna Dost (3.3M Shorts median) show reach, but character consistency across clips is hard, voices drift between clips, and repeated situations are named as ineligible in YouTube's policy.",
  },
  {
    id: "cute_ai_animals",
    name: "AI animals and pets",
    scores: { aiVisualFit: 7, shortsProof: 7, policySafety: 3, originality: 3, oneVideoFeasibility: 7, hookPotential: 6 },
    evidence: "Extremely bimodal (52M views for one channel, 96 for a similar one) and the highest enforcement risk in the research.",
  },
  {
    id: "scary_story_cliffhangers",
    name: "Scary story cliffhangers",
    scores: { aiVisualFit: 8, shortsProof: 4, policySafety: 6, originality: 6, oneVideoFeasibility: 6, hookPotential: 8 },
    evidence: "Shorts are weak here (Mr. Nightmare ratio 0.04, Scary Pumpkin 0.02); the format earns its reach in long-form.",
  },
  {
    id: "history_snippets",
    name: "History snippets",
    scores: { aiVisualFit: 6, shortsProof: 3, policySafety: 7, originality: 7, oneVideoFeasibility: 6, hookPotential: 7 },
    evidence: "Shorts ratios of 0.013 to 0.017; faces and crowds are weak spots for AI video; a long-form niche.",
  },
  {
    id: "mythology_snippets",
    name: "Mythology snippets",
    scores: { aiVisualFit: 7, shortsProof: 3, policySafety: 6, originality: 5, oneVideoFeasibility: 7, hookPotential: 6 },
    evidence: "Weak Shorts results in the data (HINDU STORIES ratio 0.0025); heavily saturated with templated content.",
  },
  {
    id: "motivation_quotes",
    name: "Motivation and quotes",
    scores: { aiVisualFit: 3, shortsProof: 2, policySafety: 4, originality: 2, oneVideoFeasibility: 8, hookPotential: 4 },
    evidence: "Ratios of 0.002 to 0.012 even for channels with millions of subscribers; generic by nature.",
  },
  {
    id: "finance_tips",
    name: "Finance tips",
    scores: { aiVisualFit: 4, shortsProof: 3, policySafety: 2, originality: 4, oneVideoFeasibility: 6, hookPotential: 6 },
    evidence: "AI personas giving finance advice are ineligible for monetization under YouTube's policy.",
  },
  {
    id: "tech_ai_tips",
    name: "Tech and AI tips",
    scores: { aiVisualFit: 4, shortsProof: 4, policySafety: 6, originality: 5, oneVideoFeasibility: 4, hookPotential: 6 },
    evidence: "Needs real screens; the strong Shorts in this niche are on-camera personalities (Fireship).",
  },
  {
    id: "kids_moral_stories",
    name: "Kids and moral stories",
    scores: { aiVisualFit: 6, shortsProof: 5, policySafety: 3, originality: 3, oneVideoFeasibility: 5, hookPotential: 4 },
    evidence: "Made-for-kids rules and templated-content risk; mixed ratios (BabyBus 0.19, CoComelon 0.0057).",
  },
];

export interface RankedNiche extends NicheEntry {
  total: number;
}

export function rankNiches(entries: NicheEntry[] = NICHES): RankedNiche[] {
  return entries
    .map((n) => ({
      ...n,
      total: Math.round(
        (Object.keys(WEIGHTS) as (keyof NicheCriteria)[]).reduce((sum, k) => sum + n.scores[k] * WEIGHTS[k], 0) * 100
      ) / 100,
    }))
    .sort((a, b) => b.total - a.total);
}
