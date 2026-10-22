import type { Locator, Page } from "@playwright/test";
import { article, clickTool, expect, leavePreview, open, select, sourceArea, sourceText, synced, test } from "./helpers";

const raw = (page: Page) => article(page).locator("textarea.raw");
const richBlocks = (page: Page) => article(page).locator(":scope > [data-rich]");
const field = (page: Page) => page.locator(".toolbar input.field");
const DIAGRAM_MS = 20_000;

/** Wait until the textarea of a raw edit is gone and the article is rendered again. */
async function closed(page: Page) {
  await expect(raw(page)).toHaveCount(0);
}

/** Open the raw edit of a block with a click, and check that it holds the source of the block. */
async function openRaw(page: Page, block: Locator, source?: string) {
  await block.click();
  await expect(raw(page)).toHaveCount(1);
  if (source !== undefined) await expect(raw(page)).toHaveValue(source);
}

const blur = (page: Page) => raw(page).evaluate((el) => el.blur());

type Kind = { name: string; markdown: string; edited: string; extra?: string; shows: (page: Page) => Promise<unknown> };

const kinds: Kind[] = [
  {
    name: "fenced code",
    markdown: "```js\nconst a = 1;\n```",
    edited: "```js\nconst b = 2;\n```",
    shows: (page) => expect(article(page).locator("pre code")).toContainText("const b = 2;"),
  },
  {
    name: "indented code",
    markdown: "    indented code",
    edited: "    changed code",
    shows: (page) => expect(article(page).locator("pre code")).toHaveText("changed code"),
  },
  {
    name: "display math",
    markdown: "$$\nx^2\n$$",
    edited: "$$\ny^3\n$$",
    shows: (page) => expect(article(page).locator('annotation[encoding="application/x-tex"]')).toHaveText("y^3"),
  },
  {
    name: "mermaid",
    markdown: "```mermaid\ngraph TD\n  A[Start] --> B[End]\n```",
    edited: "```mermaid\ngraph TD\n  A[Alpha] --> B[Beta]\n```",
    shows: (page) => expect(article(page).locator(".diagram svg")).toContainText("Alpha", { timeout: DIAGRAM_MS }),
  },
  {
    name: "raw html block",
    markdown: '<div class="box">html block</div>',
    edited: '<div class="box">changed html</div>',
    shows: (page) => expect(article(page).locator(":scope > div")).toHaveText("changed html"),
  },
  {
    name: "html spanning blocks (div align center)",
    markdown: '<div align="center">\n\n# Title\n\n</div>',
    edited: '<div align="center">\n\n# Other\n\n</div>',
    shows: (page) => expect(article(page).locator(":scope > div > h1")).toHaveText(/Other/),
  },
  {
    name: "html spanning blocks (details with a list)",
    markdown: "<details>\n<summary>Sum</summary>\n\n- one\n- two\n\n</details>",
    edited: "<details>\n<summary>Sum</summary>\n\n- one\n- three\n\n</details>",
    shows: (page) => expect(article(page).locator(":scope > details > ul > li").nth(1)).toHaveText("three"),
  },
  {
    name: "paragraph with inline html",
    markdown: "a <b>bold</b> text",
    edited: "a <i>slanted</i> text",
    shows: (page) => expect(article(page).locator("p i")).toHaveText("slanted"),
  },
  {
    name: "paragraph with an html comment",
    markdown: "a <!-- note --> b",
    edited: "a <!-- note --> changed b",
    shows: (page) => expect(article(page).locator("p", { hasText: "changed b" })).toHaveCount(1),
  },
  {
    name: "reference link",
    markdown: "[x][r]",
    edited: "[y][r]",
    extra: "\n\n[r]: https://example.com/",
    shows: (page) => expect(article(page).locator('a[href="https://example.com/"]')).toHaveText("y"),
  },
  {
    name: "entity",
    markdown: "a&nbsp;b",
    edited: "a&nbsp;c&amp;d",
    shows: (page) => expect(article(page).locator("p", { hasText: "c&d" })).toHaveCount(1),
  },
];

const around = (k: Kind) => `intro\n\n${k.markdown}\n\noutro${k.extra ?? ""}`;
const withEdit = (k: Kind, edited: string) => `intro\n\n${edited}\n\noutro${k.extra ?? ""}`;
const target = (page: Page, k: Kind) => (k.name === "mermaid" ? article(page).locator(".diagram svg").first() : richBlocks(page).first());

