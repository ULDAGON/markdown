import type { Page } from "@playwright/test";
import { article, clickTool, expect, leavePreview, open, select, sourceArea, sourceText, synced, test, type At } from "./helpers";

// Review of fc541ec..HEAD. Each test states a product rule; a failing test is a finding.

async function play(page: Page, steps: string[]) {
  for (const step of steps) {
    if (step.startsWith("type:")) await page.keyboard.type(step.slice(5));
    else await page.keyboard.press(step);
  }
}

async function edit(page: Page, markdown: string, from: At, steps: string[], to?: At) {
  await open(page, markdown);
  await select(page, "preview", from, to);
  await play(page, steps);
  await synced(page);
  await leavePreview(page);
  return sourceText(page);
}

const boxes = (page: Page) => article(page).locator("input[type=checkbox]");

// ---------------------------------------------------------------- checkbox: the n-th box is the n-th marker

test("checkbox: a task in a quote inside an item toggles its own marker", async ({ page }) => {
  await open(page, "- > - [ ] a");
  await boxes(page).first().click();
  await expect(sourceArea(page)).toHaveValue("- > - [x] a");
});

test("checkbox: a task on the line of a parent item toggles its own marker", async ({ page }) => {
  await open(page, "1. - [ ] a");
  await boxes(page).first().click();
  await expect(sourceArea(page)).toHaveValue("1. - [x] a");
});

test("checkbox: a task whose box is on the line after its marker toggles", async ({ page }) => {
  await open(page, "-\n  [ ] a");
  await boxes(page).first().click();
  await expect(sourceArea(page)).toHaveValue("-\n  [x] a");
});

test("checkbox: a fenced code block inside an item does not count as a task", async ({ page }) => {
  const md = "- [ ] a\n\n  ```\n  - [ ] x\n  ```\n- [ ] b";
  await open(page, md);
  await boxes(page).nth(1).click();
  await expect(sourceArea(page)).toHaveValue(md.replace("- [ ] b", "- [x] b"));
});

test("checkbox: an indented code block inside an item does not count as a task", async ({ page }) => {
  const md = "- [ ] a\n\n      - [ ] x\n- [ ] b";
  await open(page, md);
  await boxes(page).nth(1).click();
  await expect(sourceArea(page)).toHaveValue(md.replace("- [ ] b", "- [x] b"));
});

test("checkbox: an item that starts with [ ] and no space is no task", async ({ page }) => {
  await open(page, "- [ ]a\n- [ ] b");
  await expect(boxes(page)).toHaveCount(1);
  await boxes(page).first().click();
  await expect(sourceArea(page)).toHaveValue("- [ ]a\n- [x] b");
});

// ---------------------------------------------------------------- Backspace and Delete next to locked blocks and tables

test("Backspace at the start of a list after a code block keeps the code block", async ({ page }) => {
  const md = "intro\n\n```\ncode\n```\n\n- item\n\nend";
  const source = await edit(page, md, { text: "item" }, ["Backspace", "type:X"]);
  expect(source).toContain("```\ncode\n```");
  expect(source).toContain("item");
});

test("Backspace at the start of a quote after a code block keeps the code block", async ({ page }) => {
  const md = "intro\n\n```\ncode\n```\n\n> quote\n\nend";
  const source = await edit(page, md, { text: "quote" }, ["Backspace", "type:X"]);
  expect(source).toContain("```\ncode\n```");
  expect(source).toContain("quote");
});

test("Delete at the end of a list before a table keeps the table", async ({ page }) => {
  const md = "- item\n\n| a | b |\n| - | - |\n| c | d |\n\nend";
  const source = await edit(page, md, { text: "item", offset: 4 }, ["Delete", "type:X"]);
  expect(source).toContain("| a | b |\n| - | - |\n| c | d |");
});

test("Delete at the end of a quote before a code block keeps the code block", async ({ page }) => {
  const md = "> quote\n\n```\ncode\n```\n\nend";
  const source = await edit(page, md, { text: "quote", offset: 5 }, ["Delete", "type:X"]);
  expect(source).toContain("```\ncode\n```");
});

// ---------------------------------------------------------------- Enter

test("Enter on an empty first quote line keeps the rest a quote and leaves no empty quote", async ({ page }) => {
  // Empty the first paragraph of the quote, then Enter ends the quote there.
  const md = "intro\n\n> a\n>\n> b\n\nend";
  const source = await edit(page, md, { text: "a", offset: 1 }, ["Backspace", "Enter", "type:X"]);
  expect(source).toBe("intro\n\nX\n\n> b\n\nend");
});

