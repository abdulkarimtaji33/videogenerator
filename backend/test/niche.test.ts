import { describe, expect, it } from "vitest";
import { PROFILES, checkBlocked, getProfile, pickProfile } from "../src/niche/profiles";
import { HOOK_TYPES } from "../src/hooks/library";

describe("niche profiles", () => {
  it("defines the eleven profiles with valid hook types and sane lengths", () => {
    expect(PROFILES.map((p) => p.id)).toEqual([
      "space_science", "history_documentary", "mystery_horror", "curiosity_what_if", "mythology_folklore",
      "character_series", "anime_story", "geopolitics_business", "nature_animals", "tech_explainer", "generic_explainer",
    ]);
    for (const p of PROFILES) {
      expect(p.preferredHookTypes.length).toBeGreaterThan(0);
      for (const h of p.preferredHookTypes) expect(Object.keys(HOOK_TYPES)).toContain(h);
      expect(p.defaultLengthSeconds.short).toBeGreaterThanOrEqual(25);
      expect(p.defaultLengthSeconds.short).toBeLessThanOrEqual(60); // a Short is at most 60 s; anime stories default to 48 s
      expect(p.defaultLengthSeconds.long).toBeGreaterThanOrEqual(600);
      expect(p.defaultLengthSeconds.long).toBeLessThanOrEqual(1500);
    }
  });

  it("getProfile finds by id", () => {
    expect(getProfile("history_documentary")?.subjectMode).toBe("place");
    expect(getProfile("nope")).toBeUndefined();
  });

  it("picks space_science with subject mode for a space idea", () => {
    const p = pickProfile("Saturn would float in water");
    expect(p.id).toBe("space_science");
    expect(p.subjectMode).toBe("subject");
  });

  it("picks character_series with cast mode for two robot friends", () => {
    const p = pickProfile("two robot friends");
    expect(p.id).toBe("character_series");
    expect(p.subjectMode).toBe("cast");
  });

  it("picks history and mystery with place mode", () => {
    expect(pickProfile("The fall of Rome and the last emperor").subjectMode).toBe("place");
    expect(pickProfile("A haunted abandoned house with a strange legend").id).toBe("mystery_horror");
  });

  it("falls back to generic_explainer for auto, undefined and no match", () => {
    expect(pickProfile("how bread rises").id).toBe("generic_explainer");
    expect(pickProfile("how bread rises", "auto").id).toBe("generic_explainer");
    expect(pickProfile("anything", undefined).id).toBe("generic_explainer");
  });

  it("honours an explicit niche id", () => {
    expect(pickProfile("Saturn floats", "history_documentary").id).toBe("history_documentary");
    expect(pickProfile("Saturn floats", "bogus").id).toBe("space_science");
  });
});

describe("checkBlocked", () => {
  it.each([
    ["bedtime stories for kids about a sleepy bear"],
    ["Bible stories retold with AI"],
    ["financial advice: which stock to buy this week"],
    ["true crime: the murder of a local woman"],
    ["a dying puppy begs for help"],
    ["fake movie trailer for Avengers 7"],
  ])("blocks %s", (idea) => {
    const r = checkBlocked(idea);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it.each([["Saturn would float in water"], ["The fall of Rome"], ["two robot friends build a raft"]])(
    "allows %s",
    (idea) => {
      expect(checkBlocked(idea)).toEqual({ blocked: false });
    },
  );
});
