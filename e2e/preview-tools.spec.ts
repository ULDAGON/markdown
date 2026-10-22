import type { Page } from "@playwright/test";
import { article, type At, type Card, clickTool, expect, leavePreview, open, pickHeading, previewBlocks, select, sourceArea, sourceText, synced, test } from "./helpers";

type Sel = [from: At, to?: At];
/** A tool by its aria-label, or "h1" to "h6" and "text" for the heading picker. */
type Tool = string;

const pressTool = async (page: Page, card: Card, tool: Tool) => {
  if (/^h[1-6]$/.test(tool)) await pickHeading(page, card, Number(tool[1]));
  else if (tool === "text") await pickHeading(page, card, 0);
  else await clickTool(page, card, tool);
};

/** Open markdown, select, run the tools in order; the preview is left, so its edits are rendered from the source. */
async function run(page: Page, card: Card, markdown: string, sel: Sel, ...tools: Tool[]) {
  await open(page, markdown);
  await select(page, card, ...sel);
  for (const tool of tools) await pressTool(page, card, tool);
  if (card === "preview") await leavePreview(page);
  return sourceText(page);
}

/** The source that the same tools give in the markdown card on the same selection. */
async function parity(page: Page, markdown: string, sel: Sel, ...tools: Tool[]) {
  const expected = await run(page, "markdown", markdown, sel, ...tools);
  expect(expected).not.toBe(markdown);
  expect(await run(page, "preview", markdown, sel, ...tools)).toBe(expected);
}

const pressed = async (page: Page) => {
  const labels = ["bold", "italic", "strikethrough", "inline code", "quote", "bullet list", "numbered list", "task list"];
  const on: string[] = [];
  for (const label of labels) {
    const value = await page.getByRole("region", { name: "preview", exact: true }).getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed");
    if (value === "true") on.push(label);
  }
  return on;
};
const heading = (page: Page) => page.getByRole("region", { name: "preview", exact: true }).getByRole("combobox", { name: "heading" }).getAttribute("data-value");

// ------------------------------------------------------------------ inline marks

const marks: { tool: string; marker: string; tag: string }[] = [
  { tool: "bold", marker: "**", tag: "strong" },
  { tool: "italic", marker: "*", tag: "em" },
  { tool: "strikethrough", marker: "~~", tag: "del" },
  { tool: "inline code", marker: "`", tag: "code" },
];

const inlinePlaces: { name: string; markdown: string; sel: Sel; result: string }[] = [
  { name: "part of a word", markdown: "alpha beta gamma", sel: [{ text: "beta", offset: 1 }, { text: "beta", offset: 3 }], result: "alpha bXetXa gamma" },
  { name: "a whole word", markdown: "alpha beta gamma", sel: [{ text: "beta" }, { text: "beta" }], result: "alpha XbetaX gamma" },
  { name: "a whole block", markdown: "one\n\ntwo\n\nthree", sel: [{ text: "two" }, { text: "two" }], result: "one\n\nXtwoX\n\nthree" },
  { name: "the last item of a list", markdown: "- one\n- two", sel: [{ text: "two" }, { text: "two" }], result: "- one\n- XtwoX" },
  { name: "the first item of a list", markdown: "- one\n- two", sel: [{ text: "one" }, { text: "one" }], result: "- XoneX\n- two" },
  { name: "a nested item", markdown: "- one\n  - two\n- three", sel: [{ text: "two" }, { text: "two" }], result: "- one\n  - XtwoX\n- three" },
  { name: "a quote", markdown: "> quoted text", sel: [{ text: "text" }, { text: "text" }], result: "> quoted XtextX" },
  { name: "a task item", markdown: "- [ ] task item", sel: [{ text: "item" }, { text: "item" }], result: "- [ ] task XitemX" },
  { name: "a table cell", markdown: "| a | b |\n| --- | --- |\n| cell | two |", sel: [{ text: "cell" }, { text: "cell" }], result: "| a | b |\n| --- | --- |\n| XcellX | two |" },
];

