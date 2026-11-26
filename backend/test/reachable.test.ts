import net from "net";
import { beforeEach, describe, expect, it } from "vitest";
import { pickReachableAddress, reachableLookup, resetReachableCache } from "../src/net/reachable";

beforeEach(() => resetReachableCache());

/** A real TCP listener on a free port, to connect to for real. */
async function listener(): Promise<{ port: number; close: () => void }> {
  const srv = net.createServer((s) => s.end());
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { port: (srv.address() as net.AddressInfo).port, close: () => srv.close() };
}

describe("choosing an address that really connects (real sockets)", () => {
  it("skips an address that does not answer and uses the next one", async () => {
    const l = await listener();
    // 10.255.255.1 is a non-routable address: connecting fails or times out, like the dead Cloudflare address did.
    const ip = await pickReachableAddress("tunnel.test", { port: l.port, testMs: 800, resolve: async () => ["10.255.255.1", "127.0.0.1"] });
    expect(ip).toBe("127.0.0.1");
    l.close();
  }, 20000);

  it("remembers the working address instead of testing again", async () => {
    const l = await listener();
    let tests = 0;
    const connects = async (ip: string) => {
      tests++;
      return ip === "127.0.0.1";
    };
    const o = { port: l.port, resolve: async () => ["10.255.255.1", "127.0.0.1"], connects };
    expect(await pickReachableAddress("remember.test", o)).toBe("127.0.0.1");
    const after = tests;
    expect(await pickReachableAddress("remember.test", o)).toBe("127.0.0.1");
    expect(tests).toBe(after); // answered from memory
    l.close();
  }, 20000);

  it("asks DNS again when a lookup only gave dead addresses (each lookup can return another one)", async () => {
    let n = 0;
    const resolve = async () => (++n < 3 ? ["10.255.255.1"] : ["127.0.0.1"]);
    const ip = await pickReachableAddress("rotate.test", { port: 1, resolve, connects: async (ip) => ip === "127.0.0.1", rounds: 6 });
    expect(ip).toBe("127.0.0.1");
    expect(n).toBeGreaterThanOrEqual(1);
  }, 20000);

  it("gives up with null when nothing connects", async () => {
    expect(await pickReachableAddress("dead.test", { port: 1, resolve: async () => ["10.255.255.1"], connects: async () => false, rounds: 2 })).toBeNull();
  }, 20000);
});

describe("the lookup used by http.request", () => {
  it("leaves IP addresses and localhost to Node", async () => {
    const lookup = reachableLookup(80);
    const out = await new Promise<string>((res) => lookup("127.0.0.1", {}, (_e: any, a: string) => res(a)));
    expect(out).toBe("127.0.0.1");
  });

  it("hands back the reachable address in both calling styles of node:http", async () => {
    const l = await listener();
    const lookup = reachableLookup(l.port, { resolve: async () => ["10.255.255.1", "127.0.0.1"], connects: async (ip: string) => ip === "127.0.0.1" });
    const single = await new Promise<any>((res) => lookup("both.test", {}, (_e: any, a: string, f: number) => res({ a, f })));
    expect(single).toEqual({ a: "127.0.0.1", f: 4 });
    resetReachableCache();
    const all = await new Promise<any>((res) => lookup("both.test", { all: true }, (_e: any, a: any) => res(a)));
    expect(all).toEqual([{ address: "127.0.0.1", family: 4 }]);
    l.close();
  }, 20000);
});