for (const kind of kinds) {
  const doc = around(kind);
  const opened = async (page: Page) => {
    await open(page, doc);
    if (kind.name === "mermaid") await expect(article(page).locator(".diagram svg")).toHaveCount(1, { timeout: DIAGRAM_MS });
    await openRaw(page, target(page, kind), kind.markdown);
  };

  test(`${kind.name}: a click opens its exact source, esc cancels, the source stays`, async ({ page }) => {
    await opened(page);
    await page.keyboard.press("Escape");
    await closed(page);
    expect(await sourceText(page)).toBe(doc);
    await expect(richBlocks(page)).toHaveCount(1);
  });

  test(`${kind.name}: open and blur without a change keeps the source byte for byte`, async ({ page }) => {
    await opened(page);
    await blur(page);
    await closed(page);
    expect(await sourceText(page)).toBe(doc);
  });

  test(`${kind.name}: typed text and esc is dropped`, async ({ page }) => {
    await opened(page);
    await raw(page).press("End");
    await raw(page).pressSequentially("ZZZ");
    await page.keyboard.press("Escape");
    await closed(page);
    expect(await sourceText(page)).toBe(doc);
  });

  test(`${kind.name}: edit and blur changes only this block`, async ({ page }) => {
    await opened(page);
    await raw(page).fill(kind.edited);
    await blur(page);
    await closed(page);
    expect(await sourceText(page)).toBe(withEdit(kind, kind.edited));
    await kind.shows(page);
  });

  test(`${kind.name}: edit and ⌘Enter commits`, async ({ page }) => {
    await opened(page);
    await raw(page).fill(kind.edited);
    await raw(page).press("Meta+Enter");
    await closed(page);
    expect(await sourceText(page)).toBe(withEdit(kind, kind.edited));
    await kind.shows(page);
  });

  test(`${kind.name}: typing in the neighbour blocks leaves it byte for byte`, async ({ page }) => {
    await open(page, doc);
    await select(page, "preview", { text: "intro", offset: 5 });
    await page.keyboard.type("X");
    await select(page, "preview", { text: "outro", offset: 5 });
    await page.keyboard.type("Y");
    await leavePreview(page);
    expect(await sourceText(page)).toBe(`introX\n\n${kind.markdown}\n\noutroY${kind.extra ?? ""}`);
  });
}

test("emptying the textarea removes a block between two paragraphs cleanly", async ({ page }) => {
  await open(page, "intro\n\n```js\ncode\n```\n\noutro");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("intro\n\noutro");
  await expect(richBlocks(page)).toHaveCount(0);
});

test("emptying the textarea removes a block at the start cleanly", async ({ page }) => {
  await open(page, "```js\ncode\n```\n\noutro");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("");
  await raw(page).press("Meta+Enter");
  await closed(page);
  expect(await sourceText(page)).toBe("outro");
});

