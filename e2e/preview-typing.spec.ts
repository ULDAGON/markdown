import type { Page } from "@playwright/test";
import { article, expect, leavePreview, open, previewBlocks, select, sourceText, synced, test, type At } from "./helpers";

/** A step is a key to press, or "type:text" to type. */
type Step = string;

async function play(page: Page, steps: Step[]) {
  for (const step of steps) {
    if (step.startsWith("type:")) await page.keyboard.type(step.slice(5));
    else await page.keyboard.press(step);
  }
}

/** Open `markdown`, put the caret (or selection) in the preview, play the steps. Returns the source before and after the render. */
async function edit(page: Page, markdown: string, from: At, steps: Step[], to?: At) {
  await open(page, markdown);
  await select(page, "preview", from, to);
  await play(page, steps);
  await synced(page);
  const live = await sourceText(page);
  await leavePreview(page);
  const rendered = await sourceText(page);
  // The render from the source must not change the source.
  expect(rendered).toBe(live);
  return rendered;
}

/** The text of each list item; an empty item holds a <br> that innerText shows as a line break. */
const items = async (page: Page) => (await article(page).locator("li").allInnerTexts()).map((text) => text.replace(/\n$/, ""));

const headings = (page: Page) => article(page).locator("h1, h2, h3").allTextContents();

/** The rows of the first table in `source` as trimmed cells, for a table that the editor lays out again. */
const rows = (source: string) =>
  source
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((c) => c.trim()));

// ---------------------------------------------------------------- typing at the start, middle and end of a block

const kinds: Record<string, (line: string) => string> = {
  paragraph: (t) => `intro\n\n${t}\n\nend`,
  heading: (t) => `intro\n\n## ${t}\n\nend`,
  "bullet item": (t) => `- one\n- ${t}\n- three`,
  "numbered item": (t) => `1. one\n2. ${t}\n3. three`,
  "task item": (t) => `- [ ] one\n- [ ] ${t}\n- [ ] three`,
  quote: (t) => `intro\n\n> ${t}\n\nend`,
};
const places = { start: 0, middle: 4, end: 8 };

for (const [kind, wrap] of Object.entries(kinds)) {
  for (const [place, offset] of Object.entries(places)) {
    test(`typing at the ${place} of a ${kind}`, async ({ page }) => {
      const typed = "mid word".slice(0, offset) + "X" + "mid word".slice(offset);
      expect(await edit(page, wrap("mid word"), { text: "mid word", offset }, ["type:X"])).toBe(wrap(typed));
    });
  }
}

const cell = (c: string) => `intro\n\n| a | b |\n| --- | --- |\n| ${c} | d |\n\nend`;
for (const [place, offset] of Object.entries(places)) {
  test(`typing at the ${place} of a table cell`, async ({ page }) => {
    const typed = "mid word".slice(0, offset) + "X" + "mid word".slice(offset);
    const source = await edit(page, cell("mid word"), { text: "mid word", offset }, ["type:X"]);
    expect(source.startsWith("intro\n\n| a")).toBe(true);
    expect(source.endsWith("|\n\nend")).toBe(true);
    expect([rows(source)[0], rows(source)[2]]).toEqual([["a", "b"], [typed, "d"]]);
    expect(await article(page).locator("td").allInnerTexts()).toEqual([typed, "d"]);
  });
}

test("an edit changes only its block: odd formatting around it stays byte for byte", async ({ page }) => {
  const odd = (mid: string) => `Title\n=====\n\n* item  \n* __bold__\n\n\n\n+ x\n\n${mid}\n\n|a|  b |\n|--|--|\n| 1 | 2 |\n\n***\n\nlast line  \n`;
  expect(await edit(page, odd("mid"), { text: "mid", offset: 1 }, ["type:X"])).toBe(odd("mXid"));
});

test("typing twice in a row lands the second letter after the first", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 2 }, ["type:X", "type:Y"])).toBe("intro\n\nheXYllo\n\nend");
});

