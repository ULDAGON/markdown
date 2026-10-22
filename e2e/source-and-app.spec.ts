import type { Locator, Page } from "@playwright/test";
import { article, clickTool, expect, open, pickHeading, previewBlocks, sourceArea, sourceText, test } from "./helpers";

const MOD = "ControlOrMeta";
const region = (page: Page, name: "markdown" | "preview") => page.getByRole("region", { name, exact: true });
const note = (page: Page) => page.locator("footer.status .note");
const statusNumbers = (page: Page) => page.locator("footer.status .num");

/**
 * A text with its selection: ‹ marks the start, › the end (a ‹ alone is a caret).
 * `plain` is the text without the marks.
 */
function marked(spec: string) {
  const s = spec.indexOf("‹");
  const e = spec.indexOf("›");
  const plain = spec.replace(/[‹›]/g, "");
  return { plain, s, e: e === -1 ? s : e - 1 };
}
const plain = (spec: string) => marked(spec).plain;

async function setSelection(page: Page, s: number, e: number) {
  await sourceArea(page).evaluate((el: HTMLTextAreaElement, [a, b]) => {
    el.focus();
    el.setSelectionRange(a, b);
  }, [s, e]);
}

/** Open the app with the text of a marked spec, with its selection in the source. */
async function openMarked(page: Page, spec: string) {
  const { plain: text, s, e } = marked(spec);
  await open(page, text);
  await setSelection(page, s, e);
  return text;
}

/** Wait for the preview to hold the same top-level blocks as the given markdown renders to. */
async function expectPreview(page: Page, blocks: string[]) {
  await expect.poll(() => previewBlocks(page)).toEqual(blocks);
}

const undo = (page: Page) => page.keyboard.press(`${MOD}+z`);
const redo = (page: Page) => page.keyboard.press(`${MOD}+Shift+z`);

// ---------------------------------------------------------------------------------------------------------- tools

type Case = { name: string; tool: string; spec: string; after: string; twice?: boolean };