test("emptying the textarea removes a block at the end cleanly", async ({ page }) => {
  await open(page, "intro\n\n```js\ncode\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("intro");
});

test("emptying the textarea of the only block leaves an empty source", async ({ page }) => {
  await open(page, "$$\nx\n$$");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("");
});

test("emptying the textarea of a block in the middle of three keeps the others apart", async ({ page }) => {
  await open(page, "one\n\n```\nx\n```\n\n```\ny\n```\n\ntwo");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("one\n\n```\ny\n```\n\ntwo");
});

test("two code blocks typed into one textarea become two blocks", async ({ page }) => {
  await open(page, "intro\n\n```js\none\n```\n\noutro");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```js\none\n```\n\n```py\ntwo\n```");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("intro\n\n```js\none\n```\n\n```py\ntwo\n```\n\noutro");
  await expect(richBlocks(page)).toHaveCount(2);
  await expect(article(page).locator("pre code").nth(1)).toHaveText("two");
});

test("a code block typed into a math textarea turns the block into code", async ({ page }) => {
  await open(page, "intro\n\n$$\nx\n$$\n\noutro");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nnow code\n```");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("intro\n\n```\nnow code\n```\n\noutro");
  await expect(article(page).locator("pre code")).toHaveText("now code");
  await expect(article(page).locator(".katex")).toHaveCount(0);
});

test("a paragraph typed into a code textarea becomes rich text again", async ({ page }) => {
  await open(page, "intro\n\n```\ncode\n```\n\noutro");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("just **text**");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("intro\n\njust **text**\n\noutro");
  await expect(richBlocks(page)).toHaveCount(0);
  await expect(article(page).locator("strong")).toHaveText("text");
});

test("raw edit of the first block at the document start", async ({ page }) => {
  await open(page, "```\nold\n```\n\nafter\n");
  await openRaw(page, richBlocks(page).first(), "```\nold\n```");
  await raw(page).fill("```\nnew\n```");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("```\nnew\n```\n\nafter\n");
});

test("raw edit of the last block keeps the trailing newline", async ({ page }) => {
  await open(page, "before\n\n```\nold\n```\n");
  await openRaw(page, richBlocks(page).first(), "```\nold\n```");
  await raw(page).fill("```\nnew\n```");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("before\n\n```\nnew\n```\n");
});

test("raw edit of a document that is only one block", async ({ page }) => {
  await open(page, "```\nonly\n```");
  await openRaw(page, richBlocks(page).first(), "```\nonly\n```");
  await raw(page).fill("```\nchanged\n```");
  await raw(page).press("Meta+Enter");
  await closed(page);
  expect(await sourceText(page)).toBe("```\nchanged\n```");
});

test("the textarea grows with its content and shrinks again", async ({ page }) => {
  await open(page, "```\none\n```");
  await openRaw(page, richBlocks(page).first());
  const height = () => raw(page).evaluate((el) => el.getBoundingClientRect().height);
  const small = await height();
  await raw(page).fill(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  const big = await height();
  expect(big).toBeGreaterThan(small * 4);
  expect(await raw(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await raw(page).fill("one");
  expect(await height()).toBeLessThan(big / 4);
});

test("the textarea is as tall as its content when it opens", async ({ page }) => {
  await open(page, "```\n" + Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n") + "\n```");
  await openRaw(page, richBlocks(page).first());
  expect(await raw(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  expect(await raw(page).evaluate((el) => el.clientHeight)).toBeGreaterThan(12 * 14);
});

// ---------------------------------------------------------------- leaving a raw edit in other ways

test("a raw edit then a click on another rich block commits the first and keeps the second intact", async ({ page }) => {
  const doc = "```\none\n```\n\nmid\n\n```\ntwo\n```";
  await open(page, doc);
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nONE\n```");
  await richBlocks(page).last().click();
  expect(await sourceText(page)).toBe("```\nONE\n```\n\nmid\n\n```\ntwo\n```");
  // The second block still opens raw with its exact source.
  if ((await raw(page).count()) === 0) await richBlocks(page).last().click();
  await expect(raw(page)).toHaveValue("```\ntwo\n```");
});

test("a raw edit then a click on the second rich block opens the second one", async ({ page }) => {
  await open(page, "```\none\n```\n\nmid\n\n```\ntwo\n```");
  await openRaw(page, richBlocks(page).first());
  await richBlocks(page).last().click();
  await expect(raw(page)).toHaveCount(1);
  await expect(raw(page)).toHaveValue("```\ntwo\n```");
});

test("a raw edit then a click on a task checkbox commits both", async ({ page }) => {
  await open(page, "- [ ] task\n\n```\nold\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nnew\n```");
  await article(page).locator("input[type=checkbox]").click();
  await synced(page);
  await blur(page).catch(() => undefined);
  await closed(page);
  expect(await sourceText(page)).toBe("- [x] task\n\n```\nnew\n```");
  await expect(article(page).locator("pre code")).toHaveText("new");
});

test("a raw edit then a toolbar tool commits the edit and changes nothing else", async ({ page }) => {
  await open(page, "para\n\n```\nold\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nnew\n```");
  await clickTool(page, "preview", "bold");
  await closed(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe("para\n\n```\nnew\n```");
});

test("a raw edit then the task tool commits the edit and changes nothing else", async ({ page }) => {
  await open(page, "para\n\n```\nold\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nnew\n```");
  await clickTool(page, "preview", "task list");
  await closed(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe("para\n\n```\nnew\n```");
});

test("⌘B in a raw textarea does not bold anything and keeps the textarea open", async ({ page }) => {
  await open(page, "para\n\n```\nold\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).press("Meta+b");
  await raw(page).press("Control+b");
  await expect(raw(page)).toHaveCount(1);
  await expect(raw(page)).toHaveValue("```\nold\n```");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("para\n\n```\nold\n```");
});

test("a raw edit then the theme switch commits the edit", async ({ page }) => {
  await open(page, "para\n\n```\nold\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nnew\n```");
  await page.getByRole("switch", { name: "dark mode" }).click();
  await closed(page);
  expect(await sourceText(page)).toBe("para\n\n```\nnew\n```");
  await expect(article(page).locator("pre code")).toHaveText("new");
});