// ---------------------------------------------------------------- Enter

test("Enter at the end of a paragraph starts a new paragraph", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 5 }, ["Enter", "type:X"])).toBe("intro\n\nhello\n\nX\n\nend");
  expect(await previewBlocks(page)).toEqual(["intro", "hello", "X", "end"]);
});

test("Enter in the middle of a paragraph splits it and the caret goes to the second part", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 2 }, ["Enter", "type:X"])).toBe("intro\n\nhe\n\nXllo\n\nend");
  expect(await previewBlocks(page)).toEqual(["intro", "he", "Xllo", "end"]);
});

test("Enter at the start of a paragraph keeps the caret on the text", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nend", { text: "hello" }, ["Enter", "type:X"])).toBe("intro\n\nXhello\n\nend");
  expect(await previewBlocks(page)).toEqual(["intro", "Xhello", "end"]);
});

test("Enter at the end of a heading starts a paragraph", async ({ page }) => {
  expect(await edit(page, "intro\n\n## Title\n\nend", { text: "Title", offset: 5 }, ["Enter", "type:X"])).toBe("intro\n\n## Title\n\nX\n\nend");
});

test("Enter in the middle of a heading splits it", async ({ page }) => {
  const source = await edit(page, "intro\n\n## Title\n\nend", { text: "Title", offset: 2 }, ["Enter", "type:X"]);
  expect(source).toBe("intro\n\n## Ti\n\n## Xtle\n\nend");
});

test("Enter at the start of a heading keeps the caret on the heading text", async ({ page }) => {
  expect(await edit(page, "intro\n\n## Title\n\nend", { text: "Title" }, ["Enter", "type:X"])).toBe("intro\n\n## XTitle\n\nend");
});

test("Enter at the end of a bullet item starts a new item", async ({ page }) => {
  expect(await edit(page, "- one\n- two\n- three", { text: "two", offset: 3 }, ["Enter", "type:X"])).toBe("- one\n- two\n- X\n- three");
});

test("Enter in the middle of a bullet item splits it", async ({ page }) => {
  expect(await edit(page, "- one\n- two\n- three", { text: "two", offset: 1 }, ["Enter", "type:X"])).toBe("- one\n- t\n- Xwo\n- three");
});

test("Enter at the start of a bullet item adds an empty item before it", async ({ page }) => {
  const source = await edit(page, "- one\n- two\n- three", { text: "two" }, ["Enter", "type:X"]);
  expect(source).toMatch(/^- one\n-[ ]?\n- Xtwo\n- three$/);
  expect(await items(page)).toEqual(["one", "", "Xtwo", "three"]);
});

test("Enter at the end of a numbered item starts a new item", async ({ page }) => {
  const source = await edit(page, "1. one\n2. two\n3. three", { text: "two", offset: 3 }, ["Enter", "type:X"]);
  expect(source).toBe("1. one\n2. two\n3. X\n4. three");
});

test("Enter at the end of a task item starts a new task item", async ({ page }) => {
  expect(await edit(page, "- [ ] one\n- [ ] two\n- [ ] three", { text: "two", offset: 3 }, ["Enter", "type:X"])).toBe("- [ ] one\n- [ ] two\n- [ ] X\n- [ ] three");
});

test("Enter at the end of a checked task item starts an unchecked task item", async ({ page }) => {
  expect(await edit(page, "- [x] one\n- [ ] two", { text: "one", offset: 3 }, ["Enter", "type:X"])).toBe("- [x] one\n- [ ] X\n- [ ] two");
});

test("Enter on an empty bullet item ends the list", async ({ page }) => {
  expect(await edit(page, "intro\n\n- one\n\nend", { text: "one", offset: 3 }, ["Enter", "Enter", "type:X"])).toBe("intro\n\n- one\n\nX\n\nend");
});