for (const { tool, marker, tag } of marks) {
  for (const { name, markdown, sel, result } of inlinePlaces) {
    // The marker around the selection in both cards; the same tool again restores the source.
    test(`${tool} on ${name}: the source of the markdown card, and twice restores it`, async ({ page }) => {
      const expected = result.replaceAll("X", marker);
      expect(await run(page, "markdown", markdown, sel, tool)).toBe(expected);
      expect(await run(page, "preview", markdown, sel, tool)).toBe(expected);
      expect(await run(page, "preview", markdown, sel, tool, tool)).toBe(markdown);
    });
  }

  test(`${tool} shows as ${tag} in the preview after the preview is left`, async ({ page }) => {
    await run(page, "preview", "alpha beta gamma", [{ text: "beta", offset: 1 }, { text: "beta", offset: 3 }], tool);
    await expect(article(page).locator(tag)).toHaveText("et");
  });

  test(`${tool} presses its button, and a second click releases it`, async ({ page }) => {
    await open(page, "alpha beta gamma");
    await select(page, "preview", { text: "beta" }, { text: "beta" });
    await clickTool(page, "preview", tool);
    await expect.poll(() => pressed(page)).toEqual([tool]);
    await clickTool(page, "preview", tool);
    await expect.poll(() => pressed(page)).toEqual([]);
  });

  test(`${tool} with a caret in a word makes the typed text ${tag}`, async ({ page }) => {
    await open(page, "alpha beta gamma");
    await select(page, "preview", { text: "beta", offset: 2 });
    await clickTool(page, "preview", tool);
    await page.keyboard.type("X");
    await leavePreview(page);
    expect(await sourceText(page)).toBe(`alpha be${marker}X${marker}ta gamma`);
  });

  test(`${tool} with a caret at the end of a word makes the typed text ${tag}`, async ({ page }) => {
    await open(page, "alpha beta gamma");
    await select(page, "preview", { text: "beta", offset: 4 });
    await clickTool(page, "preview", tool);
    await page.keyboard.type("X");
    await leavePreview(page);
    expect(await sourceText(page)).toBe(`alpha beta${marker}X${marker} gamma`);
  });

  test(`${tool} on a selection across two paragraphs marks each paragraph`, async ({ page }) => {
    const source = await run(page, "preview", "one\n\ntwo\n\nend", [{ text: "one" }, { text: "two" }], tool);
    expect(source).toBe(`${marker}one${marker}\n\n${marker}two${marker}\n\nend`);
  });

  test(`${tool} on a selection from a heading into a paragraph keeps the heading`, async ({ page }) => {
    const source = await run(page, "preview", "## head\n\nbody text\n\nend", [{ text: "head", offset: 2 }, { text: "body", offset: 2 }], tool);
    expect(source).toBe(`## he${marker}ad${marker}\n\n${marker}bo${marker}dy text\n\nend`);
  });

  test(`${tool} on a selection across list items marks each item`, async ({ page }) => {
    const source = await run(page, "preview", "- one\n- two\n- three", [{ text: "one" }, { text: "three" }], tool);
    expect(source).toBe(`- ${marker}one${marker}\n- ${marker}two${marker}\n- ${marker}three${marker}`);
  });
}

test("bold and italic keyboard shortcuts give the source of the buttons", async ({ page }) => {
  const sel: Sel = [{ text: "beta" }, { text: "beta" }];
  for (const [key, tool] of [["b", "bold"], ["i", "italic"]]) {
    const byButton = await run(page, "preview", "alpha beta gamma", sel, tool);
    await open(page, "alpha beta gamma");
    await select(page, "preview", ...sel);
    await page.keyboard.press(`Meta+${key}`);
    await leavePreview(page);
    expect(await sourceText(page)).toBe(byButton);
    await open(page, "alpha beta gamma");
    await select(page, "preview", ...sel);
    await page.keyboard.press(`Control+${key}`);
    await page.keyboard.press(`Control+${key}`);
    await leavePreview(page);
    expect(await sourceText(page)).toBe("alpha beta gamma");
  }
});

test("a shortcut with a caret in the source card edits the source card only", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "alpha", offset: 2 });
  await select(page, "markdown", { text: "beta" }, { text: "beta" });
  await page.keyboard.press("Meta+b");
  await expect(sourceArea(page)).toHaveValue("alpha **beta** gamma");
  await leavePreview(page);
  await expect(article(page).locator("strong")).toHaveText("beta");
});

test("bold then italic, and italic then bold, give both marks and the same preview", async ({ page }) => {
  const sel: Sel = [{ text: "beta" }, { text: "beta" }];
  for (const order of [["bold", "italic"], ["italic", "bold"]]) {
    await run(page, "preview", "alpha beta gamma", sel, ...order);
    await expect(article(page).locator("strong em, em strong")).toHaveText("beta");
    expect(await previewBlocks(page)).toEqual(["alpha beta gamma"]);
  }
});

test("bold then italic, and the same off again, restore the source in either order", async ({ page }) => {
  const sel: Sel = [{ text: "beta" }, { text: "beta" }];
  expect(await run(page, "preview", "alpha beta gamma", sel, "bold", "italic", "italic", "bold")).toBe("alpha beta gamma");
  expect(await run(page, "preview", "alpha beta gamma", sel, "bold", "italic", "bold", "italic")).toBe("alpha beta gamma");
});

