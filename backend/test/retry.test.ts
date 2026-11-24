import { describe, expect, it } from "vitest";
import { isNetworkError, withRetry } from "../src/retry";

describe("withRetry", () => {
  it("retries a dropped connection, then succeeds", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } });
        return "ok";
      },
      { baseDelayMs: 1 }
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not retry a 400 or a plain error", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw Object.assign(new Error("bad"), { status: 400 }); }, { baseDelayMs: 1 })).rejects.toThrow("bad");
    await expect(withRetry(async () => { n++; throw new Error("logic bug"); }, { baseDelayMs: 1 })).rejects.toThrow("logic bug");
    expect(n).toBe(2);
  });

  it("recognises OpenAI connection errors and nested ECONNRESET", () => {
    expect(isNetworkError(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))).toBe(true);
    expect(isNetworkError(new Error("x", { cause: new Error("y", { cause: Object.assign(new Error("read"), { code: "ECONNRESET" }) }) }))).toBe(true);
    expect(isNetworkError(new Error("nope"))).toBe(false);
  });
});