test("Enter on an empty nested item moves it out one level", async ({ page }) => {
  expect(await edit(page, "- one\n  - two", { text: "two", offset: 3 }, ["Enter", "Enter", "type:X"])).toBe("- one\n  - two\n- X");
});

test("Enter at the end of a quote, then text, keeps the text in the quote or after it", async ({ page }) => {
  const source = await edit(page, "intro\n\n> quote\n\nend", { text: "quote", offset: 5 }, ["Enter", "type:X"]);
  expect(source).toMatch(/^intro\n\n> quote(\n>)?\n(> )?X\n\nend$|^intro\n\n> quote\n\nX\n\nend$/);
});

test("Enter twice at the end of a quote leaves the quote", async ({ page }) => {
  expect(await edit(page, "intro\n\n> quote\n\nend", { text: "quote", offset: 5 }, ["Enter", "Enter", "type:X"])).toBe("intro\n\n> quote\n\nX\n\nend");
});

test("Enter in the middle of a quote keeps both parts", async ({ page }) => {
  const source = await edit(page, "intro\n\n> quote\n\nend", { text: "quote", offset: 2 }, ["Enter", "type:X"]);
  expect(source).toMatch(/^intro\n\n> qu\n(>\n)?(> )?Xote\n\nend$/);
});

test("Enter at the start of a quote keeps the caret on the quote text", async ({ page }) => {
  const source = await edit(page, "intro\n\n> quote\n\nend", { text: "quote" }, ["Enter", "type:X"]);
  expect(source).toMatch(/^intro\n\n(> \n)?(>\n)?\n?> Xquote\n\nend$/);
});

test("Enter in a table cell does not break the table", async ({ page }) => {
  const source = await edit(page, cell("ccc"), { text: "ccc", offset: 3 }, ["Enter", "type:X"]);
  expect(source.startsWith("intro\n\n| a")).toBe(true);
  expect(source.endsWith("|\n\nend")).toBe(true);
  expect(rows(source)[0]).toEqual(["a", "b"]);
  expect(await article(page).locator("table").count()).toBe(1);
  expect(await article(page).locator("tr").count()).toBe(2);
  expect(await article(page).locator("td").count()).toBe(2);
  expect((await article(page).locator("td").first().innerText()).replace(/\s+/g, "")).toBe("cccX");
});

// ---------------------------------------------------------------- Shift+Enter

test("Shift+Enter in a paragraph makes a hard break in the same block", async ({ page }) => {
  const source = await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 2 }, ["Shift+Enter", "type:X"]);
  expect(source).toMatch(/^intro\n\nhe(\\| {2})\nXllo\n\nend$/);
  expect(await previewBlocks(page)).toEqual(["intro", "he\nXllo", "end"]);
});

test("Shift+Enter at the end of a paragraph keeps the typed text after the break", async ({ page }) => {
  const source = await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 5 }, ["Shift+Enter", "type:X"]);
  expect(source).toMatch(/^intro\n\nhello(\\| {2})\nX\n\nend$/);
});

test("Shift+Enter in a list item stays in the item", async ({ page }) => {
  const source = await edit(page, "- one\n- two\n- three", { text: "two", offset: 1 }, ["Shift+Enter", "type:X"]);
  expect(source).toMatch(/^- one\n- t(\\| {2})\n {2}Xwo\n- three$/);
  expect(await items(page)).toEqual(["one", "t\nXwo", "three"]);
});

test("Shift+Enter in a heading stays in the heading", async ({ page }) => {
  await edit(page, "intro\n\n## Title\n\nend", { text: "Title", offset: 2 }, ["Shift+Enter", "type:X"]);
  expect(await headings(page)).toEqual(["Ti\nXtle"]);
  expect(await previewBlocks(page)).toHaveLength(3);
});

// ---------------------------------------------------------------- Backspace and Delete