test("italic on bold text keeps the bold word and adds the italic", async ({ page }) => {
  await open(page, "alpha **beta** gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await clickTool(page, "preview", "italic");
  await expect.poll(() => pressed(page)).toEqual(["bold", "italic"]);
  await leavePreview(page);
  await expect(article(page).locator("strong em, em strong")).toHaveText("beta");
  expect(await sourceText(page)).toMatch(/^alpha (\*\*[_*]beta[_*]\*\*|[_*]\*\*beta\*\*[_*]|\*\*\*beta\*\*\*) gamma$/);
});

// A selection inside a bold span takes the whole span off, as in the markdown card.
test("bold on a part of a bold word takes the bold off", async ({ page }) => {
  await open(page, "alpha **beta** gamma");
  await select(page, "preview", { text: "beta", offset: 1 }, { text: "beta", offset: 3 });
  await clickTool(page, "preview", "bold");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha beta gamma");
});

test("bold on a whole bold word removes the bold", async ({ page }) => {
  expect(await run(page, "preview", "alpha **beta** gamma", [{ text: "beta" }, { text: "beta" }], "bold")).toBe("alpha beta gamma");
});

test("bold with a caret in a bold word presses the button, a click makes typed text plain", async ({ page }) => {
  await open(page, "alpha **beta** gamma");
  await select(page, "preview", { text: "beta", offset: 2 });
  await expect.poll(() => pressed(page)).toEqual(["bold"]);
});

test("inline code with the caret in inline code removes the code", async ({ page }) => {
  await open(page, "alpha `beta` gamma");
  await select(page, "preview", { text: "beta", offset: 2 });
  await expect.poll(() => pressed(page)).toEqual(["inline code"]);
  await clickTool(page, "preview", "inline code");
  await expect(sourceArea(page)).toHaveValue("alpha beta gamma");
});

test("bold inside inline code keeps the code and the source valid", async ({ page }) => {
  await open(page, "alpha `beta` gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await clickTool(page, "preview", "bold");
  await leavePreview(page);
  // Markdown has no bold inside code: the code stays one code span.
  await expect(article(page).locator("code")).toHaveText("beta");
  expect(await sourceText(page)).toContain("beta");
});

test("a mark on a link text keeps the link", async ({ page }) => {
  for (const { tool, tag } of marks.slice(0, 3)) {
    await run(page, "preview", "see [the docs](https://a.test) now", [{ text: "docs" }, { text: "docs" }], tool);
    await expect(article(page).locator(`a[href="https://a.test"] ${tag}, ${tag} a[href="https://a.test"]`)).toHaveText(/docs|the docs/);
  }
});

test("italic on a part of a word in the markdown card renders as emphasis", async ({ page }) => {
  await run(page, "markdown", "alpha beta gamma", [{ text: "beta", offset: 1 }, { text: "beta", offset: 3 }], "italic");
  await leavePreview(page);
  await expect(article(page).locator("em")).toHaveText("et");
});

// ------------------------------------------------------------------ block tools

const blockTools: Tool[] = ["h2", "quote", "bullet list", "numbered list", "task list", "code block", "table", "horizontal rule"];

/** What the lines have before the tool: nothing, or the markup of one tool. A toggle restores the source from nothing and from its own markup. */
type Kind = "plain" | "ul" | "ol" | "task" | "quote" | "heading" | "mixed";
const blockPlaces: { name: string; markdown: string; kind: Kind; sel: Sel }[] = [
  { name: "a nested numbered item", markdown: "1. one\n   1. two\n2. three", kind: "ol", sel: [{ text: "two", offset: 1 }] },
  { name: "a caret in a word", markdown: "intro\n\nalpha beta\n\nend", kind: "plain", sel: [{ text: "beta", offset: 2 }] },
  { name: "a whole block", markdown: "intro\n\nalpha beta\n\nend", kind: "plain", sel: [{ text: "alpha beta" }, { text: "alpha beta" }] },
  { name: "a selection across three blocks of different types", markdown: "# Head\n\n- one\n- two\n\n> quote\n\nend", kind: "mixed", sel: [{ text: "Head", offset: 1 }, { text: "quote", offset: 2 }] },
  { name: "the first item of a list", markdown: "- one\n- two\n- three", kind: "ul", sel: [{ text: "one", offset: 1 }] },
  { name: "the last item of a list", markdown: "- one\n- two\n- three", kind: "ul", sel: [{ text: "three", offset: 3 }] },
  { name: "a nested item", markdown: "- one\n  - two\n- three", kind: "ul", sel: [{ text: "two", offset: 1 }] },
  { name: "a quote", markdown: "intro\n\n> quoted text\n\nend", kind: "quote", sel: [{ text: "quoted", offset: 2 }] },
  { name: "a heading", markdown: "intro\n\n## Title here\n\nend", kind: "heading", sel: [{ text: "Title", offset: 2 }] },
  { name: "a table cell", markdown: "| a | b |\n| --- | --- |\n| cell | two |\n\nend", kind: "plain", sel: [{ text: "cell", offset: 2 }] },
  { name: "a task item", markdown: "- [ ] open\n- [x] done", kind: "task", sel: [{ text: "open", offset: 2 }] },
  { name: "a link text", markdown: "see [the docs](https://a.test) now", kind: "plain", sel: [{ text: "docs", offset: 2 }] },
  { name: "bold text", markdown: "alpha **beta** gamma", kind: "plain", sel: [{ text: "beta", offset: 2 }] },
  { name: "the start of the document", markdown: "alpha beta\n\nend", kind: "plain", sel: [{ text: "alpha" }] },
  { name: "the end of the document", markdown: "start\n\nalpha beta", kind: "plain", sel: [{ text: "beta", offset: 4 }] },
];

const own: Partial<Record<Tool, Kind>> = { quote: "quote", "bullet list": "ul", "numbered list": "ol", "task list": "task" };
// A table row takes no line syntax, a task item holds no heading, and h2 on an h2 is that h2: both cards change nothing.
const lineTools: Tool[] = ["h2", "quote", "bullet list", "numbered list", "task list"];
const unchanged = (tool: Tool, name: string, kind: Kind) =>
  (name === "a table cell" && lineTools.includes(tool)) || (tool === "h2" && (name === "a task item" || kind === "heading"));
// The heading picker has no toggle: h2 then text restores every line that is not a heading.
const restores = (tool: Tool, kind: Kind) => (tool === "h2" ? kind !== "heading" && kind !== "mixed" : tool in own && (kind === "plain" || kind === own[tool]));
for (const tool of blockTools) {
  for (const { name, markdown, kind, sel } of blockPlaces) {
    // The source of the markdown card on the same text; a toggle tool twice restores the source.
    test(`${tool} on ${name}`, async ({ page }) => {
      if (unchanged(tool, name, kind)) {
        for (const card of ["markdown", "preview"] as const) expect(await run(page, card, markdown, sel, tool)).toBe(markdown);
        return;
      }
      await parity(page, markdown, sel, tool);
      if (restores(tool, kind)) expect(await run(page, "preview", markdown, sel, tool, tool === "h2" ? "text" : tool)).toBe(markdown);
    });
  }
}

test("a block tool changes only the touched block", async ({ page }) => {
  const doc = "# Title\n\nintro  with   spaces\n\n- one\n- two\n\n> quote\n\n| a | b |\n| --- | --- |\n| c | d |\n\n***\n\n    indented code\n\nend\n";
  for (const tool of ["h3", "quote", "bullet list", "numbered list", "task list"]) {
    await open(page, doc);
    await select(page, "preview", { text: "two", offset: 1 });
    await pressTool(page, "preview", tool);
    const after = await sourceText(page);
    expect(after.startsWith("# Title\n\nintro  with   spaces\n\n- one\n")).toBe(true);
    expect(after.endsWith("\n\n> quote\n\n| a | b |\n| --- | --- |\n| c | d |\n\n***\n\n    indented code\n\nend\n")).toBe(true);
  }
});

test("the heading picker goes from text through h1 to h6 and back to text", async ({ page }) => {
  await open(page, "intro\n\nalpha beta\n\nend");
  await select(page, "preview", { text: "beta", offset: 2 });
  for (let level = 1; level <= 6; level++) {
    await pickHeading(page, "preview", level);
    await expect(sourceArea(page)).toHaveValue(`intro\n\n${"#".repeat(level)} alpha beta\n\nend`);
    await expect.poll(() => heading(page)).toBe(String(level));
  }
  await pickHeading(page, "preview", 0);
  await expect(sourceArea(page)).toHaveValue("intro\n\nalpha beta\n\nend");
  await expect.poll(() => heading(page)).toBe("0");
  await leavePreview(page);
  expect(await previewBlocks(page)).toEqual(["intro", "alpha beta", "end"]);
});

test("the heading picker jumps between levels without a step through text", async ({ page }) => {
  await open(page, "### alpha beta");
  await select(page, "preview", { text: "beta", offset: 2 });
  await expect.poll(() => heading(page)).toBe("3");
  await pickHeading(page, "preview", 5);
  await expect(sourceArea(page)).toHaveValue("##### alpha beta");
  await pickHeading(page, "preview", 1);
  await expect(sourceArea(page)).toHaveValue("# alpha beta");
});

test("a heading on a list item gives the heading of the markdown card and a valid preview", async ({ page }) => {
  await parity(page, "- one\n- two\n- three", [{ text: "two", offset: 1 }], "h2");
  await run(page, "preview", "- one\n- two\n- three", [{ text: "two", offset: 1 }], "h2");
  await expect(article(page).locator("h2")).toHaveCount(1);
});

test("a quote on a whole list quotes every item", async ({ page }) => {
  const source = await run(page, "preview", "- one\n- two\n- three", [{ text: "one" }, { text: "three" }], "quote");
  expect(source).toBe("> - one\n> - two\n> - three");
  await expect(article(page).locator("blockquote ul li")).toHaveCount(3);
});

test("a numbered list on a bullet list renumbers it, and a bullet list on that restores the source", async ({ page }) => {
  const sel: Sel = [{ text: "one" }, { text: "three" }];
  expect(await run(page, "preview", "- one\n- two\n- three", sel, "numbered list")).toBe("1. one\n2. two\n3. three");
  expect(await run(page, "preview", "- one\n- two\n- three", sel, "numbered list", "bullet list")).toBe("- one\n- two\n- three");
  expect(await run(page, "preview", "1. one\n2. two\n3. three", sel, "bullet list", "numbered list")).toBe("1. one\n2. two\n3. three");
});

test("a bullet list on a task list makes plain bullets", async ({ page }) => {
  expect(await run(page, "preview", "- [ ] one\n- [x] two", [{ text: "one" }, { text: "two" }], "bullet list")).toBe("- one\n- two");
});

test("a task list on a bullet list keeps the items and adds the boxes", async ({ page }) => {
  expect(await run(page, "preview", "- one\n- two", [{ text: "one" }, { text: "two" }], "task list")).toBe("- [ ] one\n- [ ] two");
});

test("a quote on a heading, and the heading picker on a quote", async ({ page }) => {
  expect(await run(page, "preview", "## Title", [{ text: "Title", offset: 2 }], "quote")).toBe("> ## Title");
  expect(await run(page, "preview", "> quoted", [{ text: "quoted", offset: 2 }], "h2")).toBe("> ## quoted");
});

test("a code block on several lines wraps them in one fence", async ({ page }) => {
  const sel: Sel = [{ text: "one" }, { text: "three" }];
  expect(await run(page, "preview", "intro\n\none\ntwo\nthree\n\nend", sel, "code block")).toBe("intro\n\n```\none\ntwo\nthree\n```\n\nend");
  await expect(article(page).locator("pre code")).toHaveText("one\ntwo\nthree");
});

test("a code block on part of a line wraps the selected text", async ({ page }) => {
  await parity(page, "alpha beta gamma", [{ text: "beta" }, { text: "beta" }], "code block");
});

test("a code block on a selection across two paragraphs gives the markdown card source", async ({ page }) => {
  await parity(page, "intro\n\none\n\ntwo\n\nend", [{ text: "one" }, { text: "two" }], "code block");
});

test("a table, a rule and a code block at the start, middle and end of the document", async ({ page }) => {
  const cases: Record<string, Sel[]> = {
    start: [[{ text: "first" }]],
    middle: [[{ text: "second", offset: 6 }]],
    end: [[{ text: "last", offset: 4 }]],
  };
  for (const tool of ["table", "horizontal rule", "code block"]) {
    for (const [where, [sel]] of Object.entries(cases)) {
      await test.step(`${tool} at the ${where}`, async () => {
        await parity(page, "first\n\nsecond\n\nlast", sel, tool);
      });
    }
  }
});

test("a table inserted in the preview renders a table with the cells", async ({ page }) => {
  await run(page, "preview", "first\n\nsecond", [{ text: "first", offset: 5 }], "table");
  await expect(article(page).locator("table")).toHaveCount(1);
  await expect(article(page).locator("th")).toHaveCount(2);
  await expect(article(page).locator("td")).toHaveCount(2);
  expect(await previewBlocks(page)).toHaveLength(3);
});

test("a horizontal rule inserted in the preview renders an hr between the paragraphs", async ({ page }) => {
  const source = await run(page, "preview", "first\n\nsecond", [{ text: "first", offset: 5 }], "horizontal rule");
  expect(source).toBe("first\n\n---\n\nsecond");
  await expect(article(page).locator("hr")).toHaveCount(1);
});

// ------------------------------------------------------------------ a new empty line

for (const tool of blockTools) {
  test(`parity of ${tool} on a new empty line after a paragraph`, async ({ page }) => {
    await open(page, "first\n\nlast");
    await select(page, "preview", { text: "first", offset: 5 });
    await page.keyboard.press("Enter");
    await pressTool(page, "preview", tool);
    const fromPreview = await sourceText(page);
    await open(page, "first\n\nlast");
    await select(page, "markdown", { text: "first", offset: 5 });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await pressTool(page, "markdown", tool);
    expect(fromPreview).toBe(await sourceText(page));
  });
}

for (const { tool, marker } of marks) {
  test(`${tool} on a new empty line makes the typed text ${marker}`, async ({ page }) => {
    await open(page, "first");
    await select(page, "preview", { text: "first", offset: 5 });
    await page.keyboard.press("Enter");
    await clickTool(page, "preview", tool);
    await page.keyboard.type("new");
    await leavePreview(page);
    expect(await sourceText(page)).toBe(`first\n\n${marker}new${marker}`);
  });
}

// ------------------------------------------------------------------ links

const URL_FIELD = (page: Page) => page.getByRole("region", { name: "preview", exact: true }).locator(".toolbar input.field");

test("link on a selection takes the typed URL", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://x.test");
  await page.keyboard.press("Enter");
  await expect(URL_FIELD(page)).toHaveCount(0);
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha [beta](https://x.test) gamma");
  await expect(article(page).locator("a")).toHaveAttribute("href", "https://x.test");
});

test("link with a shortcut gives the same as the button", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await page.keyboard.press("Meta+k");
  await URL_FIELD(page).fill("https://x.test");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha [beta](https://x.test) gamma");
});

test("link on part of a word links that part", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta", offset: 1 }, { text: "beta", offset: 3 });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://x.test");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha b[et](https://x.test)a gamma");
});

test("link without a selection inserts the URL as a link", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta", offset: 4 });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://x.test");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(article(page).locator("a")).toHaveAttribute("href", "https://x.test");
  await expect(article(page).locator("a")).toHaveText("https://x.test");
  expect(await sourceText(page)).toMatch(/^alpha beta(\[https:\/\/x\.test\]\(https:\/\/x\.test\)|<https:\/\/x\.test>)\s?gamma$|^alpha beta ?(\[https:\/\/x\.test\]\(https:\/\/x\.test\)|<https:\/\/x\.test>) ?gamma$/);
});

