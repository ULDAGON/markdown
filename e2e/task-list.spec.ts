import type { Page } from "@playwright/test";
import { article, type Card, clickTool, expect, leavePreview, open, pickHeading, previewBlocks, select, sourceArea, test, type At } from "./helpers";

const boxes = (page: Page) => article(page).locator("input[type=checkbox]");

test("the task tool turns a line into a task item and back", async ({ page }) => {
  await open(page, "test");
  await select(page, "preview", { text: "test", offset: 2 });
  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("- [ ] test");
  await expect(boxes(page)).toHaveCount(1);
  expect(await previewBlocks(page)).toEqual(["test"]);

  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("test");
  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("- [ ] test");
});

test("several selected lines each become a task item", async ({ page }) => {
  await open(page, "one\ntwo\nthree");
  await select(page, "preview", { text: "one" }, { text: "three" });
  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("- [ ] one\n- [ ] two\n- [ ] three");
  await expect(boxes(page)).toHaveCount(3);
});

test("several selected paragraphs each become a task item", async ({ page }) => {
  await open(page, "one\n\ntwo\n\nthree");
  await select(page, "preview", { text: "one" }, { text: "three" });
  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("- [ ] one\n\n- [ ] two\n\n- [ ] three");
  await expect(boxes(page)).toHaveCount(3);
  await expect(boxes(page).first()).toBeEnabled();
});

const roundTrips: { name: string; markdown: string; from: At; to?: At }[] = [
  { name: "one line", markdown: "intro\n\ntest\n\nend", from: { text: "test", offset: 1 } },
  { name: "several lines", markdown: "one\ntwo\nthree", from: { text: "one", offset: 1 }, to: { text: "three", offset: 2 } },
  { name: "a line inside a bullet list", markdown: "- one\n- two\n- three", from: { text: "two", offset: 3 } },
  { name: "the first line of a bullet list", markdown: "- one\n- two", from: { text: "one" } },
  { name: "an existing task item", markdown: "- [ ] open\n- [ ] done", from: { text: "done", offset: 2 } },
  { name: "a nested item", markdown: "- one\n  - two\n- three", from: { text: "two", offset: 1 } },
];

for (const { name, markdown, from, to } of roundTrips) {
  test(`the task tool twice restores the source: ${name}`, async ({ page }) => {
    await open(page, markdown);
    await select(page, "preview", from, to);
    await clickTool(page, "preview", "task list");
    await expect(sourceArea(page)).not.toHaveValue(markdown);
    await clickTool(page, "preview", "task list");
    await expect(sourceArea(page)).toHaveValue(markdown);
    await leavePreview(page);
    await expect(sourceArea(page)).toHaveValue(markdown);
  });
}

test("the caret stays on its text after a block tool", async ({ page }) => {
  await open(page, "- one\n- two");
  await select(page, "preview", { text: "two", offset: 1 });
  await clickTool(page, "preview", "task list");
  await page.keyboard.type("X");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("- one\n- [ ] tXwo");
});

test("a block tool on a new empty line in the preview acts on that line", async ({ page }) => {
  await open(page, "first");
  await select(page, "preview", { text: "first", offset: 5 });
  await page.keyboard.press("Enter");
  await pickHeading(page, "preview", 2);
  await page.keyboard.type("Title");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("first\n\n## Title");
});

test("the task tool on a new empty line makes a task item to type in", async ({ page }) => {
  await open(page, "first");
  await select(page, "preview", { text: "first", offset: 5 });
  await page.keyboard.press("Enter");
  await clickTool(page, "preview", "task list");
  await expect(boxes(page)).toHaveCount(1);
  await page.keyboard.type("new");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("first\n\n- [ ] new");
});

test("inline code toggles, and at a caret an empty span takes the typed text", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await clickTool(page, "preview", "inline code");
  await expect(sourceArea(page)).toHaveValue("alpha `beta` gamma");
  await clickTool(page, "preview", "inline code");
  await expect(sourceArea(page)).toHaveValue("alpha beta gamma");

  await select(page, "preview", { text: "beta", offset: 2 });
  await clickTool(page, "preview", "inline code");
  await page.keyboard.type("X");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha be`X`ta gamma");
});