const merges: Record<string, { md: string; merged: string }> = {
  paragraph: { md: "intro\n\nhello\n\nend", merged: "introXhello\n\nend" },
  heading: { md: "## Head\n\nhello\n\nend", merged: "## HeadXhello\n\nend" },
  "bullet item": { md: "- item\n\nhello\n\nend", merged: "- itemXhello\n\nend" },
  "numbered item": { md: "1. item\n\nhello\n\nend", merged: "1. itemXhello\n\nend" },
  "task item": { md: "- [ ] item\n\nhello\n\nend", merged: "- [ ] itemXhello\n\nend" },
  quote: { md: "> quote\n\nhello\n\nend", merged: "> quoteXhello\n\nend" },
};
for (const [kind, { md, merged }] of Object.entries(merges)) {
  test(`Backspace at the start of a paragraph after a ${kind} merges into it`, async ({ page }) => {
    expect(await edit(page, md, { text: "hello" }, ["Backspace", "type:X"])).toBe(merged);
  });
}

test("Backspace at the start of a paragraph after a table keeps the table cells", async ({ page }) => {
  const md = cell("ccc").replace("\n\nend", "\n\nhello\n\nend");
  const source = await edit(page, md, { text: "hello" }, ["Backspace", "type:X"]);
  expect(source.startsWith("intro\n\n| a")).toBe(true);
  expect(source.endsWith("|\n\nend") || source.endsWith("\n\nXhello\n\nend")).toBe(true);
  expect(rows(source)[0]).toEqual(["a", "b"]);
  expect(rows(source)[2][0]).toBe("ccc");
  expect(rows(source)[2][1]).toBe("d");
});

test("Backspace at the start of a paragraph after a code block keeps the code block", async ({ page }) => {
  const md = "intro\n\n```js\nlet a = 1;\n```\n\nhello\n\nend";
  const source = await edit(page, md, { text: "hello" }, ["Backspace", "type:X"]);
  expect(source).toBe("intro\n\n```js\nlet a = 1;\n```\n\nXhello\n\nend");
});

test("Backspace at the start of a paragraph after a rule loses no text", async ({ page }) => {
  const source = await edit(page, "intro\n\n---\n\nhello\n\nend", { text: "hello" }, ["Backspace", "type:X"]);
  expect(["intro\n\n---\n\nXhello\n\nend", "intro\n\nXhello\n\nend"]).toContain(source);
});

test("Backspace at the start of the first block changes nothing", async ({ page }) => {
  expect(await edit(page, "hello\n\nworld", { text: "hello" }, ["Backspace", "type:X"])).toBe("Xhello\n\nworld");
});

test("Backspace at the start of the first list item takes it out of the list or changes nothing else", async ({ page }) => {
  await edit(page, "- one\n- two\n\nend", { text: "one" }, ["Backspace", "type:X"]);
  expect(await article(page).innerText()).toMatch(/^Xone\s+two\s+end$/);
});

test("Backspace at the start of a list item merges it into the item above", async ({ page }) => {
  expect(await edit(page, "- one\n- two\n- three", { text: "two" }, ["Backspace", "type:X"])).toBe("- oneXtwo\n- three");
});

test("Backspace in an empty paragraph removes it and the caret goes to the end of the block above", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 5 }, ["Enter", "Backspace", "type:X"])).toBe("intro\n\nhelloX\n\nend");
});

test("Backspace in an empty heading leaves the other blocks as they are", async ({ page }) => {
  const source = await edit(page, "intro\n\n## Title\n\nend", { text: "Title", offset: 5 }, ["Enter", "Backspace", "type:X"]);
  expect(source).toBe("intro\n\n## TitleX\n\nend");
});

test("Backspace removes the last character and the source follows", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 5 }, ["Backspace", "Backspace"])).toBe("intro\n\nhel\n\nend");
});

test("Delete at the end of a paragraph merges the next paragraph", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nworld\n\nend", { text: "hello", offset: 5 }, ["Delete", "type:X"])).toBe("intro\n\nhelloXworld\n\nend");
});