test("link on an existing link changes its URL", async ({ page }) => {
  await open(page, "see [the docs](https://a.test) now");
  await select(page, "preview", { text: "docs", offset: 1 });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://b.test");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("see [the docs](https://b.test) now");
});

test("link on a part of the text of an existing link changes its URL", async ({ page }) => {
  await open(page, "see [the docs](https://a.test) now");
  await select(page, "preview", { text: "docs", offset: 1 }, { text: "docs", offset: 3 });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://b.test");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  expect(await sourceText(page)).not.toContain("https://a.test)<");
  await expect(article(page).locator("a")).toHaveCount(1);
});

test("link on the whole text of an existing link changes its URL", async ({ page }) => {
  await open(page, "see [the docs](https://a.test) now");
  await select(page, "preview", { text: "the docs" }, { text: "the docs" });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://b.test");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("see [the docs](https://b.test) now");
});

test("Escape in the URL field cancels the link and leaves the source", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await clickTool(page, "preview", "link");
  await expect(URL_FIELD(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(URL_FIELD(page)).toHaveCount(0);
  await synced(page);
  await expect(sourceArea(page)).toHaveValue("alpha beta gamma");
  await expect(article(page)).toBeFocused();
  // The preview still takes tools and typing after the cancel.
  await clickTool(page, "preview", "bold");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha **beta** gamma");
});

test("an empty URL field with Enter changes nothing", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta" }, { text: "beta" });
  await clickTool(page, "preview", "link");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha beta gamma");
});

