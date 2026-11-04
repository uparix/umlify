#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { relativeToRoot, startServer } from "./http.ts";
import { findProjectRoot } from "./project.ts";

const USAGE = `Usage: umlify <ir.edn> [--port 4321] [--no-open] [--browser brave|chrome] [--dev]

Opens the UML diagram described by <ir.edn> in the browser and updates it
whenever the IR or the project's .metrics/ change. Read-only.

  --port <n>        port on 127.0.0.1 (default 4321; 0 picks a free one)
  --no-open         do not open a browser
  --browser <name>  brave or chrome instead of the default browser
  --dev             serve the web app through Vite (umlify development)`;

const BROWSERS: Record<string, string> = { brave: "Brave Browser", chrome: "Google Chrome" };

function openBrowser(url: string, browser: string | undefined): void {
  const app = browser ? BROWSERS[browser] : undefined;
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", app ? ["-a", app, url] : [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : [browser === "chrome" ? "google-chrome" : browser === "brave" ? "brave-browser" : "xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => console.log(`Open ${url} in your browser.`)).unref();
}

function fail(message: string): never {
  console.error(`umlify: ${message}\n\n${USAGE}`);
  process.exit(2);
}

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        port: { type: "string", default: "4321" },
        "no-open": { type: "boolean", default: false },
        browser: { type: "string" },
        dev: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    return fail((e as Error).message);
  }
})();

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const [input] = positionals;
if (!input) fail("no IR file given");
if (!existsSync(input) || !statSync(input).isFile()) fail(`no such file: ${input}`);
if (values.browser && !BROWSERS[values.browser]) fail(`unknown browser: ${values.browser}`);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`bad port: ${values.port}`);

const irPath = realpathSync(input);
const root = findProjectRoot(irPath);
const web = fileURLToPath(new URL("../../web/", import.meta.url));

try {
  const s = await startServer(
    { root, ir: relativeToRoot(root, irPath), dev: values.dev, webRoot: web, webDist: `${web}dist` },
    port,
  );
  const address = s.server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/`;
  console.log(`umlify: ${relativeToRoot(root, irPath)} in ${root}\numlify: ${url}  (Ctrl-C to stop)`);
  if (!values["no-open"]) openBrowser(url, values.browser);
  const stop = () => void s.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  fail(err.code === "EADDRINUSE" ? `port ${port} is in use; pass --port` : err.message);
}
