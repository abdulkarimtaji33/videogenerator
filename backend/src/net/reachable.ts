// A DNS "lookup" for node:http / node:https that only hands out an address this machine can really connect to.
//
// Why: a quick-tunnel name (trycloudflare.com) resolves to a couple of Cloudflare addresses, and on this PC one of them is unreachable
// (measured: 104.16.230.132 times out, 104.16.231.132 works). curl tries the next address; Node asks DNS for ONE address per lookup, so a
// request can land on the dead one and time out. Here every candidate gets a quick TCP connect test, a working address is remembered for
// a few minutes, and a dead one is not used again for a while.

import dns from "dns";
import net from "net";

export interface ReachableOptions {
  /** Port to test (the port of the request). */
  port: number;
  /** Seconds a working address is reused. */
  keepSeconds?: number;
  /** Test connection timeout. */
  testMs?: number;
  /** How many lookups to try before giving up and using whatever DNS says. */
  rounds?: number;
  /** Test hooks. */
  resolve?: (host: string) => Promise<string[]>;
  connects?: (ip: string, port: number, ms: number) => Promise<boolean>;
}

const goodUntil = new Map<string, { ip: string; until: number }>();
const badUntil = new Map<string, number>();
export const resetReachableCache = () => {
  goodUntil.clear();
  badUntil.clear();
};

/**
 * Every IPv4 address of a host. dns.resolve4 (asks the DNS server directly) and dns.lookup (the operating system's resolver) can
 * disagree: measured here, resolve4 gave both Cloudflare addresses and lookup only the dead one, so both are asked and merged.
 */
const defaultResolve = async (host: string) => {
  const out = new Set<string>();
  await new Promise<void>((res) =>
    dns.resolve4(host, (e, a) => {
      if (!e && a) a.forEach((x) => out.add(x));
      res();
    })
  );
  await new Promise<void>((res) =>
    dns.lookup(host, { all: true, family: 4 }, (e, a) => {
      if (!e && a) a.forEach((x) => out.add(x.address));
      res();
    })
  );
  return [...out];
};

const defaultConnects = (ip: string, port: number, ms: number) =>
  new Promise<boolean>((res) => {
    const s = net.connect({ host: ip, port });
    const done = (ok: boolean) => {
      s.destroy();
      res(ok);
    };
    s.setTimeout(ms, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

const isIp = (h: string) => net.isIP(h) !== 0;

/** The address to use for a host: a remembered working one, else the first candidate that connects. null when none could be found. */
export async function pickReachableAddress(host: string, o: ReachableOptions): Promise<string | null> {
  const key = `${host}:${o.port}`;
  const cached = goodUntil.get(key);
  if (cached && cached.until > Date.now()) return cached.ip;
  const resolve = o.resolve ?? defaultResolve;
  const connects = o.connects ?? defaultConnects;
  for (let round = 0; round < (o.rounds ?? 12); round++) {
    for (const ip of await resolve(host)) {
      if ((badUntil.get(ip) ?? 0) > Date.now()) continue;
      if (await connects(ip, o.port, o.testMs ?? 3000)) {
        goodUntil.set(key, { ip, until: Date.now() + (o.keepSeconds ?? 300) * 1000 });
        return ip;
      }
      badUntil.set(ip, Date.now() + 10 * 60_000);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/** Forget a remembered address (call it when a request over it failed). */
export function forgetAddress(host: string, port: number) {
  const key = `${host}:${port}`;
  const c = goodUntil.get(key);
  if (c) badUntil.set(c.ip, Date.now() + 60_000);
  goodUntil.delete(key);
}

/** A `lookup` option for http.request / https.request. IP literals and localhost are left to Node. */
export function reachableLookup(port: number, o: Partial<ReachableOptions> = {}) {
  return (hostname: string, options: any, cb?: any) => {
    const callback = typeof options === "function" ? options : cb;
    const wantAll = typeof options === "object" && options?.all;
    const fallback = () => dns.lookup(hostname, options, callback);
    if (isIp(hostname) || hostname === "localhost") return fallback();
    pickReachableAddress(hostname, { ...o, port })
      .then((ip) => {
        if (!ip) return fallback();
        if (wantAll) callback(null, [{ address: ip, family: 4 }]);
        else callback(null, ip, 4);
      })
      .catch(() => fallback());
  };
}