// `after` is the text after one click; `twice` (default: no) asserts that a second click restores the text.
const cases: Case[] = [
  // inline tools
  { name: "bold on a caret inserts only the markers", tool: "bold", spec: "he‹llo", after: "he****llo" },
  { name: "bold on an empty document", tool: "bold", spec: "‹", after: "****" },
  { name: "bold on a word", tool: "bold", spec: "a ‹word› b", after: "a **word** b", twice: true },
  { name: "bold on part of a word", tool: "bold", spec: "he‹ll›o", after: "he**ll**o", twice: true },
  { name: "bold on the first line", tool: "bold", spec: "‹one›\ntwo", after: "**one**\ntwo", twice: true },
  { name: "bold on the last line", tool: "bold", spec: "one\n‹two›", after: "one\n**two**", twice: true },
  { name: "bold off on a selection with its markers", tool: "bold", spec: "a ‹**word**› b", after: "a word b" },
  { name: "bold off on the text inside its markers", tool: "bold", spec: "a **‹word›** b", after: "a word b" },
  { name: "bold keeps the spaces of the selection outside the markers", tool: "bold", spec: "a ‹word › b", after: "a **word**  b", twice: true },
  { name: "italic on a word", tool: "italic", spec: "a ‹word› b", after: "a *word* b", twice: true },
  { name: "italic off", tool: "italic", spec: "a _‹word›_ b", after: "a word b" },
  { name: "strikethrough on a word", tool: "strikethrough", spec: "a ‹word› b", after: "a ~~word~~ b", twice: true },
  { name: "inline code on a word", tool: "inline code", spec: "a ‹word› b", after: "a `word` b", twice: true },
  { name: "inline code on an empty document", tool: "inline code", spec: "‹", after: "``" },
  // headings are in their own tests
  // quote
  { name: "quote on a caret", tool: "quote", spec: "on‹e", after: "> one", twice: true },
  { name: "quote on several lines", tool: "quote", spec: "‹one\ntwo\nthree›", after: "> one\n> two\n> three", twice: true },
  { name: "quote on an empty document", tool: "quote", spec: "‹", after: "> " },
  { name: "quote off", tool: "quote", spec: "‹> one\n> two›", after: "one\ntwo" },
  { name: "quote on lines with a blank line between", tool: "quote", spec: "‹a\n\nb›", after: "> a\n> \n> b", twice: true },
  // bullet list
  { name: "bullet list on a caret", tool: "bullet list", spec: "on‹e", after: "- one", twice: true },
  { name: "bullet list on several lines", tool: "bullet list", spec: "‹one\ntwo›", after: "- one\n- two", twice: true },
  { name: "bullet list on lines with a blank line between", tool: "bullet list", spec: "‹a\n\nb›", after: "- a\n\n- b", twice: true },
  { name: "bullet list on the first line", tool: "bullet list", spec: "‹one›\ntwo", after: "- one\ntwo", twice: true },
  { name: "bullet list on the last line", tool: "bullet list", spec: "one\n‹two›", after: "one\n- two", twice: true },
  { name: "bullet list on an empty document", tool: "bullet list", spec: "‹", after: "- " },
  { name: "bullet list off", tool: "bullet list", spec: "‹- a\n- b›", after: "a\nb" },
  { name: "bullet list on a numbered list", tool: "bullet list", spec: "‹1. a\n2. b›", after: "- a\n- b" },
  { name: "bullet list on a task list", tool: "bullet list", spec: "‹- [ ] a\n- [x] b›", after: "- a\n- b" },
  // Off, the item is a paragraph of its own: a blank line keeps it from continuing the item above.
  { name: "bullet list on a nested item", tool: "bullet list", spec: "- a\n  - ‹b›", after: "- a\n\n  b", twice: true },
  // numbered list
  { name: "numbered list on a caret", tool: "numbered list", spec: "on‹e", after: "1. one", twice: true },
  { name: "numbered list on several lines", tool: "numbered list", spec: "‹a\nb\nc›", after: "1. a\n2. b\n3. c", twice: true },
  { name: "numbered list on lines with blank lines between", tool: "numbered list", spec: "‹a\n\nb\nc›", after: "1. a\n\n2. b\n3. c", twice: true },
  { name: "numbered list renumbers a bullet list", tool: "numbered list", spec: "‹- a\n- b\n- c›", after: "1. a\n2. b\n3. c" },
  { name: "numbered list renumbers a mixed selection", tool: "numbered list", spec: "‹1. a\nb\n7. c›", after: "1. a\n2. b\n3. c" },
  { name: "numbered list off", tool: "numbered list", spec: "‹1. a\n2. b›", after: "a\nb" },
  { name: "numbered list off with a parenthesis marker", tool: "numbered list", spec: "‹1) a\n2) b›", after: "a\nb" },
  // A bullet item made numbered is a conversion, not a toggle: a second click takes the number off.
  { name: "numbered list on a nested item", tool: "numbered list", spec: "- a\n  - ‹b›", after: "- a\n  1. b" },
  // task list
  { name: "task list on a caret", tool: "task list", spec: "on‹e", after: "- [ ] one", twice: true },
  { name: "task list on a lone bullet item", tool: "task list", spec: "- ‹a›", after: "- [ ] a" },
  { name: "task list on a lone numbered item", tool: "task list", spec: "1. ‹a›", after: "1. [ ] a", twice: true },
  { name: "task list off on a checked item", tool: "task list", spec: "‹- [x] done›", after: "done" },
  { name: "task list on a nested item", tool: "task list", spec: "- a\n  - ‹b›", after: "- a\n  - [ ] b", twice: true },
  { name: "task list on several lines with a blank line between", tool: "task list", spec: "‹a\n\nb›", after: "- [ ] a\n\n- [ ] b", twice: true },
  // a selection that ends at the start of a line does not touch that line
  { name: "quote leaves the line after a selection that ends at a line start", tool: "quote", spec: "‹one\ntwo\n›three", after: "> one\n> two\nthree", twice: true },
  { name: "bullet list leaves the line after a selection that ends at a line start", tool: "bullet list", spec: "‹one\ntwo\n›three", after: "- one\n- two\nthree", twice: true },
  { name: "numbered list leaves the line after a selection that ends at a line start", tool: "numbered list", spec: "‹one\ntwo\n›three", after: "1. one\n2. two\nthree", twice: true },
  { name: "task list leaves the line after a selection that ends at a line start", tool: "task list", spec: "‹one\ntwo\n›three", after: "- [ ] one\n- [ ] two\nthree", twice: true },
  // link
  { name: "link on a caret", tool: "link", spec: "a ‹ b", after: "a [](https://) b" },
  { name: "link on a word", tool: "link", spec: "a ‹word› b", after: "a [word](https://) b" },
  { name: "link on a selected URL", tool: "link", spec: "see ‹https://example.com›", after: "see [](https://example.com)" },
  // blocks
  { name: "horizontal rule after a paragraph", tool: "horizontal rule", spec: "text‹", after: "text\n\n---\n" },
  { name: "horizontal rule in a document with text after it", tool: "horizontal rule", spec: "one‹\n\ntwo", after: "one\n\n---\n\ntwo" },
  { name: "code block on a selection", tool: "code block", spec: "‹x = 1›", after: "```\nx = 1\n```\n" },
  { name: "code block on an empty document", tool: "code block", spec: "‹", after: "```\n\n```\n" },
  { name: "table on an empty document", tool: "table", spec: "‹", after: "| column | column |\n| --- | --- |\n| cell | cell |\n" },
];

