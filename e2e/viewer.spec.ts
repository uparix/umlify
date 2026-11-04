import { expect, test, type Page } from "@playwright/test";
import { ScratchProject } from "./support/project";

// Reading the diagram: select, drill down and back, pan and zoom, and keep
// all of it across a live reload.

let project: ScratchProject;

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  project = new ScratchProject();
  await project.start();
});

test.afterEach(async () => project.dispose());

const box = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const svg = (page: Page) => page.locator(".diagram-svg");
const zoom = async (page: Page) => Number(await svg(page).getAttribute("data-zoom"));
const transform = (page: Page) => page.locator(".viewport").getAttribute("transform");

async function open(page: Page, hash = ""): Promise<void> {
  await page.goto(`${project.url}${hash}`);
  await expect(page.locator(".u-box").first()).toBeVisible();
}

test("selecting a box keeps its neighbours and fades the rest", async ({ page }) => {
  await open(page);
  await box(page, "engine").click();
  await expect(svg(page)).toHaveAttribute("data-selection", "engine");
  await expect(box(page, "engine")).toHaveClass(/u-selected/);
  await expect(box(page, "domain")).toHaveClass(/u-related/);
  await expect(page).toHaveURL(/#sel=engine$/);
  await page.keyboard.press("Escape");
  await expect(svg(page)).not.toHaveAttribute("data-selection", /.*/);
});

test("double-click drills into a folder; Backspace and Back return", async ({ page }) => {
  await open(page);
  await box(page, "engine").dblclick();
  await expect(box(page, "engine.layout")).toBeVisible();
  await expect(page.locator("#breadcrumbs [aria-current]")).toHaveText("engine");
  await expect(page).toHaveURL(/#path=engine$/);

  await page.keyboard.press("Backspace");
  await expect(box(page, "engine")).toHaveClass(/u-selected/);
  await expect(page.locator("#breadcrumbs")).toBeEmpty();

  await page.goBack();
  await expect(box(page, "engine.layout")).toBeVisible();
  await page.locator("#breadcrumbs button", { hasText: "UML viewer" }).click();
  await expect(box(page, "engine")).toBeVisible();
});

test("a link opens the level and selection it names", async ({ page }) => {
  await open(page, "#path=engine&sel=engine.route");
  await expect(box(page, "engine.route")).toHaveClass(/u-selected/);
});

test("zooms with buttons and keys, fits with 0, and drags to pan", async ({ page }) => {
  await open(page);
  const fitted = await zoom(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(await zoom(page)).toBeCloseTo(fitted * 1.25, 3);
  await page.keyboard.press("-");
  expect(await zoom(page)).toBeCloseTo(fitted, 3);
  await page.keyboard.press("+");
  await page.keyboard.press("0");
  expect(await zoom(page)).toBeCloseTo(fitted, 3);

  const before = await transform(page);
  const area = (await svg(page).boundingBox())!;
  await page.mouse.move(area.x + 20, area.y + 20);
  await page.mouse.down();
  await page.mouse.move(area.x + 120, area.y + 80, { steps: 5 });
  await page.mouse.up();
  expect(await transform(page)).not.toBe(before);
  // A drag is not a click: nothing got selected.
  await expect(svg(page)).not.toHaveAttribute("data-selection", /.*/);
});

test("a live reload keeps level, selection and zoom", async ({ page }) => {
  await open(page, "#path=engine&sel=engine.route");
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await transform(page);

  project.editIR((t) => t.replace(':title "UML viewer"', ':title "Reloaded"'));
  await expect(page.locator("#doc-title")).toHaveText("Reloaded", { timeout: 1000 });
  await expect(page.locator("#breadcrumbs [aria-current]")).toHaveText("engine");
  await expect(box(page, "engine.route")).toHaveClass(/u-selected/);
  expect(await transform(page)).toBe(zoomed);
});

test("a reload that removes the open level falls back to its parent", async ({ page }) => {
  await open(page, "#path=engine");
  // :omit hides engine and everything under it.
  project.editIR((t) => t.replace(" :omit [],", " :omit [:engine],"));
  await expect(page.locator("#breadcrumbs")).toBeEmpty({ timeout: 2000 });
  await expect(box(page, "engine")).toHaveCount(0);
});