test("Enter at the end of a bold task item makes a task item with a box", async ({ page }) => {
  const source = await edit(page, "- [ ] **a**\n\nend", { text: "a", offset: 1 }, ["Enter", "type:X"]);
  expect(source).toMatch(/^- \[ \] \*\*a\*\*\n- \[ \] (X|\*\*X\*\*)\n\nend$/);
});

// ---------------------------------------------------------------- reconcile

test("emptying a paragraph and splitting the next one keeps a comment between them in its place", async ({ page }) => {
  await open(page, "aaa\n\n<!-- c -->\n\nbbb ccc\n\nend");
  await select(page, "preview", { text: "aaa" }, { text: "aaa" });
  await page.keyboard.press("Backspace");
  await select(page, "preview", { text: "ccc" });
  await page.keyboard.press("Enter");
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe("<!-- c -->\n\nbbb\n\nccc\n\nend");
});

// ---------------------------------------------------------------- round trip of an edited block

const roundTrips: { name: string; markdown: string; word: string }[] = [
  { name: "mixed * and _ emphasis", markdown: "*a* and _b_ end", word: "end" },
  { name: "a hard break of two spaces", markdown: "a  \nb end", word: "end" },
  { name: "an escaped underscore", markdown: "a\\_b end", word: "end" },
];
// toMarkdown cannot give these back byte for byte, so they open as raw text and typing on them changes nothing.
for (const { name, markdown, word } of roundTrips) {
  test(`a block with ${name} is a raw-text block that typing does not rewrite`, async ({ page }) => {
    expect(await edit(page, markdown, { text: word, offset: word.length }, ["type:X"])).toBe(markdown);
    await expect(article(page).locator(":scope > [data-rich]")).toHaveCount(1);
  });
}

// ---------------------------------------------------------------- checkbox after an edit in the same list

test("a click on a box after typing in a list with an empty task item toggles that box", async ({ page }) => {
  await open(page, "- [ ]\n- [ ] b");
  await select(page, "preview", { text: "b", offset: 1 });
  await page.keyboard.type("X");
  await synced(page);
  await boxes(page).nth(1).click();
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("- [ ]\n- [x] bX");
});

test("a click on the box of a new task item made by Enter toggles that box", async ({ page }) => {
  await open(page, "- [ ] one");
  await select(page, "preview", { text: "one", offset: 3 });
  await page.keyboard.press("Enter");
  await synced(page);
  await boxes(page).nth(1).click();
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("- [ ] one\n- [x]");
});

// ---------------------------------------------------------------- list tools inside a quote, tab indent

test("the task tool on an item of a list in a quote makes a task in the quote", async ({ page }) => {
  await open(page, "> - a\n> - b");
  await select(page, "preview", { text: "a", offset: 1 });
  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("> - [ ] a\n> - b");
});

test("the task tool on a task item in a quote removes its box", async ({ page }) => {
  await open(page, "> - [ ] a\n> - [ ] b");
  await select(page, "preview", { text: "a", offset: 1 });
  await clickTool(page, "preview", "task list");
  await expect(sourceArea(page)).toHaveValue("> - a\n> - [ ] b");
});

test("the bullet tool on quoted lines makes a list in the quote", async ({ page }) => {
  await open(page, "> a\n> b");
  await select(page, "markdown", { text: "a" }, { text: "b" });
  await clickTool(page, "markdown", "bullet list");
  await expect(sourceArea(page)).toHaveValue("> - a\n> - b");
});

test("the bullet tool twice on tab-indented lines restores the source", async ({ page }) => {
  const md = "\ta\n\tb";
  await open(page, md);
  await select(page, "markdown", { text: "a" }, { text: "b" });
  await clickTool(page, "markdown", "bullet list");
  await select(page, "markdown", { text: "a" }, { text: "b" });
  await clickTool(page, "markdown", "bullet list");
  await expect(sourceArea(page)).toHaveValue(md);
});

// ---------------------------------------------------------------- link

test("changing the URL of a link with a title keeps the title", async ({ page }) => {
  await open(page, 'see [text](https://a.example "Title") end');
  await select(page, "preview", { text: "text", offset: 2 });
  await clickTool(page, "preview", "link");
  const field = page.getByPlaceholder("https://");
  await field.fill("https://b.example");
  await field.press("Enter");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue('see [text](https://b.example "Title") end');
});

// ---------------------------------------------------------------- tables

test("a table row with more cells than the header makes the table a raw-text block", async ({ page }) => {
  const md = "| a |\n| - |\n| 1 | 2 |\n| x |";
  expect(await edit(page, md, { text: "x", offset: 1 }, ["type:Y"])).toBe(md);
  await expect(article(page).locator(":scope > table[data-rich]")).toHaveCount(1);
});

