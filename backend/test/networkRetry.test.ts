import { describe, expect, it } from "vitest";
import { NETWORK_WAITS_S, isTransientNetworkError, retryTransient } from "../src/projectVideo";

const reset = new Error("No clip provider could generate this clip: veoframe failed (page.goto: net::ERR_CONNECTION_RESET at https://veoframe.com/user/generate.php)");
const noSleep = async () => {};

describe("network blips during the clip step", () => {
  it("recognises network failures and nothing else", () => {
    expect(isTransientNetworkError(reset)).toBe(true);
    expect(isTransientNetworkError(new Error("getaddrinfo ENOTFOUND veoframe.com"))).toBe(true);
    expect(isTransientNetworkError(new Error("page.goto: Timeout 30000ms exceeded"))).toBe(true);
    expect(isTransientNetworkError(new Error("Veoframe is signed out. Run `node scripts/veoframe-login.js`"))).toBe(false);
    expect(isTransientNetworkError(new Error("daily quota: 150/150 used"))).toBe(false);
    expect(isTransientNetworkError(new Error("Shot has no image yet"))).toBe(false);
  });

  it("waits and tries again until the network is back", async () => {
    let calls = 0;
    const waits: number[] = [];
    const r = await retryTransient(
      async () => {
        calls++;
        if (calls < 3) throw reset;
        return "clip";
      },
      (_a, w) => waits.push(w),
      NETWORK_WAITS_S,
      noSleep
    );
    expect(r).toBe("clip");
    expect(calls).toBe(3);
    expect(waits).toEqual([30, 60]);
  });

  it("does not retry an error that is not the network's fault", async () => {
    let calls = 0;
    await expect(
      retryTransient(async () => {
        calls++;
        throw new Error("Veoframe is signed out.");
      }, undefined, NETWORK_WAITS_S, noSleep)
    ).rejects.toThrow(/signed out/);
    expect(calls).toBe(1);
  });

  it("gives up after the last wait and reports the real error", async () => {
    let calls = 0;
    await expect(
      retryTransient(async () => {
        calls++;
        throw reset;
      }, undefined, [1, 2], noSleep)
    ).rejects.toThrow(/ERR_CONNECTION_RESET/);
    expect(calls).toBe(3);
  });

  it("is patient: hours of waiting in all (a real outage lasted over 35 minutes)", () => {
    const total = NETWORK_WAITS_S.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(3 * 3600);
    expect(NETWORK_WAITS_S.slice(0, 5)).toEqual([30, 60, 120, 240, 480]); // quick at first, for a short blip
  });
});