test("the checkbox sits in the gutter on the x-height of the first line", async ({ page }) => {
  const long = "a long item that wraps onto more lines than one ".repeat(6).trim();
  await open(page, `- [ ] ${long}\n- plain\n  - [ ] nested`);
  for (const text of [long, "nested"]) {
    const item = article(page).locator("li", { hasText: text }).last();
    const geometry = await item.evaluate((li) => {
      const box = li.querySelector(":scope > input")!.getBoundingClientRect();
      const words = document.createRange();
      words.selectNodeContents(li.querySelector(":scope > input")!.nextSibling!);
      const lines = [...words.getClientRects()];
      const style = getComputedStyle(li);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const { actualBoundingBoxAscent: xHeight, fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = context.measureText("x");
      const first = lines[0];
      // The baseline of the first line: the line box centres the font's ascent and descent.
      const baseline = first.top + (first.height - ascent - descent) / 2 + ascent;
      return {
        boxCentre: box.top + box.height / 2,
        xCentre: baseline - xHeight / 2,
        boxRight: box.right,
        textLeft: first.left,
        lineLefts: lines.map((line) => Math.round(line.left)),
        listLeft: li.getBoundingClientRect().left,
      };
    });
    expect(Math.abs(geometry.boxCentre - geometry.xCentre)).toBeLessThan(1);
    expect(geometry.boxRight).toBeLessThan(geometry.textLeft);
    expect(geometry.textLeft).toBeCloseTo(geometry.listLeft, 0);
    expect(new Set(geometry.lineLefts).size).toBe(1);
  }
});

// Parity: a tool that edits the source from the preview gives the markdown that it gives in the markdown card on the same text.
const tools: { label: string; level?: number; inline?: boolean }[] = [
  { label: "inline code", inline: true },
  { label: "heading", level: 2 },
  { label: "quote" },
  { label: "bullet list" },
  { label: "numbered list" },
  { label: "task list" },
  { label: "code block" },
  { label: "table" },
  { label: "horizontal rule" },
];
type Selection = [from: At, to?: At];
// source is the same text in the markdown card for a block tool, which takes the syntax at the edges of a block with it.
const places: { name: string; markdown: string; preview: Selection; source?: Selection }[] = [
  { name: "a caret in a line", markdown: "alpha beta\n\ngamma", preview: [{ text: "beta", offset: 2 }] },
  { name: "lines of a paragraph", markdown: "one\ntwo\nthree\n\nend", preview: [{ text: "two" }, { text: "three" }] },
  { name: "items of a list", markdown: "- one\n- two\n- three", preview: [{ text: "two" }, { text: "three" }] },
  { name: "a whole bold line", markdown: "start\n\n**bold**\n\nend", preview: [{ text: "bold" }, { text: "bold" }], source: [{ text: "**bold**" }, { text: "**bold**" }] },
];

for (const { label, level, inline } of tools) {
  for (const { name, markdown, preview, source = preview } of places) {
    test(`parity of ${label} on ${name}`, async ({ page }) => {
      const run = async (card: Card) => {
        await open(page, markdown);
        await select(page, card, ...(card === "preview" || inline ? preview : source));
        if (level === undefined) await clickTool(page, card, label);
        else await pickHeading(page, card, level);
        // A mark at a caret has no text yet: the markdown card shows its markers, the preview its typing style.
        // Both give the same markdown once there is text.
        if (inline && preview.length === 1) {
          await page.keyboard.type("x");
          if (card === "preview") await leavePreview(page);
        }
        await expect(sourceArea(page)).not.toHaveValue(markdown);
        return sourceArea(page).inputValue();
      };
      const expected = await run("markdown");
      expect(await run("preview")).toBe(expected);
    });
  }
}
