// A small HTTP client over node:http / node:https that connects through an address which really answers (see reachable.ts) and gives its
// own timeout. Node's built-in fetch cannot be told which address to use, and on this PC the OS resolver keeps returning one dead
// Cloudflare address for tunnel names, so fetch can never reach them reliably.

import http from "http";
import https from "https";
import { forgetAddress, reachableLookup } from "./reachable";

export interface HttpxResponse {
  ok: boolean;
  status: number;
  body: Buffer;
  text(): string;
  json(): any;
}

export interface HttpxInit {
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export function httpx(url: string, init: HttpxInit = {}, timeoutMs = 30_000): Promise<HttpxResponse> {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  const payload = init.body === undefined ? null : typeof init.body === "string" ? Buffer.from(init.body) : init.body;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { ...(init.headers ?? {}) };
    if (payload) headers["Content-Length"] = payload.length;
    const req = lib.request({ method: init.method ?? "GET", hostname: u.hostname, port, path: u.pathname + u.search, headers, lookup: reachableLookup(port) as any }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, body, text: () => body.toString("utf-8"), json: () => JSON.parse(body.toString("utf-8")) });
      });
      res.on("error", reject);
    });
    // The whole exchange must finish within timeoutMs (a stalled connection never finishes on its own).
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`), { code: "ETIMEDOUT" })), timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      forgetAddress(u.hostname, port); // the remembered address may be the problem: choose again next time
      reject(e);
    });
    req.on("close", () => clearTimeout(timer));
    req.end(payload ?? undefined);
  });
}

/** multipart/form-data body with one file field and some text fields. */
export function multipart(fields: Record<string, string>, file: { name: string; filename: string; type: string; data: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `----vg${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
