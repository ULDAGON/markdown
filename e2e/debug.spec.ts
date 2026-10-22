import type { Page } from "@playwright/test";
import { expect, open, test } from "./helpers";

const MOD = "ControlOrMeta";
const panel = (page: Page) => page.getByRole("complementary", { name: "debug" });
const control = (page: Page, label: string) => panel(page).getByLabel(label, { exact: true });
const html = (page: Page) => page.locator("html");
/** Open a closed group of the panel, as a click on its title does. */
const group = (page: Page, title: string) => panel(page).locator("summary", { hasText: new RegExp(`^${title}$`) }).click();
/** Pick an option of a select of the panel by its label, as a user does. */
async function choose(page: Page, label: string, option: string) {
  await control(page, label).click();
  await panel(page).getByRole("option", { name: option, exact: true }).click();
}
const cssVar = (page: Page, name: string) => page.evaluate((name) => document.documentElement.style.getPropertyValue(name), name);

async function openPanel(page: Page) {
  await open(page, "# Title\n\ntext");
  await page.keyboard.press(`${MOD}+.`);
  await expect(panel(page)).toBeVisible();
}

test("the shortcut and the footer link open the panel; the shortcut, close and Escape close it", async ({ page }) => {
  await openPanel(page);
  await page.keyboard.press(`${MOD}+.`);
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "debug", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "close debug" }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "debug", exact: true }).click();
  await control(page, "card radius").focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("the controls show the values of the stylesheet", async ({ page }) => {
  await openPanel(page);
  await expect(control(page, "page padding value")).toHaveValue("10");
  await expect(control(page, "card border value")).toHaveValue("1");
  await expect(control(page, "hairline strength value")).toHaveValue("10");
  await expect(control(page, "button style")).toHaveAttribute("data-value", "solid");
  await expect(control(page, "hover")).toHaveAttribute("data-value", "tint");
  await expect(panel(page)).toContainText("0 changed");
});

test("a range sets its property on the page, is kept after a reload, and applies before the first paint", async ({ page }) => {
  await openPanel(page);
  await control(page, "card radius value").fill("12");
  expect(await cssVar(page, "--radius-card")).toBe("12px");
  await expect(page.getByRole("region", { name: "markdown", exact: true })).toHaveCSS("border-radius", "12px");
  await expect(panel(page)).toContainText("1 changed");
  // The theme script in the head sets it before React runs.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => ((window as any).early = document.documentElement.style.getPropertyValue("--radius-card"))));
  await page.reload();
  expect(await page.evaluate(() => (window as any).early)).toBe("12px");
});

test("a select sets its data attribute, and the buttons take its style", async ({ page }) => {
  await openPanel(page);
  await choose(page, "button style", "outline");
  await expect(html(page)).toHaveAttribute("data-tool-style", "outline");
  const tool = page.getByRole("region", { name: "markdown", exact: true }).getByRole("button", { name: "bold" });
  expect(await tool.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe("rgba(0, 0, 0, 0)");
  await choose(page, "separators", "off");
  await expect(page.locator(".toolbar .sep").first()).toBeHidden();
});

test("a colour is kept for its theme only", async ({ page }) => {
  await openPanel(page);
  const theme = (await html(page).getAttribute("data-theme"))!;
  const other = theme === "dark" ? "light" : "dark";
  await group(page, "colour");
  await control(page, `accent (${theme})`).fill("#ff6a3d");
  expect(await cssVar(page, "--c-accent")).toBe("#ff6a3d");
  await page.getByRole("switch").click();
  await expect(html(page)).toHaveAttribute("data-theme", other);
  expect(await cssVar(page, "--c-accent")).toBe("");
  await expect(control(page, `accent (${other})`)).toBeVisible();
  await page.getByRole("switch").click();
  expect(await cssVar(page, "--c-accent")).toBe("#ff6a3d");
});

test("reset of one row and reset of all take the values away", async ({ page }) => {
  await openPanel(page);
  await control(page, "card radius value").fill("8");
  await control(page, "gap between cards value").fill("30");
  await panel(page).getByRole("button", { name: "reset card radius" }).click();
  expect(await cssVar(page, "--radius-card")).toBe("");
  expect(await cssVar(page, "--pane-gap")).toBe("30px");
  await panel(page).getByRole("button", { name: "reset", exact: true }).click();
  expect(await cssVar(page, "--pane-gap")).toBe("");
  await expect(panel(page)).toContainText("0 changed");
  expect(await page.evaluate(() => localStorage.getItem("md.debug"))).toBe("{}");
});

test("copy css gives the changed values as css and says so", async ({ page }) => {
  await openPanel(page);
  await page.evaluate(() => {
    (window as any).copied = "";
    navigator.clipboard.writeText = async (text: string) => void ((window as any).copied = text);
  });
  await control(page, "card radius value").fill("8");
  await choose(page, "button style", "outline");
  await panel(page).getByRole("button", { name: "copy css" }).click();
  await expect(page.locator("footer.status .note")).toHaveText("copied 2 values as css.");
  const css = await page.evaluate(() => (window as any).copied);
  expect(css).toContain(":root {\n  --radius-card: 8px;\n}");
  expect(css).toContain('data-tool-style="outline"');
});

test("grain is a masked noise layer behind the cards; it goes above all, turns to dither, or off", async ({ page }) => {
  await openPanel(page);
  const layer = () => page.evaluate(() => {
    const style = getComputedStyle(document.body, "::before");
    return { content: style.content, mask: style.maskImage.slice(0, 30), z: style.zIndex };
  });
  expect(await layer()).toEqual({ content: '""', mask: 'url("data:image/svg+xml,%3Csvg', z: "0" });
  await group(page, "grain");
  await choose(page, "layer", "above all");
  expect((await layer()).z).toBe("20");
  await choose(page, "grain", "dither");
  await expect(control(page, "grain size value")).toHaveValue("4");
  await choose(page, "grain", "off");
  expect((await layer()).content).toBe("none");
});
