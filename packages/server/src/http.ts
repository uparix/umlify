import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, extname, join, relative, sep } from "node:path";
import { insideRoot, listIRFiles, readMetricsFiles } from "./project.ts";
import { watchProject } from "./watch.ts";

/**
 * The local HTTP server. Every endpoint is a read-only GET; changes on disk
 * reach the page as Server-Sent Events.
 *
 * | Path               | Answer                                           |
 * | ------------------ | ------------------------------------------------ |
 * | /api/project       | root name, the IR to open, all IR files          |
 * | /api/file?path=    | text of an `.edn` file under the root            |
 * | /api/metrics       | `.metrics/crap.edn` and mutation snapshots       |
 * | /api/source?path=  | text of a source file under the root             |
 * | /api/events        | SSE: `changed` with the changed `.edn` paths     |
 */

export interface ServerOptions {
  root: string;
  /** The IR file to open first, relative to `root`. */
  ir: string;
  /** Serve the web app through Vite (development), else from `webDist`. */
  dev: boolean;
  webRoot: string;
  webDist: string;
}

export interface UmlifyServer {
  server: Server;
  /** Stop watching and close every connection. */
  close(): Promise<void>;
}

const MAX_SOURCE_BYTES = 2_000_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

const json = (res: ServerResponse, value: unknown) => send(res, 200, JSON.stringify(value), "application/json; charset=utf-8");

/**
 * Only answer requests addressed to this machine by name, so a page on
 * another site cannot reach the server through DNS rebinding.
 */
function localHost(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOCAL_HOSTS.has(name ?? "");
}

function readUnder(root: string, rel: string | null, check: (path: string) => string | undefined): { path: string } | { error: [number, string] } {
  if (!rel) return { error: [400, "path is required"] };
  const path = insideRoot(root, rel);
  if (!path) return { error: [403, "path is outside the project"] };
  if (!existsSync(path) || !statSync(path).isFile()) return { error: [404, "no such file"] };
  const problem = check(path);
  return problem ? { error: [415, problem] } : { path };
}

function serveStatic(dist: string, pathname: string, res: ServerResponse): void {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = rel && insideRoot(dist, rel);
  const path = file && existsSync(file) && statSync(file).isFile() ? file : join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" });
  res.end(readFileSync(path));
}

export async function startServer(opts: ServerOptions, port: number, host = "127.0.0.1"): Promise<UmlifyServer> {
  const clients = new Set<ServerResponse>();
  let vite: { middlewares: (req: IncomingMessage, res: ServerResponse, next: () => void) => void; close(): Promise<void> } | undefined;

  const api = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    switch (url.pathname) {
      case "/api/project":
        return json(res, { name: basename(opts.root), ir: opts.ir, files: listIRFiles(opts.root) });
      case "/api/file": {
        const r = readUnder(opts.root, url.searchParams.get("path"), (p) => (p.endsWith(".edn") ? undefined : "only .edn files"));
        return "error" in r ? send(res, ...r.error) : send(res, 200, readFileSync(r.path, "utf8"));
      }
      case "/api/metrics":
        return json(res, readMetricsFiles(opts.root));
      case "/api/source": {
        const r = readUnder(opts.root, url.searchParams.get("path"), (p) =>
          statSync(p).size > MAX_SOURCE_BYTES ? "file too large" : undefined,
        );
        return "error" in r ? send(res, ...r.error) : send(res, 200, readFileSync(r.path, "utf8"));
      }
      case "/api/events":
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write("retry: 1000\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      default:
        return send(res, 404, "unknown endpoint");
    }
  };

  const server = createServer((req, res) => {
    if (!localHost(req)) return send(res, 403, "umlify only answers on localhost");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "read-only");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) return api(req, res, url);
    if (vite) return vite.middlewares(req, res, () => send(res, 404, "not found"));
    return serveStatic(opts.webDist, url.pathname, res);
  });

  if (opts.dev) {
    const { createServer: createVite } = await import("vite");
    vite = await createVite({ root: opts.webRoot, server: { middlewareMode: true, hmr: { server } }, appType: "spa", logLevel: "warn" });
  } else if (!existsSync(join(opts.webDist, "index.html"))) {
    throw new Error(`The web app is not built (${relative(process.cwd(), opts.webDist) || opts.webDist}). Run npm run build, or start with --dev.`);
  }

  const stopWatching = watchProject(opts.root, (paths) => {
    const event = `event: changed\ndata: ${JSON.stringify({ paths })}\n\n`;
    for (const c of clients) c.write(event);
  });
  // Keep idle connections open through proxies and sleep.
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 15_000);

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => done());
  });

  return {
    server,
    async close() {
      clearInterval(heartbeat);
      stopWatching();
      for (const c of clients) c.end();
      await vite?.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** Path relative to `root` with forward slashes, for URLs and the client. */
export const relativeToRoot = (root: string, path: string) => relative(root, path).split(sep).join("/");
