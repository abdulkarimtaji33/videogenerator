import http from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpx, multipart } from "../src/net/httpx";

let server: http.Server;
let base = "";
let lastRequest: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: Buffer } | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      if (req.url === "/slow") return; // never answers
      if (req.url === "/audio") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 250, 251, 252]));
      }
      if (req.url === "/gate") {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ detail: { code: "model_licence_required" } }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: Buffer.concat(chunks).toString("utf-8").slice(0, 40) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

describe("httpx (real sockets)", () => {
  it("GET returns status, text and json", async () => {
    const r = await httpx(`${base}/x`, { method: "GET", headers: { "xi-api-key": "k" } });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(lastRequest?.headers["xi-api-key"]).toBe("k");
  });

  it("POST sends the body with the right length and returns binary bytes unchanged", async () => {
    const r = await httpx(`${base}/audio`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "اردو" }) });
    expect(Buffer.from(lastRequest!.body).toString("utf-8")).toBe('{"text":"اردو"}');
    expect(Number(lastRequest!.headers["content-length"])).toBe(Buffer.byteLength('{"text":"اردو"}'));
    expect([...r.body]).toEqual([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 250, 251, 252]);
  });

  it("an error status is not ok but still readable (a licence gate must reach the caller)", async () => {
    const r = await httpx(`${base}/gate`, { method: "POST", body: "{}" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.json().detail.code).toBe("model_licence_required");
  });

  it("gives up on a server that never answers", async () => {
    await expect(httpx(`${base}/slow`, { method: "GET" }, 600)).rejects.toThrow(/timed out/);
  }, 10000);

  it("refuses to connect to a closed port with an error, not a hang", async () => {
    await expect(httpx("http://127.0.0.1:1/x", { method: "GET" }, 5000)).rejects.toBeTruthy();
  }, 10000);
});

describe("multipart bodies", () => {
  it("has the fields and the file with the right boundaries", () => {
    const m = multipart({ model_id: "scribe_v1", language_code: "ur" }, { name: "file", filename: "speech.mp3", type: "audio/mpeg", data: Buffer.from([1, 2, 3]) });
    const text = m.body.toString("latin1");
    const boundary = m.contentType.split("boundary=")[1];
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n`);
    expect(text).toContain('name="file"; filename="speech.mp3"');
    expect(text).toContain("Content-Type: audio/mpeg");
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    expect(m.body.includes(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("arrives intact at a real server", async () => {
    const m = multipart({ a: "b" }, { name: "file", filename: "x.bin", type: "application/octet-stream", data: Buffer.from([9, 8, 7]) });
    await httpx(`${base}/up`, { method: "POST", headers: { "Content-Type": m.contentType }, body: m.body });
    expect(lastRequest!.headers["content-type"]).toContain("multipart/form-data; boundary=");
    expect(lastRequest!.body.includes(Buffer.from([9, 8, 7]))).toBe(true);
  });
});