for (const { name, tool, spec, after, twice } of cases) {
  test(name, async ({ page }) => {
    const before = await openMarked(page, spec);
    await clickTool(page, "markdown", tool);
    await expect(sourceArea(page)).toHaveValue(after);
    if (twice) {
      await clickTool(page, "markdown", tool);
      await expect(sourceArea(page)).toHaveValue(before);
    }
  });
}

test("bold on a selection of two paragraphs bolds each of them", async ({ page }) => {
  await openMarked(page, "‹one\n\ntwo›");
  await clickTool(page, "markdown", "bold");
  await expect(article(page).locator("strong")).toHaveText(["one", "two"]);
});

test("italic on part of a word shows as emphasis in the preview", async ({ page }) => {
  await openMarked(page, "he‹ll›o");
  await clickTool(page, "markdown", "italic");
  await expect(article(page).locator("em")).toHaveText("ll");
});

test("a nested numbered list stays nested in the preview", async ({ page }) => {
  await openMarked(page, "‹- a\n  - b\n  - c›");
  await clickTool(page, "markdown", "numbered list");
  await expect(article(page).locator("ol ol > li")).toHaveCount(2);
  await expect(article(page).locator("ol > li")).toHaveCount(3);
});

test("a tool keeps the selection on its text so a second click toggles", async ({ page }) => {
  await openMarked(page, "a ‹word› b");
  await clickTool(page, "markdown", "bold");
  await clickTool(page, "markdown", "italic");
  await expect(sourceArea(page)).toHaveValue("a ***word*** b");
  await clickTool(page, "markdown", "italic");
  await expect(sourceArea(page)).toHaveValue("a **word** b");
  await clickTool(page, "markdown", "bold");
  await expect(sourceArea(page)).toHaveValue("a word b");
});

// ---------------------------------------------------------------------------------------------------------- heading

const headingCases: { name: string; level: number; spec: string; after: string }[] = [
  { name: "h1 on a caret line", level: 1, spec: "on‹e", after: "# one" },
  { name: "h6 on a word", level: 6, spec: "‹one› two", after: "###### one two" },
  { name: "h3 replaces h1", level: 3, spec: "# ‹one›", after: "### one" },
  { name: "text removes h2", level: 0, spec: "## o‹ne", after: "one" },
  { name: "text removes h6", level: 0, spec: "###### o‹ne", after: "one" },
  { name: "h2 on several lines", level: 2, spec: "‹one\ntwo›", after: "## one\n## two" },
  { name: "h2 on lines with a blank line between", level: 2, spec: "‹one\n\ntwo›", after: "## one\n\n## two" },
  { name: "h1 on an empty document", level: 1, spec: "‹", after: "# " },
  { name: "h1 on the last line", level: 1, spec: "one\ntw‹o", after: "one\n# two" },
  { name: "h1 on the first line", level: 1, spec: "o‹ne\ntwo", after: "# one\ntwo" },
  { name: "h1 leaves the line after a selection that ends at a line start", level: 1, spec: "‹one\n›two", after: "# one\ntwo" },
  { name: "a hash without a space is no heading", level: 2, spec: "#ta‹g", after: "## #tag" },
];

for (const { name, level, spec, after } of headingCases) {
  test(`heading picker: ${name}`, async ({ page }) => {
    await openMarked(page, spec);
    await pickHeading(page, "markdown", level);
    await expect(sourceArea(page)).toHaveValue(after);
  });
}

test("the heading picker follows the caret line", async ({ page }) => {
  const lines = ["# a", "## b", "### c", "#### d", "##### e", "###### f", "text", "####### seven", "#nospace", ""];
  await open(page, lines.join("\n"));
  const picker = region(page, "markdown").getByRole("combobox", { name: "heading" });
  await setSelection(page, 0, 0);
  await page.keyboard.press("ControlOrMeta+Home");
  const expected = [1, 2, 3, 4, 5, 6, 0, 0, 0, 0];
  for (const level of expected) {
    await expect(picker).toHaveAttribute("data-value", String(level));
    await page.keyboard.press("ArrowDown");
  }
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
  await expect(picker).toHaveAttribute("data-value", "6");
});

test("the heading picker follows a click into another line", async ({ page }) => {
  await open(page, "# one\n\ntwo\n\n### three");
  const picker = region(page, "markdown").getByRole("combobox", { name: "heading" });
  const box = (await sourceArea(page).boundingBox())!;
  const lineHeight = await sourceArea(page).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  const padTop = await sourceArea(page).evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  const lineY = (n: number) => box.y + padTop + lineHeight * (n + 0.5);
  await page.mouse.click(box.x + 40, lineY(4));
  await expect(picker).toHaveAttribute("data-value", "3");
  await page.mouse.click(box.x + 40, lineY(0));
  await expect(picker).toHaveAttribute("data-value", "1");
  await page.mouse.click(box.x + 40, lineY(2));
  await expect(picker).toHaveAttribute("data-value", "0");
});