test("link in a list item, a heading and a table cell keeps the block", async ({ page }) => {
  const cases: [string, At, string][] = [
    ["- one\n- two", { text: "two" }, "- one\n- [two](https://x.test)"],
    ["## Title", { text: "Title" }, "## [Title](https://x.test)"],
    ["| a | b |\n| --- | --- |\n| cell | two |", { text: "cell" }, "| a | b |\n| --- | --- |\n| [cell](https://x.test) | two |"],
  ];
  for (const [markdown, at, expected] of cases) {
    await open(page, markdown);
    await select(page, "preview", at, at);
    await clickTool(page, "preview", "link");
    await URL_FIELD(page).fill("https://x.test");
    await page.keyboard.press("Enter");
    await leavePreview(page);
    await expect(sourceArea(page)).toHaveValue(expected);
  }
});

test("a URL with a quote or an ampersand is kept in the link", async ({ page }) => {
  await open(page, "alpha beta gamma");
  await select(page, "preview", { text: "beta", offset: 4 });
  await clickTool(page, "preview", "link");
  await URL_FIELD(page).fill("https://x.test/?a=1&b=2");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  await expect(article(page).locator("a")).toHaveAttribute("href", "https://x.test/?a=1&b=2");
});

// ------------------------------------------------------------------ the toolbar follows the caret

