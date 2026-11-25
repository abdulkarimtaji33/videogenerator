import { describe, expect, it } from "vitest";
import { extractJsonText, parseJsonLoose } from "../src/jsonLoose";

describe("tolerant JSON for model output", () => {
  it("reads valid JSON exactly as before", () => {
    expect(parseJsonLoose('{"a": [1, 2], "b": "x"}')).toEqual({ a: [1, 2], b: "x" });
  });

  it("removes code fences and text around the JSON", () => {
    expect(parseJsonLoose('Here you go:\n```json\n{"shots": [{"index": 1}]}\n```\nHope that helps')).toEqual({ shots: [{ index: 1 }] });
    expect(extractJsonText("noise [1, 2] noise")).toBe("[1, 2]");
  });

  it("repairs a missing comma, a trailing comma and single quotes", () => {
    expect(parseJsonLoose('{"a": 1 "b": 2}')).toEqual({ a: 1, b: 2 });
    expect(parseJsonLoose('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
    expect(parseJsonLoose("{'a': 'x'}")).toEqual({ a: "x" });
  });

  it("repairs a double quote inside a sentence and a raw line break in a string", () => {
    const broken = '{"visual": "The robot says "hello" to the door", "n": 1}';
    expect((parseJsonLoose(broken) as any).n).toBe(1);
    expect((parseJsonLoose('{"t": "line one\nline two"}') as any).t).toContain("line two");
  });

  it("repairs output cut off before the closing brackets", () => {
    const r = parseJsonLoose('{"shots": [{"index": 1, "narration": "hi"}, {"index": 2, "narration": "there"') as any;
    expect(r.shots.length).toBe(2);
  });

  it("still throws on text that has no JSON in it", () => {
    expect(() => parseJsonLoose("I cannot do that.")).toThrow();
  });
});