test("the heading picker text option reads text and the options are text, h1 to h6", async ({ page }) => {
  await open(page, "x");
  await expect(region(page, "markdown").locator("[role=option]")).toHaveText(["text", "h1", "h2", "h3", "h4", "h5", "h6"]);
});

// ---------------------------------------------------------------------------------------------------------- keys

test("the keys bold, italic and link work in the source", async ({ page }) => {
  await openMarked(page, "a ‹word› b");
  await page.keyboard.press(`${MOD}+b`);
  await expect(sourceArea(page)).toHaveValue("a **word** b");
  await page.keyboard.press(`${MOD}+b`);
  await expect(sourceArea(page)).toHaveValue("a word b");
  await page.keyboard.press(`${MOD}+i`);
  await expect(sourceArea(page)).toHaveValue("a *word* b");
  await page.keyboard.press(`${MOD}+i`);
  await page.keyboard.press(`${MOD}+k`);
  await expect(sourceArea(page)).toHaveValue("a [word](https://) b");
  // The URL placeholder is selected: typing replaces it.
  await page.keyboard.type("https://example.com");
  await expect(sourceArea(page)).toHaveValue("a [word](https://example.com) b");
  await expect(article(page).locator("a")).toHaveAttribute("href", "https://example.com");
});

test("a key tool makes one undo step", async ({ page }) => {
  await openMarked(page, "a ‹word› b");
  await page.keyboard.press(`${MOD}+b`);
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("a word b");
});

// ---------------------------------------------------------------------------------------------------------- Enter

type Enter = { name: string; spec: string; after: string; key?: string };
const enters: Enter[] = [
  { name: "a bullet item starts the next bullet", spec: "- a‹", after: "- a\n- X" },
  { name: "a star bullet keeps its marker", spec: "* a‹", after: "* a\n* X" },
  { name: "a numbered item takes the next number", spec: "9. a‹", after: "9. a\n10. X" },
  { name: "a numbered item keeps its parenthesis", spec: "1) a‹", after: "1) a\n2) X" },
  { name: "a task item starts an unchecked task", spec: "- [ ] a‹", after: "- [ ] a\n- [ ] X" },
  { name: "a checked task item starts an unchecked task", spec: "- [x] a‹", after: "- [x] a\n- [ ] X" },
  { name: "a quote line starts the next quote line", spec: "> a‹", after: "> a\n> X" },
  { name: "a nested item starts a nested item", spec: "- a\n  - b‹", after: "- a\n  - b\n  - X" },
  { name: "an item that is split in the middle", spec: "- a‹b", after: "- a\n- Xb" },
  { name: "an empty bullet item ends the list", spec: "- a\n- ‹", after: "- a\nX" },
  { name: "an empty numbered item ends the list", spec: "1. a\n2. ‹", after: "1. a\nX" },
  { name: "an empty task item ends the list", spec: "- [ ] ‹", after: "X" },
  { name: "an empty quote line ends the quote", spec: "> a\n> ‹", after: "> a\nX" },
  { name: "an empty nested item ends the list", spec: "- a\n  - ‹", after: "- a\nX" },
  { name: "Enter right after the marker of an item with text keeps the text", spec: "- ‹a", after: "- \n- Xa" },
  { name: "a plain line gets a plain line break", spec: "hello‹", after: "hello\nX" },
  { name: "Shift+Enter in a list is a plain line break", spec: "- a‹", after: "- a\nX", key: "Shift+Enter" },
  { name: "Shift+Enter after a number is a plain line break", spec: "1. a‹", after: "1. a\nX", key: "Shift+Enter" },
];

for (const { name, spec, after, key = "Enter" } of enters) {
  test(`Enter: ${name}`, async ({ page }) => {
    await openMarked(page, spec);
    await page.keyboard.press(key);
    await page.keyboard.type("X");
    await expect(sourceArea(page)).toHaveValue(after);
  });
}

test("Enter in a list is one undo step", async ({ page }) => {
  await openMarked(page, "- a‹");
  await page.keyboard.press("Enter");
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("- a");
});

test("Enter on an empty item is one undo step", async ({ page }) => {
  await openMarked(page, "- a\n- ‹");
  await page.keyboard.press("Enter");
  await expect(sourceArea(page)).toHaveValue("- a\n");
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("- a\n- ");
});

test("Enter with a selection inside a list item replaces the selection", async ({ page }) => {
  await openMarked(page, "- a‹bc›d");
  await page.keyboard.press("Enter");
  await expect(sourceArea(page)).toHaveValue("- a\nd");
});

