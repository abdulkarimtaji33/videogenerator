import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/openai", () => ({ generateText: vi.fn() }));
import { generateText } from "../src/openai";
import { factCheckHooks, generateHooks } from "../src/hooks/engine";
import { lintHook } from "../src/hooks/lint";

const mock = vi.mocked(generateText);
const VISUAL = "A colossal golden ringed planet floating like a beach ball on a calm endless dark ocean at dusk.";
const FACTS = ["Saturn's average density is below water's", "Saturn is mostly hydrogen and helium"];

beforeEach(() => mock.mockReset());

describe("fact check", () => {
  it("marks unsupported hooks and keeps supported ones", async () => {
    mock.mockResolvedValueOnce(JSON.stringify([{ i: 1, supported: true }, { i: 2, supported: false, reason: "air is far lighter than Saturn" }]));
    const out = await factCheckHooks(
      [
        { type: "contrarian", line: "Saturn is lighter than water.", visual: VISUAL },
        { type: "regret", line: "Saturn is almost lighter than air.", visual: VISUAL },
      ],
      FACTS
    );
    expect(out[0].factOk).toBe(true);
    expect(out[1].factOk).toBe(false);
    expect(out[1].factNote).toContain("air");
  });

  it("fails closed when the checker's answer cannot be read", async () => {
    mock.mockResolvedValueOnce("sorry, I cannot do that");
    const out = await factCheckHooks([{ type: "contrarian", line: "Saturn is lighter than water.", visual: VISUAL }], FACTS);
    expect(out[0].factOk).toBe(false);
  });

  it("skips the check when no facts are supplied", async () => {
    const out = await factCheckHooks([{ type: "contrarian", line: "x", visual: VISUAL }], []);
    expect(out[0].factOk).toBeUndefined();
    expect(mock).not.toHaveBeenCalled();
  });

  it("makes an unsupported claim a critical failure in the linter", () => {
    const r = lintHook({ line: "Saturn is almost lighter than air.", visual: VISUAL, format: "short", factOk: false, factNote: "false" });
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "supported_by_facts")?.ok).toBe(false);
  });
});

describe("generateHooks", () => {
  it("never picks an unsupported hook as the best, even if it scores higher", async () => {
    const candidates = [
      { type: "regret", line: "Saturn is almost lighter than air.", visual: VISUAL },
      { type: "contrarian", line: "Saturn is lighter than water.", visual: VISUAL },
    ];
    mock.mockResolvedValueOnce(JSON.stringify(candidates)); // generation
    mock.mockResolvedValueOnce(JSON.stringify([{ i: 1, supported: false, reason: "false" }, { i: 2, supported: true }])); // fact check
    const r = await generateHooks({ topic: "Saturn floats", format: "short", title: "Saturn would float on water", facts: FACTS, optimizeRounds: 0 });
    expect(r.factChecked).toBe(true);
    expect(r.best.line).toBe("Saturn is lighter than water.");
    const bad = r.ranked.find((h) => h.line.includes("air"))!;
    expect(bad.report.passed).toBe(false);
  });

  it("rejects invalid hook types from the generator and reports when no facts were checked", async () => {
    mock.mockResolvedValueOnce(JSON.stringify([{ type: "nonsense", line: "x y z w", visual: VISUAL }, { type: "contrarian", line: "Saturn is lighter than water.", visual: VISUAL }]));
    const r = await generateHooks({ topic: "Saturn floats", format: "short", title: "Saturn would float on water", optimizeRounds: 0 });
    expect(r.factChecked).toBe(false);
    expect(r.ranked.length).toBe(1);
  });
});
