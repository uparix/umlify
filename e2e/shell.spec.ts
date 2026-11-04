import { expect, test } from "@playwright/test";

const html = (page: import("@playwright/test").Page) => page.locator("html");

test("shows the empty viewer in archify chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No diagram loaded" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Diagram actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export diagram" })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
  const loaded = await page.evaluate(async () => (await document.fonts.load('12px "JetBrains Mono"', "Ab")).length);
  expect(loaded).toBeGreaterThan(0);
});

test("follows the OS color scheme on first visit", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await context.close();
});

test("toggles and remembers the theme", async ({ page }) => {
  await page.goto("/?theme=dark");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("t");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("t");
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
});

test("picks a style preset from the menu and with S", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose visual style" }).click();
  await page.getByRole("menuitemradio", { name: "Blueprint" }).click();
  await expect(html(page)).toHaveAttribute("data-preset", "blueprint");
  await expect(page.getByRole("menu")).toBeHidden();
  await page.keyboard.press("s");
  await expect(html(page)).toHaveAttribute("data-preset", "editorial");
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-preset", "editorial");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
});

test("collapses and restores the side panel", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("complementary", { name: "Side panel" });
  await page.getByRole("button", { name: "Collapse side panel" }).click();
  await expect(rail).toBeHidden();
  await page.reload();
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect(rail).toBeVisible();
});
