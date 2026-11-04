import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The live loop end to end: the umlify server on a scratch copy of
// examples/, the built web app in the browser, and files rewritten the way
// producers write them (temp file, then rename).

const cli = new URL("../packages/server/src/cli.ts", import.meta.url).pathname;
const examples = new URL("../examples/", import.meta.url).pathname;

let project: string;
let server: ChildProcess | undefined;
let base: string;

function startServer(port = 0): Promise<string> {
  return new Promise((done, fail) => {
    server = spawn(process.execPath, [cli, "--no-open", "--port", String(port), join(project, "uml-viewer.edn")]);
    let out = "";
    server.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0];
      if (url) done(url);
    });
    server.stderr?.on("data", (chunk: Buffer) => fail(new Error(chunk.toString())));
  });
}

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server?.once("exit", done));
  server.kill("SIGTERM");
  await exited;
}

const ir = () => join(project, "uml-viewer.edn");

function writeAtomically(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), "umlify-e2e-"));
  cpSync(examples, project, { recursive: true });
  base = await startServer();
});

test.afterEach(async () => {
  await stopServer();
  rmSync(project, { recursive: true, force: true });
});

const title = (page: Page) => page.locator("#doc-title");

test("loads the IR with its metrics and lays it out", async ({ page }) => {
  await page.goto(base);
  await expect(page.locator("#live-label")).toHaveText("Live");
  await expect(title(page)).toHaveText("UML viewer");
  await expect(page).toHaveTitle("UML viewer — umlify");
  await expect(page.locator("[data-counts]")).toHaveText("11 boxes · 27 arrows · 2 libraries");
  await expect(page.locator("[data-source]")).toContainText("uml-viewer.edn · 32 metrics files");
});

test("shows an atomically rewritten IR within a second", async ({ page }) => {
  await page.goto(base);
  await expect(title(page)).toHaveText("UML viewer");
  writeAtomically(ir(), readFileSync(ir(), "utf8").replace(':title "UML viewer"', ':title "UML viewer, renamed"'));
  await expect(title(page)).toHaveText("UML viewer, renamed", { timeout: 1000 });
});

test("follows new metrics snapshots", async ({ page }) => {
  await page.goto(base);
  await expect(page.locator("[data-source]")).toContainText("32 metrics files");
  writeAtomically(join(project, ".metrics/mutate/extra.edn"), '{:namespace "uml-viewer.extra" :forms []}');
  await expect(page.locator("[data-source]")).toContainText("33 metrics files", { timeout: 1000 });
});

test("keeps the last good version when the IR breaks, and recovers", async ({ page }) => {
  await page.goto(base);
  await expect(title(page)).toHaveText("UML viewer");
  const good = readFileSync(ir(), "utf8");
  writeAtomically(ir(), good.slice(0, good.length / 2));
  const toast = page.getByRole("alert");
  await expect(toast).toBeVisible({ timeout: 1000 });
  await expect(toast).toContainText("uml-viewer.edn: EDN");
  await expect(title(page)).toHaveText("UML viewer");
  writeAtomically(ir(), good.replace(':title "UML viewer"', ':title "Fixed"'));
  await expect(title(page)).toHaveText("Fixed", { timeout: 1000 });
  await expect(toast).toBeHidden();
});

test("reconnects after a server restart and catches up", async ({ page }) => {
  await page.goto(base);
  await expect(page.locator("#live-label")).toHaveText("Live");
  const port = Number(new URL(base).port);
  await stopServer();
  await expect(page.locator("#live-label")).toHaveText("Reconnecting…");
  writeAtomically(ir(), readFileSync(ir(), "utf8").replace(':title "UML viewer"', ':title "Changed while away"'));
  await startServer(port);
  await expect(page.locator("#live-label")).toHaveText("Live", { timeout: 5000 });
  await expect(title(page)).toHaveText("Changed while away");
});

test("opens another IR file with ?file=", async ({ page }) => {
  await page.goto(`${base}?file=library.edn`);
  await expect(title(page)).toHaveText("Lending library");
  await expect(page.locator("[data-counts]")).toHaveText("10 boxes · 12 arrows");
});