test("Enter continues the list and the preview shows the new item once it has text", async ({ page }) => {
  await openMarked(page, "- one‹");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await expect(article(page).locator("li")).toHaveText(["one", "two"]);
});

// ---------------------------------------------------------------------------------------------------------- undo

test("undo and redo go back one tool at a time", async ({ page }) => {
  await openMarked(page, "‹alpha beta›");
  const steps = ["alpha beta"];
  await clickTool(page, "markdown", "bold");
  steps.push("**alpha beta**");
  await clickTool(page, "markdown", "quote");
  steps.push("> **alpha beta**");
  await clickTool(page, "markdown", "bullet list");
  steps.push("> - **alpha beta**");
  await pickHeading(page, "markdown", 2);
  steps.push("> - ## **alpha beta**");
  await expect(sourceArea(page)).toHaveValue(steps.at(-1)!);

  for (let i = steps.length - 2; i >= 0; i--) {
    await undo(page);
    await expect(sourceArea(page)).toHaveValue(steps[i]);
  }
  await expectPreview(page, ["alpha beta"]);
  for (let i = 1; i < steps.length; i++) {
    await redo(page);
    await expect(sourceArea(page)).toHaveValue(steps[i]);
  }
});

test("undo goes back past two tools of the same kind one at a time", async ({ page }) => {
  await openMarked(page, "‹a›\nb\nc");
  await clickTool(page, "markdown", "bullet list");
  await setSelection(page, 4, 5);
  await clickTool(page, "markdown", "bullet list");
  await expect(sourceArea(page)).toHaveValue("- a\n- b\nc");
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("- a\nb\nc");
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("a\nb\nc");
});

test("the preview follows undo and redo", async ({ page }) => {
  await openMarked(page, "‹one›");
  await clickTool(page, "markdown", "bold");
  await expect(article(page).locator("strong")).toHaveText("one");
  await undo(page);
  await expect(article(page).locator("strong")).toHaveCount(0);
  await redo(page);
  await expect(article(page).locator("strong")).toHaveText("one");
});

test("the preview shows the source after each tool", async ({ page }) => {
  await openMarked(page, "‹one\ntwo›");
  await clickTool(page, "markdown", "numbered list");
  await expect(article(page).locator("ol > li")).toHaveText(["one", "two"]);
  await undo(page);
  await expectPreview(page, ["one two"]);
  await pickHeading(page, "markdown", 1);
  await expect(article(page).locator("h1")).toHaveCount(2);
});

// ---------------------------------------------------------------------------------------------------------- clear

test("clear empties the source and the preview, says so, and undo brings the text back", async ({ page }) => {
  await open(page, "# Title\n\nbody");
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await expect(sourceArea(page)).toHaveValue("");
  await expect(note(page)).toContainText("cleared");
  await expect(article(page).locator("h1")).toHaveCount(0);
  await expect(statusNumbers(page)).toContainText("0 characters");

  await undo(page);
  await expect(sourceArea(page)).toHaveValue("# Title\n\nbody");
  await expect(article(page).locator("h1")).toHaveText(/^Title/);
  await redo(page);
  await expect(sourceArea(page)).toHaveValue("");
});

test("clear on an empty document does not fail and a later undo keeps the document empty", async ({ page }) => {
  await open(page, "");
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await expect(note(page)).toContainText("cleared");
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("");
});

test("clear is kept after a reload", async ({ page }) => {
  await open(page, "something");
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await page.reload();
  await expect(sourceArea(page)).toHaveValue("");
});

test("the note of clear goes away by itself", async ({ page }) => {
  await open(page, "something");
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await expect(note(page)).toContainText("cleared");
  await expect(note(page)).toHaveText("", { timeout: 6000 });
});

// ---------------------------------------------------------------------------------------------------------- drop

type Dropped = { name: string; content: string };