test("Delete at the end of a heading merges the next paragraph into the heading", async ({ page }) => {
  expect(await edit(page, "## Title\n\nworld\n\nend", { text: "Title", offset: 5 }, ["Delete", "type:X"])).toBe("## TitleXworld\n\nend");
});

test("Delete at the end of a list item merges the next item", async ({ page }) => {
  expect(await edit(page, "- one\n- two\n- three", { text: "one", offset: 3 }, ["Delete", "type:X"])).toBe("- oneXtwo\n- three");
});

test("Delete at the end of the last block changes nothing", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello", { text: "hello", offset: 5 }, ["Delete", "type:X"])).toBe("intro\n\nhelloX");
});

// ---------------------------------------------------------------- selections across blocks

test("typing over a selection from a paragraph into a heading and a list joins them in the first block", async ({ page }) => {
  const md = "alpha\n\n## Beta\n\n- gamma\n\ndelta";
  const source = await edit(page, md, { text: "alpha", offset: 3 }, ["type:X"], { text: "gamma", offset: 2 });
  expect(source).toBe("alpXmma\n\ndelta");
});

test("Backspace over a selection across a heading and a quote leaves the text around it", async ({ page }) => {
  const md = "intro\n\n## Head\n\n> quote\n\nend";
  const source = await edit(page, md, { text: "Head", offset: 2 }, ["Backspace"], { text: "quote", offset: 2 });
  expect(source).toBe("intro\n\n## Heote\n\nend");
});

test("deleting a selection of two whole paragraphs leaves the others", async ({ page }) => {
  const source = await edit(page, "one\n\ntwo\n\nthree\n\nfour", { text: "two" }, ["Delete"], { text: "three" });
  expect(source).toBe("one\n\nfour");
});

test("deleting from the middle of a paragraph into the middle of the next one merges them", async ({ page }) => {
  expect(await edit(page, "intro\n\nhello\n\nworld\n\nend", { text: "hello", offset: 2 }, ["Delete", "type:X"], { text: "world", offset: 3 })).toBe("intro\n\nheXld\n\nend");
});

test("typing over a selection across three list items and a paragraph", async ({ page }) => {
  const source = await edit(page, "- one\n- two\n- three\n\nend", { text: "two", offset: 1 }, ["type:X"], { text: "end", offset: 1 });
  expect(source).toBe("- one\n- tXnd");
});

test("select all and delete empties the source, then typing starts a paragraph", async ({ page }) => {
  await open(page, "# Title\n\nsome text\n\n- a\n- b");
  await select(page, "preview", { text: "Title", offset: 2 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await synced(page);
  expect(await sourceText(page)).toBe("");
  await page.keyboard.type("hello");
  await synced(page);
  expect(await sourceText(page)).toBe("hello");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("hello");
  expect(await previewBlocks(page)).toEqual(["hello"]);
});

test("select all and type replaces the whole document", async ({ page }) => {
  await open(page, "some text\n\n# Title\n\n- a\n- b");
  await select(page, "preview", { text: "some", offset: 2 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("new");
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe("new");
  expect(await previewBlocks(page)).toEqual(["new"]);
});

test("typing and Enter in the preview of an empty document", async ({ page }) => {
  await open(page, "");
  await article(page).click();
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe("first\n\nsecond");
  expect(await previewBlocks(page)).toEqual(["first", "second"]);
});

// ---------------------------------------------------------------- paste

async function copy(page: Page, data: { "text/plain"?: string; "text/html"?: string }) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async (data) => {
    await navigator.clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(data).map(([type, text]) => [type, new Blob([text], { type })])))]);
  }, data);
}

