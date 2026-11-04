import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type UmlifyServer } from "../src/http.ts";

let dir: string;
let s: UmlifyServer;
let base: string;

const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

/** The producers' contract: write a temp file in the same folder, then rename it. */
const writeAtomically = (rel: string, text: string) => {
  write(`${rel}.tmp`, text);
  renameSync(join(dir, `${rel}.tmp`), join(dir, rel));
};

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "umlify-http-")));
  write("project/.metrics/crap.edn", "{:entries []}");
  write("project/uml/shop.edn", '{:hierarchical true :title "Shop" :classes [] :edges []}');
  write("project/src/shop/web.clj", "(ns shop.web)");
  write("web/dist/index.html", "<!doctype html><title>umlify</title>");
  s = await startServer(
    { root: join(dir, "project"), ir: "uml/shop.edn", dev: false, webRoot: join(dir, "web"), webDist: join(dir, "web/dist") },
    0,
  );
  const address = s.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
};

describe("api", () => {
  it("describes the project", async () => {
    const r = await get("/api/project");
    expect(JSON.parse(r.text)).toEqual({ name: "project", ir: "uml/shop.edn", files: ["uml/shop.edn"] });
  });

  it("serves .edn files under the root and nothing else", async () => {
    expect((await get("/api/file?path=uml/shop.edn")).text).toContain(':title "Shop"');
    expect((await get("/api/file?path=src/shop/web.clj")).status).toBe(415);
    expect((await get("/api/file?path=../web/dist/index.html")).status).toBe(403);
    expect((await get("/api/file?path=uml/missing.edn")).status).toBe(404);
    expect((await get("/api/file")).status).toBe(400);
  });

  it("serves metrics and source files", async () => {
    expect(JSON.parse((await get("/api/metrics")).text)).toMatchObject({ crap: { path: ".metrics/crap.edn" }, mutate: [] });
    expect((await get("/api/source?path=src/shop/web.clj")).text).toBe("(ns shop.web)");
  });

  it("serves the built app, with index.html for unknown paths", async () => {
    expect((await get("/")).text).toContain("<title>umlify</title>");
    expect((await get("/some/view")).type).toContain("text/html");
  });

  it("is read-only", async () => {
    expect((await fetch(`${base}/api/file?path=uml/shop.edn`, { method: "PUT", body: "{}" })).status).toBe(405);
  });

  it("refuses requests addressed to another host name", async () => {
    const status = await new Promise<number>((done) => {
      const url = new URL(`${base}/api/project`);
      request({ host: "127.0.0.1", port: url.port, path: url.pathname, headers: { host: "evil.example:80" } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      }).end();
    });
    expect(status).toBe(403);
  });
});

describe("events", () => {
  /** Opens the SSE stream and resolves with the first `changed` payload whose paths satisfy `want`. */
  async function nextChange(want: (paths: string[]) => boolean, trigger: () => void): Promise<string[]> {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    setTimeout(trigger, 50);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
        for (const block of buffer.split("\n\n").slice(0, -1)) {
          const data = /^event: changed\ndata: (.*)$/m.exec(block)?.[1];
          if (data) {
            const paths = (JSON.parse(data) as { paths: string[] }).paths;
            if (want(paths)) return paths;
          }
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
    } finally {
      ctrl.abort();
    }
  }

  it("announces an atomically rewritten IR within a second", async () => {
    const started = Date.now();
    const paths = await nextChange(
      (p) => p.includes("uml/shop.edn"),
      () => writeAtomically("project/uml/shop.edn", '{:hierarchical true :title "Shop 2" :classes [] :edges []}'),
    );
    expect(paths).not.toContain("uml/shop.edn.tmp");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("announces a new mutation snapshot", async () => {
    const paths = await nextChange(
      (p) => p.length === 0 || p.some((x) => x.startsWith(".metrics/")),
      () => write("project/.metrics/mutate/shop.web.edn", '{:namespace "shop.web" :forms []}'),
    );
    expect(paths.length === 0 || paths.includes(".metrics/mutate/shop.web.edn")).toBe(true);
  });
});
