import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ScratchProject } from "./support/project";

// Exploring: the side panel, source, finder, tracing, declutter, proposals,
// export and the presentation stage.

let project: ScratchProject;

const ROUTE_CLJ = `(ns uml-viewer.engine.route
  "Routing.")

(defn- helper [x] (* 2 x))

;; Routes every edge.
(defn route
  [scene]
  (assoc scene :routed (helper 1)))
`;

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  project = new ScratchProject();
  project.write("src/uml_viewer/engine/route.clj", ROUTE_CLJ);
  project.write("proposal.edn", readFileSync(new URL("../packages/core/test/fixtures/painted/uml-viewer-proposal.edn", import.meta.url), "utf8"));
  await project.start();
});

test.afterEach(async () => project.dispose());

const box = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const rail = (page: Page) => page.getByRole("complementary", { name: "Side panel" });

async function open(page: Page, query = "", hash = ""): Promise<void> {
  await page.goto(`${project.url}${query}${hash}`);
  await expect(page.locator(".u-box").first()).toBeVisible();
}

test("the side panel shows the selected class and follows its relationships", async ({ page }) => {
  await open(page, "", "#path=engine");
  await box(page, "engine.route").click();
  const r = rail(page);
  await expect(r.getByRole("heading", { name: "Route" })).toBeVisible();
  await expect(r).toContainText("uml-viewer.engine.route");
  await expect(r).toContainText("Level 1");
  await expect(r.locator("table.stats tbody tr").first()).toContainText("Route");
  await expect(r.getByRole("button", { name: "+ route" })).toBeVisible();
  await r.locator(".rels").getByRole("button", { name: "Compose" }).click();
  await expect(box(page, "engine.compose")).toHaveClass(/u-selected/);
  await expect(r.getByRole("heading", { name: "Compose" })).toBeVisible();
});

test("an op opens its source at the member's line", async ({ page }) => {
  await open(page, "", "#path=engine&sel=engine.route");
  await rail(page).getByRole("button", { name: "+ route" }).click();
  const panel = page.getByRole("dialog", { name: "Source" });
  await expect(panel.locator(".source-title")).toHaveText("src/uml_viewer/engine/route.clj:7");
  await expect(panel.locator(".line.target")).toHaveText("(defn route\n");
  await expect(panel.locator(".line")).toHaveCount(10);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  // The diagram keeps its selection: Escape closed only the panel.
  await expect(box(page, "engine.route")).toHaveClass(/u-selected/);
});

test("a class without a source file says so", async ({ page }) => {
  await open(page, "", "#path=engine&sel=engine.layout");
  await rail(page).getByRole("button", { name: "Source" }).click();
  await expect(page.getByRole("dialog", { name: "Source" })).toContainText("No source file found for Layout.");
});

test("the finder shows any class in its level", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const finder = page.getByRole("dialog", { name: "Find a class" });
  await expect(finder).toBeVisible();
  await page.keyboard.type("layout");
  await expect(finder.getByRole("option").first()).toContainText("Layout");
  await page.keyboard.press("Enter");
  await expect(finder).toBeHidden();
  await expect(page.locator("#breadcrumbs [aria-current]")).toHaveText("engine");
  await expect(box(page, "engine.layout")).toHaveClass(/u-selected/);
});

test("tracing lights up dependents or dependencies, transitively", async ({ page }) => {
  await open(page, "", "#path=engine&sel=engine.route");
  await rail(page).getByRole("button", { name: "Dependents ↑" }).click();
  await expect(page).toHaveURL(/trace=up/);
  await expect(box(page, "engine.compose")).toHaveClass(/u-related/);
  await expect(box(page, "engine.layout")).not.toHaveClass(/u-related/);
  await rail(page).getByRole("button", { name: "Dependencies ↓" }).click();
  await expect(box(page, "engine.layout")).toHaveClass(/u-related/);
  await expect(box(page, "engine.compose")).not.toHaveClass(/u-related/);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/trace=/);
  await expect(box(page, "engine.route")).toHaveClass(/u-selected/);
});

test("declutter modes come from the panel and from D", async ({ page }) => {
  await open(page);
  await rail(page).getByRole("radio", { name: "Counts" }).click();
  await expect(page).toHaveURL(/mode=triangles/);
  await expect(page.locator(".u-edges")).toBeHidden();
  await expect(page.locator(".u-count").first()).toBeVisible();
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/mode=elements/);
  await expect(page.locator(".u-row")).toHaveCount(0);
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect(page).not.toHaveURL(/mode=/);
  await expect(page.locator(".u-row").first()).toBeVisible();
});

test("a proposal regroups the code into its layers, and a layer opens", async ({ page }) => {
  await open(page, "?file=proposal.edn");
  await rail(page).getByLabel("Diagram").selectOption({ label: "2026-10-24 12:00:00" });
  await expect(page.locator(".u-frame")).toHaveCount(4);
  await expect(page.locator("#doc-title")).toHaveText("UML viewer");
  await expect(page.locator("#breadcrumbs [aria-current]")).toHaveText("2026-10-24 12:00:00");
  await page.locator('[data-frame-id="proposal.core"] text').dblclick();
  await expect(page.locator("#breadcrumbs [aria-current]")).toHaveText("Core");
  await expect(page.locator(".u-frame")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".u-frame")).toHaveCount(4);
  await rail(page).getByLabel("Diagram").selectOption({ label: "Code" });
  await expect(page.locator(".u-frame")).toHaveCount(0);
  await expect(page.locator("#breadcrumbs")).toBeEmpty();
});

test("exports the view as SVG and PNG", async ({ page }) => {
  await open(page, "", "#path=engine");
  await page.getByRole("button", { name: "Export diagram" }).click();
  const [svgDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /SVG/ }).click()]);
  expect(svgDownload.suggestedFilename()).toBe("engine.svg");
  const svg = readFileSync(await svgDownload.path(), "utf8");
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain('data-node-id="engine.route"');
  expect(svg).toContain("font/woff2;base64");
  expect(svg).toMatch(/--bg:\s*#|--bg:rgb/);

  await page.keyboard.press("e");
  const [pngDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /PNG/ }).click()]);
  const png = readFileSync(await pngDownload.path());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
});

test("the presentation stage shows the diagram alone", async ({ page }) => {
  await open(page);
  await page.keyboard.press("f");
  await expect(page.locator(".header")).toBeHidden();
  await expect(rail(page)).toBeHidden();
  await page.getByRole("button", { name: "Exit presentation" }).click();
  await expect(page.locator(".header")).toBeVisible();
});