/** Drop a file on an element, as the browser does: a drop event with a DataTransfer that holds a File. */
async function drop(target: Locator, { name, content }: Dropped) {
  const dataTransfer = await target.page().evaluateHandle(({ name, content }) => {
    const data = new DataTransfer();
    data.items.add(new File([content], name, { type: "text/markdown" }));
    return data;
  }, { name, content });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

for (const card of ["markdown", "preview"] as const) {
  test(`a file dropped on the ${card} card replaces the text and shows a note`, async ({ page }) => {
    await open(page, "old text");
    await drop(region(page, card), { name: "dropped.md", content: "# Dropped\n\nfrom a file" });
    await expect(sourceArea(page)).toHaveValue("# Dropped\n\nfrom a file");
    await expect(note(page)).toContainText("opened dropped.md");
    await expect(article(page).locator("h1")).toHaveText(/^Dropped/);
    await expect(page.locator("main.panes")).not.toHaveAttribute("data-drop", /.*/);
  });

  test(`undo after a file dropped on the ${card} card brings the old text back`, async ({ page }) => {
    await open(page, "old text");
    await drop(region(page, card), { name: "dropped.md", content: "new text" });
    await expect(sourceArea(page)).toHaveValue("new text");
    await undo(page);
    await expect(sourceArea(page)).toHaveValue("old text");
    await redo(page);
    await expect(sourceArea(page)).toHaveValue("new text");
  });
}

test("a dropped file with CRLF line breaks is normalised", async ({ page }) => {
  await open(page, "old");
  await drop(region(page, "markdown"), { name: "win.md", content: "a\r\nb\r\n" });
  await expect(sourceArea(page)).toHaveValue("a\nb\n");
  await expect(statusNumbers(page)).toContainText("4 characters");
  const stored = await page.evaluate(() => localStorage.getItem("md.text"));
  expect(stored).toBe("a\nb\n");
});

test("a dropped file is kept after a reload", async ({ page }) => {
  await open(page, "old");
  await drop(region(page, "markdown"), { name: "kept.md", content: "kept" });
  await expect(sourceArea(page)).toHaveValue("kept");
  await page.reload();
  await expect(sourceArea(page)).toHaveValue("kept");
});

test("an empty file dropped on the card clears the text and can be undone", async ({ page }) => {
  await open(page, "old");
  await drop(region(page, "markdown"), { name: "empty.md", content: "" });
  await expect(sourceArea(page)).toHaveValue("");
  await undo(page);
  await expect(sourceArea(page)).toHaveValue("old");
});

test("text dragged into the textarea is not taken for a file", async ({ page }) => {
  await open(page, "one");
  const result = await sourceArea(page).evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "dragged");
    const over = new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true });
    const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
    // dispatchEvent returns false when a handler called preventDefault: the app must leave a text drop to the browser.
    return { overNotCancelled: el.dispatchEvent(over), dropNotCancelled: el.dispatchEvent(drop) };
  });
  expect(result).toEqual({ overNotCancelled: true, dropNotCancelled: true });
  await expect(sourceArea(page)).toHaveValue("one");
  await expect(note(page)).not.toContainText("opened");
  await expect(page.locator("main.panes")).not.toHaveAttribute("data-drop", /.*/);
});

test("a file drag over the cards marks the drop and leaving removes the mark", async ({ page }) => {
  await open(page, "one");
  const panes = page.locator("main.panes");
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "x.md"));
    return data;
  });
  await sourceArea(page).dispatchEvent("dragover", { dataTransfer });
  await expect(panes).toHaveAttribute("data-drop", "true");
  await panes.dispatchEvent("dragleave", { dataTransfer });
  await expect(panes).not.toHaveAttribute("data-drop", /.*/);
});

// ---------------------------------------------------------------------------------------------------------- persistence

test("the first visit shows the sample", async ({ page }) => {
  await page.goto("/");
  await expect(sourceArea(page)).toHaveValue(/^# Hello/);
  await expect(article(page).locator("h1")).toHaveText(/^Hello/);
});

test("typed text is kept after a reload", async ({ page }) => {
  await page.goto("/");
  await expect(article(page).locator("h1")).toHaveText(/^Hello/); // the app has loaded its text and listens
  await sourceArea(page).fill("typed *text*");
  await page.reload();
  await expect(sourceArea(page)).toHaveValue("typed *text*");
  await expect(article(page).locator("em")).toHaveText("text");
});

test("a document is not rewritten when the app opens it", async ({ page }) => {
  const texts = ["a  \nb", "* item\n* item", "Title\n=====\n\n<b>html</b>\n\n1) x\n3) y", "| a | b |\n|--|--|\n| 1 | 2 |", "text\\\nmore\n\n\n\nend  "];
  for (const text of texts) {
    await open(page, text);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => localStorage.getItem("md.text"))).toBe(text);
    await expect(sourceArea(page)).toHaveValue(text);
  }
});

test("a storage that refuses to write shows one note and the app keeps working", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.goto("/");
  await sourceArea(page).fill("# kept in memory");
  await expect(note(page)).toContainText("not saved");
  await expect(article(page).locator("h1")).toHaveText(/^kept in memory/);
  await sourceArea(page).press("End");
  await page.keyboard.type("!");
  await expect(note(page)).toContainText("not saved");
  await expect(note(page)).toHaveText("", { timeout: 6000 });

  // The user knows: the next edit shows no second note.
  await page.keyboard.type("?");
  await page.waitForTimeout(500);
  await expect(note(page)).not.toContainText("not saved");
  await expect(sourceArea(page)).toHaveValue("# kept in memory!?");

  // Tools and the theme switch still work.
  await setSelection(page, 2, 6);
  await clickTool(page, "markdown", "bold");
  await expect(sourceArea(page)).toHaveValue("# **kept** in memory!?");
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole("switch").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme!);
});