test("paste of plain text with several lines keeps every line", async ({ page }) => {
  await open(page, "intro\n\nhello\n\nend");
  await copy(page, { "text/plain": "line one\nline two\n\nline three" });
  await select(page, "preview", { text: "hello", offset: 5 });
  await page.keyboard.press("ControlOrMeta+v");
  await synced(page);
  await leavePreview(page);
  const text = await article(page).innerText();
  for (const line of ["line one", "line two", "line three"]) expect(text).toContain(line);
  const source = await sourceText(page);
  expect(source.startsWith("intro\n\nhello")).toBe(true);
  expect(source.endsWith("\n\nend")).toBe(true);
  expect(source).toMatch(/line one\s*(\\|  )?\n\s*line two/);
  expect(source).toMatch(/line two\s*\n\s*\n\s*line three/);
});

test("paste of HTML with a heading and a list keeps the structure and the other blocks", async ({ page }) => {
  await open(page, "intro\n\nhello\n\nend");
  await copy(page, { "text/plain": "Head\nA\nB", "text/html": "<h3>Head</h3><ul><li>A</li><li>B</li></ul>" });
  await select(page, "preview", { text: "hello", offset: 5 });
  await page.keyboard.press("ControlOrMeta+v");
  await synced(page);
  await leavePreview(page);
  const source = await sourceText(page);
  expect(source.startsWith("intro\n\nhello")).toBe(true);
  expect(source.endsWith("\n\nend")).toBe(true);
  expect(source).toMatch(/### Head/);
  expect(source).toMatch(/- A\n- B/);
});

test("paste of HTML with a script and an event handler does not run it and keeps the text", async ({ page }) => {
  await open(page, "intro\n\nhello");
  await copy(page, { "text/plain": "safe", "text/html": '<p onclick="window.__x=1">safe</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__x=1"><script>window.__x=1</script>' });
  await select(page, "preview", { text: "hello", offset: 5 });
  await page.keyboard.press("ControlOrMeta+v");
  await synced(page);
  await leavePreview(page);
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
  expect(await sourceText(page)).not.toMatch(/script|onload|onclick/);
  expect(await article(page).innerText()).toContain("safe");
});

test("paste of text with markdown syntax stays text", async ({ page }) => {
  await open(page, "intro\n\nhello");
  await copy(page, { "text/plain": "*not bold* and <b>x</b>" });
  await select(page, "preview", { text: "hello", offset: 5 });
  await page.keyboard.press("ControlOrMeta+v");
  await synced(page);
  await leavePreview(page);
  expect(await previewBlocks(page)).toEqual(["intro", "hello*not bold* and <b>x</b>"]);
});

// ---------------------------------------------------------------- undo

test("undo after typing in the preview brings the old source back, redo the new one", async ({ page }) => {
  const md = "intro\n\nhello\n\nend";
  await open(page, md);
  await select(page, "preview", { text: "hello", offset: 2 });
  await page.keyboard.type("XY");
  await synced(page);
  expect(await sourceText(page)).toBe("intro\n\nheXYllo\n\nend");
  await page.keyboard.press("ControlOrMeta+z");
  await synced(page);
  expect(await sourceText(page)).toBe(md);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await synced(page);
  expect(await sourceText(page)).toBe("intro\n\nheXYllo\n\nend");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("intro\n\nheXYllo\n\nend");
});

test("undo of Enter in the preview joins the paragraphs again", async ({ page }) => {
  const md = "intro\n\nhello\n\nend";
  await open(page, md);
  await select(page, "preview", { text: "hello", offset: 2 });
  await page.keyboard.press("Enter");
  await synced(page);
  expect(await sourceText(page)).toBe("intro\n\nhe\n\nllo\n\nend");
  await page.keyboard.press("ControlOrMeta+z");
  await synced(page);
  expect(await sourceText(page)).toBe(md);
  await leavePreview(page);
  expect(await previewBlocks(page)).toEqual(["intro", "hello", "end"]);
});

// ---------------------------------------------------------------- speed

test("typing across the 120 ms debounce loses no letter and keeps the caret", async ({ page }) => {
  await open(page, "intro\n\nhello\n\nend");
  await select(page, "preview", { text: "hello", offset: 2 });
  const typed = "abcdefghijklmnopqrstuvwxyz";
  await page.keyboard.type(typed, { delay: 119 });
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe(`intro\n\nhe${typed}llo\n\nend`);
});

test("typing fast, with no pause, in several blocks", async ({ page }) => {
  await open(page, "one\n\ntwo");
  await select(page, "preview", { text: "one", offset: 3 });
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1.5");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1.75");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("one1\n\n1.5\n\n1.75\n\ntwo");
});

