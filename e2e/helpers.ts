import { test as base, expect, type Page } from "@playwright/test";

export { expect };

/** The two cards, by their aria-label. */
export type Card = "markdown" | "preview";

/**
 * A point in the text of a card: `offset` characters into the `nth` occurrence of `text` (both count from 0).
 * In the preview, the text is the text of the article without the whitespace between its elements.
 */
export type At = { text: string; offset?: number; nth?: number };

/** The preview syncs 120 ms after the last edit (Preview.tsx); the margin is for the render after it. */
const SYNC_MS = 200;

/** A test that fails on a console error or an uncaught error in the page. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export const sourceArea = (page: Page) => page.locator("textarea.source");
export const article = (page: Page) => page.locator("article.prose");
const card = (page: Page, name: Card) => page.getByRole("region", { name, exact: true });

/** Open the app with markdown as the saved text. */
export async function open(page: Page, markdown: string) {
  await page.goto("/");
  await page.evaluate((text) => localStorage.setItem("md.text", text), markdown);
  await page.reload();
  await expect(sourceArea(page)).toHaveValue(markdown);
}

export const sourceText = (page: Page) => sourceArea(page).inputValue();

/** The text of each top-level block of the preview. */
export const previewBlocks = (page: Page) => article(page).locator(":scope > *").allInnerTexts();

function indexOf(text: string, { text: search, offset = 0, nth = 0 }: At): number {
  let index = -1;
  for (let i = 0; i <= nth; i++) {
    index = text.indexOf(search, index + 1);
    if (index === -1) throw new Error(`"${search}" (occurrence ${nth}) is not in ${JSON.stringify(text)}`);
  }
  return index + offset;
}

const previewText = (page: Page) =>
  article(page).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.trim()) text += node.textContent;
    return text;
  });

/**
 * Put the caret at `from`, or select `from` to `to`, in a card. `to.offset` is the length of `to.text` when it is
 * left out, so `to` takes its whole text. In the preview, a point after a character of its text stays in the
 * node of that character: the end of a bold word is inside the bold element.
 */
export async function select(page: Page, name: Card, from: At, to?: At) {
  const end = to && { offset: to.text.length, ...to };
  if (name === "markdown") {
    const value = await sourceText(page);
    const start = indexOf(value, from);
    const range = [start, end ? indexOf(value, end) : start];
    await sourceArea(page).evaluate((el: HTMLTextAreaElement, [s, e]) => {
      el.focus();
      el.setSelectionRange(s, e);
    }, range);
    return;
  }
  const text = await previewText(page);
  const points = [{ index: indexOf(text, from), after: (from.offset ?? 0) > 0 }];
  if (end) points.push({ index: indexOf(text, end), after: end.offset > 0 });
  await article(page).evaluate((el, points) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.trim()) nodes.push(node as Text);
    const locate = ({ index, after }: { index: number; after: boolean }): [Node, number] => {
      let i = after ? index - 1 : index;
      for (const node of nodes) {
        if (i < node.length) return [node, after ? i + 1 : i];
        i -= node.length;
      }
      const last = nodes.at(-1);
      return last ? [last, last.length] : [el, 0];
    };
    el.focus();
    const range = document.createRange();
    range.setStart(...locate(points[0]));
    if (points[1]) range.setEnd(...locate(points[1]));
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, points);
}

/** Click a tool of a card by its aria-label, as "task list" or "bold". */
export async function clickTool(page: Page, name: Card, label: string) {
  await card(page, name).getByRole("button", { name: label, exact: true }).click();
}

/** Pick a heading level in a card; 0 is text. */
export async function pickHeading(page: Page, name: Card, level: number) {
  await card(page, name).getByLabel("heading").selectOption(String(level));
}

/** Wait until an edit typed in the preview is in the source. */
export async function synced(page: Page) {
  await page.waitForTimeout(SYNC_MS);
}

/** Move the focus out of the preview and wait for the render of the source that follows. */
export async function leavePreview(page: Page) {
  await article(page).evaluate((el) => el.blur());
  // Preview renders in a timeout after the blur; this timeout runs after it.
  await page.evaluate(() => new Promise((done) => setTimeout(() => requestAnimationFrame(done))));
}