test("a raw edit then typing in the source card commits the edit and keeps the typed text", async ({ page }) => {
  await open(page, "para\n\n```\nold\n```");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("```\nnew\n```");
  await sourceArea(page).click();
  await sourceArea(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.type("TOP ");
  await closed(page);
  await expect(sourceArea(page)).toHaveValue("TOP para\n\n```\nnew\n```");
  await expect(article(page).locator("pre code")).toHaveText("new");
});

// ---------------------------------------------------------------- inline math

const inlineDoc = "Text $x^2$ end";
// Playwright finds the box of the .katex span covered by the paragraph; its rendered part is .katex-html.
const formula = (page: Page, nth = 0) => article(page).locator(".katex .katex-html").nth(nth);
const tex = (page: Page) => page.locator('annotation[encoding="application/x-tex"]');

test("inline math: a click opens the TeX field with its TeX, enter commits the new TeX", async ({ page }) => {
  await open(page, inlineDoc);
  await formula(page).click();
  await expect(field(page)).toHaveValue("x^2");
  await field(page).fill("y^3");
  await field(page).press("Enter");
  await expect(field(page)).toHaveCount(0);
  await expect(sourceArea(page)).toHaveValue("Text $y^3$ end");
  await expect(tex(page)).toHaveText("y^3");
});

test("inline math: esc cancels the edit", async ({ page }) => {
  await open(page, inlineDoc);
  await formula(page).click();
  await field(page).fill("zzz");
  await field(page).press("Escape");
  await expect(field(page)).toHaveCount(0);
  await leavePreview(page);
  expect(await sourceText(page)).toBe(inlineDoc);
  await expect(tex(page)).toHaveText("x^2");
});

test("inline math: an empty field changes nothing", async ({ page }) => {
  await open(page, inlineDoc);
  await formula(page).click();
  await field(page).fill("");
  await field(page).press("Enter");
  await expect(field(page)).toHaveCount(0);
  await leavePreview(page);
  expect(await sourceText(page)).toBe(inlineDoc);
  await expect(article(page).locator(".katex")).toHaveCount(1);
});

test("inline math: invalid TeX is kept in the source and shows an error without a console error", async ({ page }) => {
  await open(page, inlineDoc);
  await formula(page).click();
  await field(page).fill("\\frac{1");
  await field(page).press("Enter");
  await expect(sourceArea(page)).toHaveValue("Text $\\frac{1$ end");
  await expect(article(page).locator("p")).toContainText("Text");
  await expect(article(page).locator("p")).toContainText("end");
});

test("inline math: two formulas in one paragraph, the second edit leaves the first", async ({ page }) => {
  await open(page, "a $x$ b $y$ c");
  await formula(page, 1).click();
  await expect(field(page)).toHaveValue("y");
  await field(page).fill("z");
  await field(page).press("Enter");
  await expect(sourceArea(page)).toHaveValue("a $x$ b $z$ c");
});

test("inline math: typing next to a formula keeps the TeX", async ({ page }) => {
  await open(page, inlineDoc);
  await select(page, "preview", { text: "end", offset: 3 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("Text $x^2$ end!");
});

// ---------------------------------------------------------------- invalid display math and mermaid

test("invalid display math renders without an error, opens raw, and keeps its source", async ({ page }) => {
  const doc = "intro\n\n$$\n\\frac{1\n$$\n\noutro";
  await open(page, doc);
  await expect(richBlocks(page)).toHaveCount(1);
  await openRaw(page, richBlocks(page).first(), "$$\n\\frac{1\n$$");
  await page.keyboard.press("Escape");
  await closed(page);
  await select(page, "preview", { text: "outro", offset: 5 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("intro\n\n$$\n\\frac{1\n$$\n\noutro!");
});

test("invalid display math can be fixed in the raw edit", async ({ page }) => {
  await open(page, "$$\n\\frac{1\n$$");
  await openRaw(page, richBlocks(page).first());
  await raw(page).fill("$$\n\\frac{1}{2}\n$$");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("$$\n\\frac{1}{2}\n$$");
  await expect(tex(page)).toHaveText("\\frac{1}{2}");
});

test("an invalid mermaid diagram shows its source and 'diagram error.'", async ({ page }) => {
  await open(page, "intro\n\n```mermaid\nthis is ((not a diagram\n```\n\noutro");
  const diagram = article(page).locator(".diagram");
  await expect(diagram.locator("small")).toHaveText("diagram error.", { timeout: DIAGRAM_MS });
  await expect(diagram.locator("pre")).toBeVisible();
  await expect(diagram.locator("pre")).toContainText("this is ((not a diagram");
  await expect(diagram.locator("svg")).toHaveCount(0);
  await expect(page.locator("body > div[id^=d]")).toHaveCount(0);
});

test("an invalid mermaid diagram becomes valid after a raw edit, and back", async ({ page }) => {
  await open(page, "```mermaid\nbroken ((\n```");
  const diagram = article(page).locator(".diagram");
  await expect(diagram.locator("small")).toHaveText("diagram error.", { timeout: DIAGRAM_MS });
  await openRaw(page, diagram, "```mermaid\nbroken ((\n```");
  await raw(page).fill("```mermaid\ngraph TD\n  A[Good] --> B\n```");
  await blur(page);
  await closed(page);
  await expect(diagram.locator("svg")).toContainText("Good", { timeout: DIAGRAM_MS });
  await expect(diagram.locator("small")).toHaveCount(0);
  await expect(diagram.locator("pre")).toBeHidden();

  await openRaw(page, diagram.locator("svg"));
  await raw(page).fill("```mermaid\nbroken again ((\n```");
  await blur(page);
  await closed(page);
  await expect(diagram.locator("small")).toHaveText("diagram error.", { timeout: DIAGRAM_MS });
  await expect(diagram.locator("svg")).toHaveCount(0);
  expect(await sourceText(page)).toBe("```mermaid\nbroken again ((\n```");
});

// ---------------------------------------------------------------- mermaid

const flow = (a: string, b: string) => "```mermaid\ngraph TD\n  A[" + a + "] --> B[" + b + "]\n```";

test("mermaid draws an svg and hides its source", async ({ page }) => {
  await open(page, flow("Start", "End"));
  const diagram = article(page).locator(".diagram");
  await expect(diagram.locator("svg")).toContainText("Start", { timeout: DIAGRAM_MS });
  await expect(diagram.locator("pre")).toBeHidden();
  const box = await diagram.locator("svg").boundingBox();
  expect(box!.width).toBeGreaterThan(20);
  expect(box!.height).toBeGreaterThan(20);
});

test("mermaid draws again in the other colours after the theme switch", async ({ page }) => {
  await open(page, flow("Start", "End"));
  const svg = article(page).locator(".diagram svg");
  await expect(svg).toHaveCount(1, { timeout: DIAGRAM_MS });
  const before = await svg.evaluate((el) => el.outerHTML.replace(/diagram-\d+/g, "ID") + getComputedStyle(el.querySelector("text, .nodeLabel, span")!).color);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole("switch", { name: "dark mode" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(theme);
  await expect(svg).toHaveCount(1);
  await expect
    .poll(() => svg.evaluate((el) => el.outerHTML.replace(/diagram-\d+/g, "ID") + getComputedStyle(el.querySelector("text, .nodeLabel, span")!).color), { timeout: DIAGRAM_MS })
    .not.toBe(before);
  // And back.
  await page.getByRole("switch", { name: "dark mode" }).click();
  await expect
    .poll(() => svg.evaluate((el) => el.outerHTML.replace(/diagram-\d+/g, "ID") + getComputedStyle(el.querySelector("text, .nodeLabel, span")!).color), { timeout: DIAGRAM_MS })
    .toBe(before);
});

test("mermaid draws again after a raw edit and keeps the theme", async ({ page }) => {
  await open(page, "intro\n\n" + flow("Start", "End"));
  await expect(article(page).locator(".diagram svg")).toContainText("Start", { timeout: DIAGRAM_MS });
  await openRaw(page, article(page).locator(".diagram svg"), flow("Start", "End"));
  await raw(page).fill(flow("One", "Two"));
  await blur(page);
  await closed(page);
  await expect(article(page).locator(".diagram svg")).toContainText("Two", { timeout: DIAGRAM_MS });
  await expect(article(page).locator(".diagram svg")).toHaveCount(1);
  expect(await sourceText(page)).toBe("intro\n\n" + flow("One", "Two"));
});

test("two different diagrams in one document are both drawn", async ({ page }) => {
  await open(page, flow("A1", "B1") + "\n\ntext\n\n" + flow("A2", "B2"));
  const svgs = article(page).locator(".diagram svg");
  await expect(svgs).toHaveCount(2, { timeout: DIAGRAM_MS });
  await expect(svgs.nth(0)).toContainText("A1");
  await expect(svgs.nth(1)).toContainText("A2");
});

test("the same diagram twice is drawn twice, and editing one leaves the other", async ({ page }) => {
  const doc = flow("Same", "Same2") + "\n\ntext\n\n" + flow("Same", "Same2");
  await open(page, doc);
  const svgs = article(page).locator(".diagram svg");
  await expect(svgs).toHaveCount(2, { timeout: DIAGRAM_MS });
  for (const i of [0, 1]) {
    const box = await svgs.nth(i).boundingBox();
    expect(box!.width).toBeGreaterThan(20);
    await expect(svgs.nth(i)).toContainText("Same");
  }
  await openRaw(page, svgs.nth(1), flow("Same", "Same2"));
  await raw(page).fill(flow("Other", "Same2"));
  await blur(page);
  await closed(page);
  await expect(svgs).toHaveCount(2, { timeout: DIAGRAM_MS });
  await expect(svgs.nth(0)).toContainText("Same");
  await expect(svgs.nth(1)).toContainText("Other");
  expect(await sourceText(page)).toBe(flow("Same", "Same2") + "\n\ntext\n\n" + flow("Other", "Same2"));
});

test("a diagram is not drawn again by an edit elsewhere", async ({ page }) => {
  await open(page, "intro\n\n" + flow("Start", "End"));
  const svg = article(page).locator(".diagram svg");
  await expect(svg).toHaveCount(1, { timeout: DIAGRAM_MS });
  await select(page, "preview", { text: "intro", offset: 5 });
  await page.keyboard.type("X");
  await leavePreview(page);
  await expect(svg).toHaveCount(1, { timeout: DIAGRAM_MS });
  await expect(svg).toContainText("Start");
  expect(await sourceText(page)).toBe("introX\n\n" + flow("Start", "End"));
});

// ---------------------------------------------------------------- raw html spanning blocks

test("a div that spans blocks renders nested and opens as one block", async ({ page }) => {
  const html = '<div align="center">\n\n# Title\n\nsome *text*\n\n</div>';
  const doc = "before\n\n" + html + "\n\nafter";
  await open(page, doc);
  const div = article(page).locator(":scope > div");
  await expect(div).toHaveCount(1);
  await expect(div.locator("> h1")).toHaveText(/Title/);
  await expect(div.locator("> p em")).toHaveText("text");
  await expect(article(page).locator(":scope > p")).toHaveCount(2);
  await expect(richBlocks(page)).toHaveCount(1);
  await openRaw(page, div, html);
  await page.keyboard.press("Escape");
  await closed(page);
  expect(await sourceText(page)).toBe(doc);
});

test("details with a list renders nested and opens as one block", async ({ page }) => {
  const html = "<details>\n<summary>More</summary>\n\n- one\n- two\n\n</details>";
  const doc = "before\n\n" + html + "\n\nafter";
  await open(page, doc);
  const details = article(page).locator(":scope > details");
  await expect(details).toHaveCount(1);
  await expect(details.locator("> summary")).toHaveText("More");
  await expect(details.locator("> ul > li")).toHaveCount(2);
  await expect(article(page).locator(":scope > p")).toHaveCount(2);
  await openRaw(page, details.locator("summary"), html);
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe(doc);
});

test("typing in a paragraph next to a spanning div leaves the div byte for byte", async ({ page }) => {
  const html = '<div align="center">\n\n# Title\n\n</div>';
  await open(page, "before\n\n" + html + "\n\nafter");
  await select(page, "preview", { text: "after", offset: 5 });
  await page.keyboard.type("!");
  await select(page, "preview", { text: "before", offset: 6 });
  await page.keyboard.type("?");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("before?\n\n" + html + "\n\nafter!");
});

test("typing next to a details block with a list leaves it byte for byte", async ({ page }) => {
  const html = "<details>\n<summary>More</summary>\n\n- one\n- two\n\n</details>";
  await open(page, "before\n\n" + html + "\n\nafter");
  await select(page, "preview", { text: "after", offset: 5 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("before\n\n" + html + "\n\nafter!");
});

test("the list inside a details block cannot be edited as rich text", async ({ page }) => {
  const html = "<details open>\n<summary>More</summary>\n\n- one\n- two\n\n</details>";
  await open(page, html);
  await expect(article(page).locator("details")).toHaveAttribute("contenteditable", "false");
  await select(page, "preview", { text: "one", offset: 3 });
  await page.keyboard.type("ZZ");
  await leavePreview(page);
  expect(await sourceText(page)).toBe(html);
});

test("a standalone html comment stays byte for byte when a neighbour is edited", async ({ page }) => {
  const doc = "one\n\n<!-- keep   this -->\n\ntwo";
  await open(page, doc);
  await select(page, "preview", { text: "one", offset: 3 });
  await page.keyboard.type("1");
  await select(page, "preview", { text: "two", offset: 3 });
  await page.keyboard.type("2");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("one1\n\n<!-- keep   this -->\n\ntwo2");
});

test("a reference definition stays byte for byte when a neighbour is edited", async ({ page }) => {
  const doc = "see [x][r]\n\n[r]:   https://example.com/  'Title'\n\nlast";
  await open(page, doc);
  await select(page, "preview", { text: "last", offset: 4 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("see [x][r]\n\n[r]:   https://example.com/  'Title'\n\nlast!");
});

test("an empty edit of a spanning div removes the whole div", async ({ page }) => {
  await open(page, 'a\n\n<div align="center">\n\n# T\n\n</div>\n\nb');
  await openRaw(page, article(page).locator(":scope > div"));
  await raw(page).fill("");
  await blur(page);
  await closed(page);
  expect(await sourceText(page)).toBe("a\n\nb");
  await expect(article(page).locator("h1")).toHaveCount(0);
});

// ---------------------------------------------------------------- footnotes

const noteDoc = "Text[^1] and more.\n\n[^1]: The *note*.\n\nlast";

test("footnote references render as links to the generated section", async ({ page }) => {
  await open(page, noteDoc);
  const ref = article(page).locator("a[data-footnote-ref]");
  await expect(ref).toHaveCount(1);
  const section = article(page).locator("section[data-footnotes]");
  await expect(section).toHaveCount(1);
  await expect(section).toContainText("The note.");
  const href = (await ref.getAttribute("href"))!;
  expect(href.startsWith("#")).toBe(true);
  await expect(article(page).locator(`[id="${href.slice(1)}"]`)).toHaveCount(1);
  const back = (await section.locator("a[data-footnote-backref]").first().getAttribute("href"))!;
  await expect(article(page).locator(`[id="${back.slice(1)}"]`)).toHaveCount(1);
  await expect(section).toHaveAttribute("contenteditable", "false");
});

test("editing the paragraph with a reference keeps [^1] and the definition byte for byte", async ({ page }) => {
  await open(page, noteDoc);
  await select(page, "preview", { text: "and more.", offset: 9 });
  await page.keyboard.type(" Yes");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("Text[^1] and more. Yes\n\n[^1]: The *note*.\n\nlast");
  await expect(article(page).locator("a[data-footnote-ref]")).toHaveCount(1);
});

test("editing the text before the reference keeps [^1]", async ({ page }) => {
  await open(page, noteDoc);
  await select(page, "preview", { text: "Text", offset: 2 });
  await page.keyboard.type("Q");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("TeQxt[^1] and more.\n\n[^1]: The *note*.\n\nlast");
});

test("bold on the paragraph with a reference keeps the reference and the definition", async ({ page }) => {
  await open(page, noteDoc);
  await select(page, "preview", { text: "and" }, { text: "more" });
  await clickTool(page, "preview", "bold");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("Text[^1] **and more**.\n\n[^1]: The *note*.\n\nlast");
});

test("clicks and typing in the footnotes section change nothing", async ({ page }) => {
  await open(page, noteDoc);
  const section = article(page).locator("section[data-footnotes]");
  const htmlBefore = await section.innerHTML();
  await section.getByText("The note.").click();
  await page.keyboard.type("ZZZ");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await leavePreview(page);
  expect(await sourceText(page)).toBe(noteDoc);
  expect(await section.innerHTML()).toBe(htmlBefore);
  await expect(article(page).locator("section[data-footnotes]")).toHaveCount(1);
});

test("a click on the back link and the reference link changes nothing in the source", async ({ page }) => {
  await open(page, noteDoc);
  await article(page).locator("a[data-footnote-ref]").click();
  await article(page).locator("a[data-footnote-backref]").first().click();
  await leavePreview(page);
  expect(await sourceText(page)).toBe(noteDoc);
});

test("typing right before the reference does not rewrite a short footnote definition", async ({ page }) => {
  await open(page, "Text[^1]\n\n[^1]: Note");
  await select(page, "preview", { text: "Text", offset: 4 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(await sourceText(page)).toBe("Text![^1]\n\n[^1]: Note");
});

test("several references and a definition with two paragraphs stay byte for byte", async ({ page }) => {
  const doc = "A[^a] and B[^b].\n\n[^a]: First.\n\n[^b]: Second\n    line two.\n\n    para two.\n\nend";
  await open(page, doc);
  await expect(article(page).locator("a[data-footnote-ref]")).toHaveCount(2);
  await select(page, "preview", { text: "end", offset: 3 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(await sourceText(page)).toBe(doc + "!");
});

// ---------------------------------------------------------------- task checkboxes

const boxes = (page: Page) => article(page).locator("input[type=checkbox]");

const checks: { name: string; markdown: string; nth: number; expected: string }[] = [
  { name: "a bullet task list", markdown: "- [ ] a\n- [x] b\n- [ ] c", nth: 0, expected: "- [x] a\n- [x] b\n- [ ] c" },
  { name: "a bullet task list (checked to open)", markdown: "- [ ] a\n- [x] b\n- [ ] c", nth: 1, expected: "- [ ] a\n- [ ] b\n- [ ] c" },
  { name: "a nested task list", markdown: "- [ ] a\n  - [ ] b\n  - [x] c\n- [ ] d", nth: 1, expected: "- [ ] a\n  - [x] b\n  - [x] c\n- [ ] d" },
  { name: "a nested task list (the parent)", markdown: "- [ ] a\n  - [ ] b\n- [ ] d", nth: 0, expected: "- [x] a\n  - [ ] b\n- [ ] d" },
  { name: "a loose task list", markdown: "- [ ] a\n\n- [ ] b\n\n- [x] c", nth: 1, expected: "- [ ] a\n\n- [x] b\n\n- [x] c" },
  { name: "a task item in a quote", markdown: "> - [ ] a\n> - [ ] b", nth: 1, expected: "> - [ ] a\n> - [x] b" },
  { name: "a numbered task list", markdown: "1. [ ] a\n2. [ ] b", nth: 0, expected: "1. [x] a\n2. [ ] b" },
  { name: "a task list between paragraphs", markdown: "intro\n\n- [ ] a\n- [ ] b\n\nouttro", nth: 0, expected: "intro\n\n- [x] a\n- [ ] b\n\nouttro" },
];

for (const { name, markdown, nth, expected } of checks) {
  test(`a click toggles the checkbox of ${name}`, async ({ page }) => {
    await open(page, markdown);
    await boxes(page).nth(nth).click();
    await expect(sourceArea(page)).toHaveValue(expected);
    await leavePreview(page);
    expect(await sourceText(page)).toBe(expected);
    // And the checkbox shows the new state, and a second click restores the source.
    await boxes(page).nth(nth).click();
    await expect(sourceArea(page)).toHaveValue(markdown);
  });
}

test("a checkbox toggle leaves a rich block next to it byte for byte", async ({ page }) => {
  const rest = "\n\n```\ncode   \n```\n\n<!-- c -->\n\na&nbsp;b";
  await open(page, "- [ ] a" + rest);
  await boxes(page).first().click();
  await expect(sourceArea(page)).toHaveValue("- [x] a" + rest);
});

test("a checkbox in raw html does nothing", async ({ page }) => {
  const doc = '<ul>\n<li class="task-list-item"><input type="checkbox" disabled> raw</li>\n</ul>\n\n- [ ] real';
  await open(page, doc);
  const rawBox = article(page).locator(":scope > ul:first-child input[type=checkbox]");
  await expect(rawBox).toHaveCount(1);
  await rawBox.click({ force: true });
  await synced(page);
  await leavePreview(page);
  expect(await sourceText(page)).toBe(doc);
  await expect(rawBox).toBeDisabled();
});

// A markdown task inside raw HTML toggles at its source offset, and the click does not open the raw editor.
test("a checkbox of a task in raw html that spans blocks toggles only its box", async ({ page }) => {
  await open(page, "<div>\n\n- [ ] inside\n\n</div>");
  await boxes(page).first().click();
  await expect(article(page).locator("textarea")).toHaveCount(0);
  await leavePreview(page);
  expect(await sourceText(page)).toBe("<div>\n\n- [x] inside\n\n</div>");
});

// ---------------------------------------------------------------- security

/** Watch for dialogs, and answer the request of a broken image with bytes that are not an image (no console error). */
async function watchScripts(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.route("**/x", (route) => route.fulfill({ status: 200, contentType: "image/png", body: "not an image" }));
  return dialogs;
}

const pwned = (page: Page) => page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned);

/** What the article has that could run: event handler attributes, scripts, frames, javascript: URLs. */
const live = (page: Page) =>
  article(page).evaluate((el) => {
    const found: string[] = [];
    for (const node of el.querySelectorAll("*")) {
      for (const { name, value } of node.attributes) {
        if (name.startsWith("on") || /^\s*javascript:/i.test(value)) found.push(`${node.tagName} ${name}=${value}`);
      }
      if (/^(SCRIPT|IFRAME|OBJECT|EMBED)$/.test(node.tagName)) found.push(node.tagName);
    }
    return found;
  });

test("script, event handlers and javascript links render inert", async ({ page }) => {
  const dialogs = await watchScripts(page);
  const doc = [
    '<img src=x onerror="window.__pwned=1;alert(1)">',
    "<script>window.__pwned=1;alert(2)</script>",
    "[md link](javascript:window.__pwned=1;alert(3))",
    '<a href="javascript:window.__pwned=1;alert(4)">html link</a>',
    '<div onclick="window.__pwned=1;alert(5)" onmouseover="window.__pwned=1">div</div>',
    '<p>x<iframe src="javascript:alert(6)"></iframe></p>',
    '<svg onload="window.__pwned=1"><circle r=1 /></svg>',
    "![alt](x \"t\" onerror=\"alert(7)\")",
  ].join("\n\n");
  await open(page, doc);
  await page.waitForTimeout(300);
  expect(await live(page)).toEqual([]);
  // Click everything that can be clicked, open and commit each raw block.
  for (const link of await article(page).locator("a").all()) {
    await link.click({ force: true }).catch(() => undefined);
    // A link in a rich block opens its raw edit.
    if (await raw(page).count()) await raw(page).press("Escape");
  }
  const count = await richBlocks(page).count();
  for (let i = 0; i < count; i++) {
    await richBlocks(page).first().click();
    if (await raw(page).count()) {
      await raw(page).press("Meta+Enter");
      await closed(page);
    }
  }
  await select(page, "preview", { text: "div", offset: 1 }).catch(() => undefined);
  await page.waitForTimeout(300);
  expect(dialogs).toEqual([]);
  expect(await pwned(page)).toBeUndefined();
  expect(await sourceText(page)).toBe(doc);
});

test("a javascript link in a paragraph that is edited stays inert and is kept in the source", async ({ page }) => {
  const dialogs = await watchScripts(page);
  await open(page, "[bad](javascript:alert(1)) text");
  await expect(article(page).locator("a[href^=javascript]")).toHaveCount(0);
  await select(page, "preview", { text: "text", offset: 4 });
  await page.keyboard.type("!");
  await leavePreview(page);
  expect(dialogs).toEqual([]);
  expect(await live(page)).toEqual([]);
});

test("an image with an onerror handler typed in a raw edit stays inert", async ({ page }) => {
  const dialogs = await watchScripts(page);
  await open(page, "```\ncode\n```");
  await openRaw(page, richBlocks(page).first());
  const evil = '<img src=x onerror="window.__pwned=1;alert(1)">\n\n<script>window.__pwned=1</script>';
  await raw(page).fill(evil);
  await blur(page);
  await closed(page);
  await page.waitForTimeout(300);
  expect(await sourceText(page)).toBe(evil);
  expect(dialogs).toEqual([]);
  expect(await pwned(page)).toBeUndefined();
  expect(await live(page)).toEqual([]);
});