test("typing a letter right after the sync fires keeps it", async ({ page }) => {
  await open(page, "intro\n\nhello");
  await select(page, "preview", { text: "hello", offset: 5 });
  for (const letter of "abc") {
    await page.keyboard.type(letter);
    await page.waitForTimeout(121);
  }
  await leavePreview(page);
  expect(await sourceText(page)).toBe("intro\n\nhelloabc");
});

// ---------------------------------------------------------------- text that looks like markdown, and Unicode

const characters: [name: string, typed: string][] = [
  ["emoji", "😀👍🏽"],
  ["umlauts", "äöüß é ñ"],
  ["CJK", "日本語 中文 한국어"],
  ["asterisks", "*a* and **b**"],
  ["underscores", "_a_ and __b__ and snake_case_name"],
  ["brackets", "[link](http://x.y) and [ref]"],
  ["backticks", "`code` and ``two``"],
  ["pipes", "a | b | c"],
  ["angle brackets", "<b>bold</b> and <!-- c --> and a < b > c"],
  ["ampersands", "&amp; &lt; & &copy; &#65;"],
  ["tildes", "~~strike~~ and ~one~"],
  ["backslash", "a\\b \\* c\\"],
  ["dollars", "$x$ and $$y$$ and $5"],
  ["a bang and a link", "![img](a.png) and ![x][y]"],
  ["a footnote mark", "see [^1] here"],
  ["a URL", "see https://example.com/a_b_c?x=1&y=2 now"],
];
for (const [name, typed] of characters) {
  test(`typed ${name} in a paragraph stay text`, async ({ page }) => {
    await open(page, "intro\n\nhello\n\nend");
    await select(page, "preview", { text: "hello", offset: 5 });
    await page.keyboard.type(" " + typed);
    await synced(page);
    await leavePreview(page);
    expect(await previewBlocks(page)).toEqual(["intro", "hello " + typed, "end"]);
    expect(await article(page).locator("strong, em, code, img, del, sup, p > a:not([href^=http])").count()).toBe(0);
    const source = await sourceText(page);
    expect(source.startsWith("intro\n\nhello")).toBe(true);
    expect(source.endsWith("\n\nend")).toBe(true);
  });
}