// ---------------------------------------------------------------------------------------------------------- theme

test("the theme switch toggles the theme, keeps it, and aria-checked matches", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const toggle = page.getByRole("switch");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => localStorage.getItem("md.theme"))).toBe("light");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => localStorage.getItem("md.theme"))).toBe("dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("the first visit follows the system theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

test("the theme switch changes the colours of the page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await page.getByRole("switch").click();
  await expect.poll(background).not.toBe(dark);
});

test("the theme switch can be used with the keyboard", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("switch").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

// ---------------------------------------------------------------------------------------------------------- status bar

const counts: [name: string, text: string, status: RegExp][] = [
  ["empty text", "", /^0 characters · — read$/],
  ["one character", "a", /^1 character · 1 min read$/],
  ["a letter with an accent is one character", "é", /^1 character · 1 min read$/],
  ["a Japanese word", "日本語", /^3 characters · 1 min read$/],
  ["an emoji is one character", "😀", /^1 character · 1 min read$/],
  ["a flag is one character", "🇩🇪", /^1 character · 1 min read$/],
  ["only white space has no reading time", "  \n ", /^4 characters · — read$/],
  ["200 words read in one minute", "word ".repeat(200), /^1,000 characters · 1 min read$/],
  ["201 words read in two minutes", "word ".repeat(201), /^1,005 characters · 2 min read$/],
  ["1300 characters", "x".repeat(1300), /^1,300 characters · 1 min read$/],
];

for (const [name, text, status] of counts) {
  test(`status bar: ${name}`, async ({ page }) => {
    await open(page, text);
    await expect(statusNumbers(page)).toHaveText(status);
  });
}

test("the status bar follows typing", async ({ page }) => {
  await open(page, "");
  await sourceArea(page).focus();
  await page.keyboard.type("héllo");
  await expect(statusNumbers(page)).toHaveText("5 characters · 1 min read");
  await page.keyboard.press("Backspace");
  await expect(statusNumbers(page)).toHaveText("4 characters · 1 min read");
});

test("the footer shows no key hints and no size: only a note, and only while it lasts", async ({ page }) => {
  await open(page, "x");
  await expect(note(page)).toHaveText("");
  await expect(page.locator("footer.status")).not.toContainText(/bold|italic| b · |kb/);
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await expect(note(page)).toContainText("cleared");
  await expect(note(page)).toHaveText("", { timeout: 6000 });
});

// ---------------------------------------------------------------------------------------------------------- scroll sync

const share = (el: Locator) => el.evaluate((node) => node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight));
const scrollTo = (el: Locator, at: number) => el.evaluate((node, at) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * at; }, at);

test("scrolling a long source scrolls the preview to the same share, and the reverse", async ({ page }) => {
  const text = Array.from({ length: 300 }, (_, i) => `paragraph ${i + 1}`).join("\n\n");
  await open(page, text);
  await expect(article(page).locator("p").last()).toHaveText("paragraph 300");
  expect(await sourceArea(page).evaluate((el) => el.scrollHeight > el.clientHeight * 3)).toBe(true);
  expect(await article(page).evaluate((el) => el.scrollHeight > el.clientHeight * 3)).toBe(true);

  await scrollTo(sourceArea(page), 0.5);
  await expect.poll(() => share(article(page))).toBeGreaterThan(0.48);
  expect(await share(article(page))).toBeLessThan(0.52);

  await page.waitForTimeout(300);
  await scrollTo(article(page), 0.2);
  await expect.poll(() => share(sourceArea(page))).toBeGreaterThan(0.18);
  expect(await share(sourceArea(page))).toBeLessThan(0.22);

  await page.waitForTimeout(300);
  await scrollTo(sourceArea(page), 1);
  await expect.poll(() => share(article(page))).toBeGreaterThan(0.99);

  await page.waitForTimeout(300);
  await scrollTo(sourceArea(page), 0);
  await expect.poll(() => share(article(page))).toBeLessThan(0.01);
});