// ---------------------------------------------------------------- tools: same markdown in both cards, toggle twice

test("typing in a task item keeps the box of an empty task item in the same list", async ({ page }) => {
  expect(await edit(page, "- [ ]\n- [ ] b", { text: "b", offset: 1 }, ["type:X"])).toBe("- [ ]\n- [ ] bX");
});

const sameMarkdown: { name: string; markdown: string; tool: string; from: At; to: At }[] = [
  { name: "bold over a line with a bold word", markdown: "a **b** c", tool: "bold", from: { text: "a" }, to: { text: "c" } },
  { name: "bold over a bold word and the next word", markdown: "**a** b", tool: "bold", from: { text: "a" }, to: { text: "b" } },
  { name: "bold over two lines of a paragraph", markdown: "a\nb", tool: "bold", from: { text: "a" }, to: { text: "b" } },
];
for (const { name, markdown, tool, from, to } of sameMarkdown) {
  test(`same markdown in both cards: ${name}`, async ({ page }) => {
    await open(page, markdown);
    await select(page, "markdown", from, to);
    await clickTool(page, "markdown", tool);
    const fromSource = await sourceText(page);

    await open(page, markdown);
    await select(page, "preview", from, to);
    await clickTool(page, "preview", tool);
    await leavePreview(page);
    expect(await sourceText(page)).toBe(fromSource);
  });
}

test("preview italic in a document of _ emphasis writes the markdown of the markdown card", async ({ page }) => {
  const md = "_a_ b";
  await open(page, md);
  await select(page, "markdown", { text: "b" }, { text: "b" });
  await clickTool(page, "markdown", "italic");
  const fromSource = await sourceText(page);

  await open(page, md);
  await select(page, "preview", { text: "b" }, { text: "b" });
  await clickTool(page, "preview", "italic");
  await leavePreview(page);
  expect(await sourceText(page)).toBe(fromSource);
});

// Another list type is a conversion, not a toggle. Off, the item is a paragraph between two lists; on again, it
// joins them as a bullet item.
test("the bullet tool converts an item of a numbered list, then takes the bullet off", async ({ page }) => {
  await open(page, "1. a\n2. b\n3. c");
  await select(page, "preview", { text: "b", offset: 1 });
  await clickTool(page, "preview", "bullet list");
  await expect(sourceArea(page)).toHaveValue("1. a\n- b\n3. c");
  await clickTool(page, "preview", "bullet list");
  await expect(sourceArea(page)).toHaveValue("1. a\n\nb\n\n3. c");
  await clickTool(page, "preview", "bullet list");
  await expect(sourceArea(page)).toHaveValue("1. a\n- b\n3. c");
});

const markCases: { name: string; markdown: string; word: string; tool: string }[] = [
  { name: "italic on a word between intraword underscores", markdown: "snake_case_name", word: "case", tool: "italic" },
  { name: "italic on a word between escaped stars", markdown: "a \\*b\\* c", word: "b", tool: "italic" },
  { name: "italic on a word between spaced stars", markdown: "2 * 3 * 4", word: "3", tool: "italic" },
  { name: "bold on a word between spaced double stars", markdown: "a ** b ** c", word: "b", tool: "bold" },
  { name: "italic on a word between two links with a star", markdown: "[*](u) b [*](v)", word: "b", tool: "italic" },
  { name: "italic on a word between two code spans with a star", markdown: "`*` b `*`", word: "b", tool: "italic" },
];
for (const { name, markdown, word, tool } of markCases) {
  test(`markdown card: ${name} adds markers and removes no text`, async ({ page }) => {
    await open(page, markdown);
    await select(page, "markdown", { text: word }, { text: word });
    await clickTool(page, "markdown", tool);
    const marked = await sourceText(page);
    // Every character of the source is still there, in order.
    let at = 0;
    for (const c of markdown) if (at >= 0) at = marked.indexOf(c, at) === -1 ? -1 : marked.indexOf(c, at) + 1;
    expect(at, `${JSON.stringify(markdown)} became ${JSON.stringify(marked)}`).toBeGreaterThan(0);
  });
}

test("markdown card: italic on an italic word after a code span with a star removes the italic", async ({ page }) => {
  await open(page, "x `a*b` *c* y");
  await select(page, "markdown", { text: "*c*", offset: 1 }, { text: "*c*", offset: 2 });
  await clickTool(page, "markdown", "italic");
  await expect(sourceArea(page)).toHaveValue("x `a*b` c y");
});
