import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ScratchProject } from "./support/project";

// The live loop end to end: the umlify server on a scratch copy of
// examples/, the built web app, and files rewritten as producers do.

let project: ScratchProject;

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  project = new ScratchProject();
  await project.start();
});

test.afterEach(async () => project.dispose());

const title = (page: Page) => page.locator("#doc-title");
const boxes = (page: Page) => page.locator(".u-box");
const chip = (page: Page) => page.locator("#live-chip");

test("loads the IR with its metrics and draws it", async ({ page }) => {
  await page.goto(project.url);
  await expect(page.locator("#live-label")).toHaveText("Live");
  await expect(title(page)).toHaveText("UML viewer");
  await expect(page).toHaveTitle("UML viewer — umlify");
  await expect(boxes(page)).toHaveCount(11);
  await expect(page.locator(".u-oval")).toHaveCount(2);
  await expect(page.locator("[data-edge-id]")).toHaveCount(27);
  await expect(chip(page)).toHaveAttribute("title", /^uml-viewer\.edn · 32 metrics files · 11 boxes, 27 arrows · laid out in \d+ ms$/);
});

test("shows an atomically rewritten IR within a second", async ({ page }) => {
  await page.goto(project.url);
  await expect(title(page)).toHaveText("UML viewer");
  project.editIR((t) => t.replace(':title "UML viewer"', ':title "UML viewer, renamed"'));
  await expect(title(page)).toHaveText("UML viewer, renamed", { timeout: 1000 });
});

test("follows new metrics snapshots", async ({ page }) => {
  await page.goto(project.url);
  await expect(chip(page)).toHaveAttribute("title", /32 metrics files/);
  project.writeAtomically(join(project.dir, ".metrics/mutate/extra.edn"), '{:namespace "uml-viewer.extra" :forms []}');
  await expect(chip(page)).toHaveAttribute("title", /33 metrics files/, { timeout: 1000 });
});

test("keeps the last good version when the IR breaks, and recovers", async ({ page }) => {
  await page.goto(project.url);
  await expect(boxes(page)).toHaveCount(11);
  const good = project.read();
  project.editIR(() => good.slice(0, good.length / 2));
  const toast = page.getByRole("alert");
  await expect(toast).toBeVisible({ timeout: 1000 });
  await expect(toast).toContainText("uml-viewer.edn: EDN");
  await expect(title(page)).toHaveText("UML viewer");
  await expect(boxes(page)).toHaveCount(11);
  project.editIR(() => good.replace(':title "UML viewer"', ':title "Fixed"'));
  await expect(title(page)).toHaveText("Fixed", { timeout: 1000 });
  await expect(toast).toBeHidden();
});

test("reconnects after a server restart and catches up", async ({ page }) => {
  await page.goto(project.url);
  await expect(page.locator("#live-label")).toHaveText("Live");
  const port = Number(new URL(project.url).port);
  await project.stop();
  await expect(page.locator("#live-label")).toHaveText("Reconnecting…");
  project.editIR((t) => t.replace(':title "UML viewer"', ':title "Changed while away"'));
  await project.start(port);
  await expect(page.locator("#live-label")).toHaveText("Live", { timeout: 5000 });
  await expect(title(page)).toHaveText("Changed while away");
});

test("opens another IR file with ?file=", async ({ page }) => {
  await page.goto(`${project.url}?file=library.edn`);
  await expect(title(page)).toHaveText("Lending library");
  await expect(boxes(page)).toHaveCount(10);
  await expect(page.locator(".u-frame")).toHaveCount(3);
});