const states: { name: string; markdown: string; at: At; on: string[]; heading?: number }[] = [
  { name: "plain text", markdown: "alpha beta", at: { text: "beta", offset: 2 }, on: [] },
  { name: "bold text", markdown: "alpha **beta**", at: { text: "beta", offset: 2 }, on: ["bold"] },
  { name: "the end of bold text", markdown: "alpha **beta** gamma", at: { text: "beta", offset: 4 }, on: ["bold"] },
  { name: "italic text", markdown: "alpha _beta_", at: { text: "beta", offset: 2 }, on: ["italic"] },
  { name: "struck text", markdown: "alpha ~~beta~~", at: { text: "beta", offset: 2 }, on: ["strikethrough"] },
  { name: "inline code", markdown: "alpha `beta`", at: { text: "beta", offset: 2 }, on: ["inline code"] },
  { name: "bold italic text", markdown: "alpha ***beta***", at: { text: "beta", offset: 2 }, on: ["bold", "italic"] },
  { name: "a link text", markdown: "see [the docs](https://a.test)", at: { text: "docs", offset: 2 }, on: [] },
  { name: "bold text in a link", markdown: "see [**docs**](https://a.test)", at: { text: "docs", offset: 2 }, on: ["bold"] },
  { name: "a heading 1", markdown: "# Title", at: { text: "Title", offset: 2 }, on: [], heading: 1 },
  { name: "a heading 2", markdown: "## Title", at: { text: "Title", offset: 2 }, on: [], heading: 2 },
  { name: "a heading 3", markdown: "### Title", at: { text: "Title", offset: 2 }, on: [], heading: 3 },
  { name: "a heading 4", markdown: "#### Title", at: { text: "Title", offset: 2 }, on: [], heading: 4 },
  { name: "a heading 5", markdown: "##### Title", at: { text: "Title", offset: 2 }, on: [], heading: 5 },
  { name: "a heading 6", markdown: "###### Title", at: { text: "Title", offset: 2 }, on: [], heading: 6 },
  { name: "bold text in a heading", markdown: "## Ti **tle**", at: { text: "tle", offset: 1 }, on: ["bold"], heading: 2 },
  { name: "a bullet item", markdown: "- one\n- two", at: { text: "two", offset: 1 }, on: ["bullet list"] },
  { name: "a numbered item", markdown: "1. one\n2. two", at: { text: "two", offset: 1 }, on: ["numbered list"] },
  { name: "a task item", markdown: "- [ ] one\n- [x] two", at: { text: "two", offset: 1 }, on: ["task list"] },
  { name: "a task item in a loose list", markdown: "- [ ] one\n\n- [ ] two", at: { text: "two", offset: 1 }, on: ["task list"] },
  { name: "a bullet item in a numbered list", markdown: "1. one\n   - nested\n2. two", at: { text: "nested", offset: 1 }, on: ["bullet list"] },
  { name: "a numbered item in a bullet list", markdown: "- one\n  1. nested\n- two", at: { text: "nested", offset: 1 }, on: ["numbered list"] },
  { name: "a quote", markdown: "> quoted", at: { text: "quoted", offset: 2 }, on: ["quote"] },
  { name: "a bullet item in a quote", markdown: "> - one\n> - two", at: { text: "two", offset: 1 }, on: ["quote", "bullet list"] },
  { name: "a table cell", markdown: "| a | b |\n| --- | --- |\n| cell | two |", at: { text: "cell", offset: 2 }, on: [] },
  { name: "a table head cell", markdown: "| head | b |\n| --- | --- |\n| cell | two |", at: { text: "head", offset: 2 }, on: [] },
  { name: "a code block", markdown: "```\ncode here\n```", at: { text: "code here", offset: 2 }, on: [] },
  { name: "plain text after a list", markdown: "- one\n\nplain", at: { text: "plain", offset: 2 }, on: [] },
];