test("a short document that does not scroll breaks nothing in the scroll sync", async ({ page }) => {
  await open(page, "short");
  await sourceArea(page).evaluate((el) => el.dispatchEvent(new Event("scroll")));
  await article(page).evaluate((el) => el.dispatchEvent(new Event("scroll")));
  expect(await share(article(page))).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------- layout

test.describe("layout at 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("there is no header: the cards start at the page padding, and the footer is one line under them", async ({ page }) => {
    await page.goto("/");
    await expect(sourceArea(page)).toHaveValue(/^# Hello/);
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    const clear = await box(page.getByRole("button", { name: "clear", exact: true }));
    const toggle = await box(page.getByRole("switch"));
    const stats = await box(statusNumbers(page));
    const source = await box(region(page, "markdown"));
    const preview = await box(region(page, "preview"));
    await expect(page.locator("header")).toHaveCount(0);

    expect(Math.abs(source.y - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(source.y - preview.y)).toBeLessThanOrEqual(1);
    // Clear at the bottom left, the theme at the bottom right, both lined up with the cards.
    expect(Math.abs(clear.x - source.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(toggle.x + toggle.width - (preview.x + preview.width))).toBeLessThanOrEqual(1);
    const centres = [clear, stats, toggle].map((b) => b.y + b.height / 2);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(3);
    expect(clear.y).toBeGreaterThanOrEqual(source.y + source.height);
    expect(clear.x + clear.width).toBeLessThanOrEqual(stats.x);
    expect(stats.x + stats.width).toBeLessThanOrEqual(toggle.x);
    await expect(page.getByRole("button", { name: "debug" })).toHaveCount(0);
    expect(toggle.y + toggle.height).toBeLessThanOrEqual(900);
  });
});

test.describe("layout at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("there is no horizontal scroll and nothing overlaps", async ({ page }) => {
    await page.goto("/");
    await expect(sourceArea(page)).toHaveValue(/^# Hello/);
    const sizes = await page.evaluate(() => ({
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      view: document.documentElement.clientWidth,
    }));
    expect(sizes.root).toBeLessThanOrEqual(sizes.view);
    expect(sizes.body).toBeLessThanOrEqual(sizes.view);

    // Everything the user touches lies inside the viewport, and no two of them overlap.
    const parts = await page.evaluate(() => {
      const picks = ["footer.status .btn", "footer.status .num", "footer.status .switch"];
      const toolbars = [...document.querySelectorAll(".toolbar")].flatMap((bar, i) => [...bar.children].map((child, j) => ({ name: `toolbar ${i} child ${j}`, el: child })));
      const named = picks.map((selector) => ({ name: selector, el: document.querySelector(selector)! }));
      return [...named, ...toolbars].map(({ name, el }) => {
        const r = el.getBoundingClientRect();
        return { name, left: r.left, right: r.right, top: r.top, bottom: r.bottom, empty: r.width === 0 || r.height === 0 };
      });
    });
    const visible = parts.filter((p) => !p.empty);
    for (const p of visible) {
      expect(p.left, p.name).toBeGreaterThanOrEqual(0);
      expect(p.right, p.name).toBeLessThanOrEqual(390.5);
    }
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const [a, b] = [visible[i], visible[j]];
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  test("the preview card can be reached by scrolling", async ({ page }) => {
    await page.goto("/");
    const preview = region(page, "preview");
    await preview.scrollIntoViewIfNeeded();
    const box = (await preview.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await expect(preview).toBeInViewport({ ratio: 0.3 });
    const top = (await region(page, "markdown").boundingBox())!;
    expect(top.width).toBeGreaterThan(300);
  });
});

test("a mark at a caret puts the caret between its markers, so typing goes inside", async ({ page }) => {
  for (const [tool, after] of [["bold", "a **x** b"], ["italic", "a *x* b"], ["strikethrough", "a ~~x~~ b"], ["inline code", "a `x` b"]]) {
    await openMarked(page, "a ‹ b");
    await clickTool(page, "markdown", tool);
    await page.keyboard.type("x");
    await expect(sourceArea(page)).toHaveValue(after);
  }
  await openMarked(page, "a ‹ b");
  await clickTool(page, "markdown", "link");
  await page.keyboard.type("x");
  await expect(sourceArea(page)).toHaveValue("a [x](https://) b");
});

test("the heading dropdown opens in the theme, keeps the caret in the source, and closes on Escape", async ({ page }) => {
  await openMarked(page, "a‹bc");
  const picker = region(page, "markdown").getByRole("combobox", { name: "heading" });
  await picker.click();
  const list = region(page, "markdown").getByRole("listbox", { name: "heading options" });
  await expect(list).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await picker.click();
  await list.getByRole("option", { name: "h2", exact: true }).click();
  await expect(sourceArea(page)).toHaveValue("## abc");
});

test("a hint shows at once on hover, in the theme", async ({ page }) => {
  await open(page, "x");
  const bold = region(page, "markdown").getByRole("button", { name: "bold" });
  await bold.hover();
  const hint = await bold.evaluate((el) => {
    const style = getComputedStyle(el, "::before");
    return { content: style.content, font: style.fontFamily, delay: style.transitionDelay };
  });
  expect(hint.content).toMatch(/^"bold · (⌘|ctrl\+)b"$/);
  expect(hint.font).toContain("JetBrains Mono");
  expect(hint.delay).toBe("0s");
  expect(await bold.getAttribute("title")).toBeNull();
});