const starts = ["# ", "## x", "- ", "* ", "+ ", "1. ", "1) ", "> ", "---", "***", "===", "```", "~~~", "    ", "| a |", "- [ ] ", "[x]: http://a", "<div>", "\\", "- - -", "    code"];
for (const start of starts) {
  test(`typing "${start}" at the start of a new paragraph stays text`, async ({ page }) => {
    await open(page, "intro\n\nhello");
    await select(page, "preview", { text: "hello", offset: 5 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(start + "text");
    await synced(page);
    await leavePreview(page);
    // The typed U+00A0 becomes a space, and markdown drops the spaces at the start of a paragraph.
    expect(await previewBlocks(page)).toEqual(["intro", "hello", (start + "text").trimStart()]);
    expect(await article(page).locator(":scope > *").evaluateAll((els) => els.map((el) => el.tagName))).toEqual(["P", "P", "P"]);
    expect((await sourceText(page)).startsWith("intro\n\nhello\n\n")).toBe(true);
  });
}

test("two typed spaces in a row stay plain spaces in the source", async ({ page }) => {
  const source = await edit(page, "intro\n\nhello\n\nend", { text: "hello", offset: 5 }, ["type:  a  b  c"]);
  expect(source).not.toContain("\u00a0");
  expect(source).toBe("intro\n\nhello  a  b  c\n\nend");
});

test("a typed space at the start of a new paragraph does not put a no-break space in the source", async ({ page }) => {
  const source = await edit(page, "intro\n\nhello", { text: "hello", offset: 5 }, ["Enter", "type:   text"]);
  expect(source).not.toContain("\u00a0");
});

test("typing a hash at the start of a heading text stays text in the heading", async ({ page }) => {
  await edit(page, "intro\n\n## Title\n\nend", { text: "Title" }, ["type:# "]);
  expect(await headings(page)).toEqual(["# Title"]);
});

test("typing markdown syntax in a list item stays text", async ({ page }) => {
  await edit(page, "- one\n- two", { text: "two", offset: 3 }, ["type: # *a* [b] `c` | <d> &e"]);
  expect(await items(page)).toEqual(["one", "two # *a* [b] `c` | <d> &e"]);
  expect(await article(page).locator("li > :is(strong, em, code, a)").count()).toBe(0);
});

test("typing a pipe and markdown syntax in a table cell stays text", async ({ page }) => {
  const source = await edit(page, cell("ccc"), { text: "ccc", offset: 3 }, ["type:|*x*|<y>"]);
  expect(source).toMatch(/\\\|/);
  expect(source).toMatch(/\n\nend$/);
  expect(await article(page).locator("td").allInnerTexts()).toEqual(["ccc|*x*|<y>", "d"]);
  expect(await article(page).locator("tr").count()).toBe(2);
});

test("typing markdown syntax in a quote stays text", async ({ page }) => {
  await edit(page, "intro\n\n> quote\n\nend", { text: "quote", offset: 5 }, ["type: > # *a* _b_"]);
  expect(await article(page).locator("blockquote").innerText()).toBe("quote > # *a* _b_");
});

test("typing markdown syntax in a heading stays text", async ({ page }) => {
  await edit(page, "intro\n\n## Title\n\nend", { text: "Title", offset: 5 }, ["type: # *a* _b_ [c] #"]);
  expect(await headings(page)).toEqual(["Title # *a* _b_ [c] #"]);
});

// ---------------------------------------------------------------- line endings and size

test("a document with CRLF line endings is edited and keeps its text", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((text) => localStorage.setItem("md.text", text), "intro\r\n\r\nhello\r\nworld\r\n\r\n- a\r\n- b\r\n\r\nend");
  await page.reload();
  await expect(article(page)).toContainText("hello");
  await select(page, "preview", { text: "hello", offset: 5 });
  await page.keyboard.type("X");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Y");
  await synced(page);
  await leavePreview(page);
  const source = await sourceText(page);
  expect(source).toMatch(/^intro\n\nhelloX\n\nY[ \n]world\n\n- a\n- b\n\nend$/);
  expect((await previewBlocks(page)).map((text) => text.replace("\n", " "))).toEqual(["intro", "helloX", "Y world", "a b", "end"]);
});

test("a very long paragraph is edited in the middle without loss", async ({ page }) => {
  const long = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" ");
  const md = `intro\n\n${long}\n\nend`;
  await open(page, md);
  await select(page, "preview", { text: "w1500 ", offset: 3 });
  await page.keyboard.type("X");
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe(md.replace("w1500 ", "w15X00 "));
});

test("typing a lot of text at once is all in the source", async ({ page }) => {
  await open(page, "intro\n\nhello\n\nend");
  await select(page, "preview", { text: "hello", offset: 5 });
  const text = "lorem ipsum ".repeat(200).trim();
  await page.keyboard.insertText(text);
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe(`intro\n\nhello${text}\n\nend`);
});