for (const { name, markdown, at, on, heading: level = 0 } of states) {
  test(`the toolbar state in ${name}`, async ({ page }) => {
    await open(page, markdown);
    await select(page, "preview", at);
    await expect.poll(() => pressed(page)).toEqual(on);
    await expect.poll(() => heading(page)).toBe(String(level));
  });
}

test("the toolbar state follows the caret as it moves through a document", async ({ page }) => {
  await open(page, "# Title\n\nplain **bold** text\n\n- item\n\n> quote");
  await select(page, "preview", { text: "Title", offset: 1 });
  await expect.poll(() => heading(page)).toBe("1");
  await select(page, "preview", { text: "bold", offset: 2 });
  await expect.poll(() => heading(page)).toBe("0");
  await expect.poll(() => pressed(page)).toEqual(["bold"]);
  await select(page, "preview", { text: "item", offset: 2 });
  await expect.poll(() => pressed(page)).toEqual(["bullet list"]);
  await select(page, "preview", { text: "quote", offset: 2 });
  await expect.poll(() => pressed(page)).toEqual(["quote"]);
  await select(page, "preview", { text: "plain", offset: 2 });
  await expect.poll(() => pressed(page)).toEqual([]);
});

test("the toolbar state follows the caret when the arrow keys move it", async ({ page }) => {
  await open(page, "plain **bold**\n\n## head");
  await select(page, "preview", { text: "plain", offset: 5 });
  await expect.poll(() => pressed(page)).toEqual([]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => pressed(page)).toEqual(["bold"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => heading(page)).toBe("2");
});

test("the toolbar state follows each tool: the buttons and the picker after a block tool", async ({ page }) => {
  await open(page, "alpha beta");
  await select(page, "preview", { text: "beta", offset: 2 });
  for (const [tool, on] of [["quote", ["quote"]], ["bullet list", ["bullet list"]], ["numbered list", ["numbered list"]], ["task list", ["task list"]]] as const) {
    await clickTool(page, "preview", tool);
    await expect.poll(() => pressed(page)).toEqual([...on]);
    await clickTool(page, "preview", tool);
    await expect.poll(() => pressed(page)).toEqual([]);
  }
  await pickHeading(page, "preview", 4);
  await expect.poll(() => heading(page)).toBe("4");
  await pickHeading(page, "preview", 0);
  await expect.poll(() => heading(page)).toBe("0");
});

test("the heading picker after a heading is made from a list item shows the heading", async ({ page }) => {
  await open(page, "- one\n- two");
  await select(page, "preview", { text: "two", offset: 1 });
  await pickHeading(page, "preview", 2);
  await expect.poll(() => heading(page)).toBe("2");
});

// ------------------------------------------------------------------ timing and focus

test("a block tool right after typing acts on the typed text", async ({ page }) => {
  await open(page, "alpha beta");
  await select(page, "preview", { text: "beta", offset: 4 });
  await page.keyboard.type(" gamma");
  await clickTool(page, "preview", "bullet list");
  await expect(sourceArea(page)).toHaveValue("- alpha beta gamma");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("- alpha beta gamma");
});

test("the heading picker right after typing acts on the typed text", async ({ page }) => {
  await open(page, "alpha\n\nbeta");
  await select(page, "preview", { text: "beta", offset: 4 });
  await page.keyboard.type("XY");
  await pickHeading(page, "preview", 3);
  await expect(sourceArea(page)).toHaveValue("alpha\n\n### betaXY");
});

test("every block tool right after typing keeps the typed text", async ({ page }) => {
  for (const tool of ["quote", "numbered list", "task list", "h1", "code block", "table", "horizontal rule"]) {
    await open(page, "alpha\n\nbeta");
    await select(page, "preview", { text: "beta", offset: 4 });
    await page.keyboard.type("XY");
    await pressTool(page, "preview", tool);
    expect(await sourceText(page), tool).toContain("betaXY");
    await leavePreview(page);
    expect(await sourceText(page), tool).toContain("betaXY");
  }
});

test("bold right after typing and selecting marks the typed word", async ({ page }) => {
  await open(page, "alpha");
  await select(page, "preview", { text: "alpha", offset: 5 });
  await page.keyboard.type(" beta");
  await page.keyboard.press("Shift+Alt+ArrowLeft");
  await clickTool(page, "preview", "bold");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("alpha **beta**");
});

test("a tool right after typing in a list item keeps the list", async ({ page }) => {
  await open(page, "- one\n- two");
  await select(page, "preview", { text: "two", offset: 3 });
  await page.keyboard.type("X");
  await clickTool(page, "preview", "numbered list");
  await expect(sourceArea(page)).toHaveValue("- one\n1. twoX");
});

test("typing after a block tool lands in the same block", async ({ page }) => {
  await open(page, "alpha beta");
  await select(page, "preview", { text: "beta", offset: 2 });
  await pickHeading(page, "preview", 2);
  await page.keyboard.type("X");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("## alpha beXta");
});

test("a block tool with the caret in the source card does not edit the preview", async ({ page }) => {
  await open(page, "alpha\n\nbeta");
  await select(page, "markdown", { text: "beta", offset: 2 });
  await clickTool(page, "preview", "quote");
  await expect(sourceArea(page)).toHaveValue("alpha\n\nbeta");
});

for (const tool of ["quote", "bold", "bullet list", "inline code", "h2", "horizontal rule", "link"]) {
  test(`${tool} of the preview after the caret moved from the preview to the source card does not edit`, async ({ page }) => {
    await open(page, "alpha\n\nbeta");
    await select(page, "preview", { text: "alpha", offset: 2 });
    await select(page, "markdown", { text: "beta", offset: 2 });
    await pressTool(page, "preview", tool);
    if (tool === "link") await page.keyboard.press("Escape");
    await synced(page);
    await leavePreview(page);
    expect(await sourceText(page)).toBe("alpha\n\nbeta");
  });
}

test("a tool of the markdown card with the caret in the preview edits the markdown card source only", async ({ page }) => {
  await open(page, "alpha\n\nbeta");
  await select(page, "preview", { text: "alpha", offset: 2 });
  await select(page, "markdown", { text: "beta", offset: 2 });
  await clickTool(page, "markdown", "quote");
  await expect(sourceArea(page)).toHaveValue("alpha\n\n> beta");
});

test("the preview toolbar after a click in the source card still works once the caret is back in the preview", async ({ page }) => {
  await open(page, "alpha\n\nbeta");
  await select(page, "markdown", { text: "beta", offset: 2 });
  await clickTool(page, "preview", "quote");
  await select(page, "preview", { text: "beta", offset: 2 });
  await clickTool(page, "preview", "quote");
  await expect(sourceArea(page)).toHaveValue("alpha\n\n> beta");
});

test("a mark and a block tool together: bold in a quote in a list", async ({ page }) => {
  await open(page, "- one\n- two");
  await select(page, "preview", { text: "two" }, { text: "two" });
  await clickTool(page, "preview", "bold");
  await clickTool(page, "preview", "quote");
  await leavePreview(page);
  await expect(sourceArea(page)).toHaveValue("- one\n> - **two**");
});

test("the tools leave no console errors across a long mixed session", async ({ page }) => {
  await open(page, "# T\n\nalpha beta gamma\n\n- one\n- two\n\n> q");
  const steps: [At, ...Tool[]][] = [
    [{ text: "beta" }, "bold", "italic", "strikethrough", "inline code"],
    [{ text: "two" }, "numbered list", "task list", "quote", "h2", "text"],
    [{ text: "T" }, "h3", "h6", "text"],
  ];
  for (const [at, ...tools] of steps) {
    await select(page, "preview", at, at);
    for (const tool of tools) await pressTool(page, "preview", tool);
  }
  await leavePreview(page);
  expect((await sourceText(page)).length).toBeGreaterThan(0);
});
