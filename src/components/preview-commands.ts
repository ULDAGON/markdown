import type { ToolId } from "@/lib/source-edits";

// Rich-text commands on the selection in the preview. The caller puts the selection there first.

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

const exec = (command: string, arg?: string) => document.execCommand(command, false, arg);

const TYPING = { bold: "bold", italic: "italic", strike: "strikeThrough" } as const;

/**
 * A mark at a caret outside that mark: the text typed next takes it, as in any rich-text editor. The preview shows no
 * markdown, so the markers that the markdown card inserts would show as text here. Inline code has no such command:
 * an empty code element holds the caret on a zero-width space, which toMarkdown drops.
 */
export function markAtCaret(id: "bold" | "italic" | "strike" | "code") {
  if (id !== "code") return exec(TYPING[id]);
  const code = Object.assign(document.createElement("code"), { textContent: "\u200b" });
  getSelection()!.getRangeAt(0).insertNode(code);
  getSelection()!.collapse(code.firstChild!, 1);
}

/** The closest element at the selection that matches the selector. */
export function closest(selector: string): Element | null {
  const node = getSelection()?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(selector) ?? null;
}

// A task item of a loose list holds its checkbox in its first paragraph.
const boxOf = (item: Element | null) => item?.querySelector(":scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]");

/** Whether the caret is at the start or the end of the text of the element. The whitespace between elements is no text. */
function atEdge(element: Element, start: boolean): boolean {
  const { anchorNode, anchorOffset } = getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(element);
  if (start) range.setEnd(anchorNode!, anchorOffset);
  else range.setStart(anchorNode!, anchorOffset);
  const walker = document.createTreeWalker(range.cloneContents(), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.trim()) return false;
  return true;
}

/**
 * Link the selection to the URL, or insert the URL as a link at a caret. On an existing link it changes only the URL,
 * so the title stays.
 */
export function link(url: string) {
  const existing = closest("a");
  if (existing) existing.setAttribute("href", url);
  else if (getSelection()!.toString()) exec("createLink", url);
  else exec("insertHTML", `<a href="${escape(url)}">${escape(url)}</a>`);
}

/**
 * Enter at a collapsed caret, where the paragraph break of the browser is not the Enter of the markdown card.
 * True when it took the key. Everywhere else the browser splits the block, ends an empty list item, or moves an
 * empty nested item out one level.
 */
export function enter(): boolean {
  const heading = closest("h1, h2, h3, h4, h5, h6");
  const item = closest("li");
  const box = boxOf(item);
  const quoted = closest("blockquote > p");
  // The browser pushes an empty heading above; the empty block above is a paragraph.
  if (heading?.textContent!.trim() && atEdge(heading, true)) {
    heading.before(Object.assign(document.createElement("p"), { innerHTML: "<br>" }));
    return true;
  }
  // An empty task item ends as an empty item does, once its box is gone.
  if (box && !item!.textContent!.trim()) {
    box.remove();
    return false;
  }
  // The browser makes the next item of a task item without a box. On an empty new item it keeps the typing style
  // of the end of the item, as an empty <strong>; the box would go into it and stop being the box of the item.
  if (box) {
    exec("insertParagraph");
    const line = closest("p, li")!;
    const next = Object.assign(document.createElement("input"), { type: "checkbox" });
    if (line.textContent) {
      line.prepend(next);
    } else {
      line.replaceChildren(next, document.createElement("br"));
      getSelection()!.collapse(line, 1);
    }
    return true;
  }
  // An empty line ends a quote, as an empty item ends a list; what follows it in the quote stays a quote.
  if (quoted && !quoted.textContent!.trim()) {
    const quote = quoted.parentElement!;
    const rest = document.createElement("blockquote");
    while (quoted.nextSibling) rest.append(quoted.nextSibling);
    quote.after(quoted, ...(rest.childElementCount ? [rest] : []));
    if (!quote.childElementCount) quote.remove(); // the empty line was its first line
    getSelection()!.collapse(quoted, 0);
    return true;
  }
  return false;
}

/**
 * Backspace at the start or Delete at the end of a block, next to a block that cannot be edited or a table: the browser
 * would delete that block, or merge the text into a table cell. True when the key must do nothing.
 */
export function besideLocked(block: Element, back: boolean): boolean {
  const locked = (el: Element | null) => !!el?.matches('[contenteditable="false"], table');
  return (locked(block) || locked(back ? block.previousElementSibling : block.nextElementSibling)) && atEdge(block, back);
}

/** The pressed tools and the heading level at the selection. The innermost list item gives the list tool. */
export function toolState(): { heading: number; pressed: Partial<Record<ToolId, boolean>> } {
  const heading = closest("h1, h2, h3, h4, h5, h6");
  const item = closest("li");
  const task = !!boxOf(item);
  const list = item?.parentElement?.tagName;
  return {
    heading: heading ? Number(heading.tagName[1]) : 0,
    pressed: {
      // The marks of the text itself; queryCommandState would take the weight of a heading as bold.
      bold: !!closest("b, strong"),
      italic: !!closest("i, em"),
      strike: !!closest("s, strike, del"),
      code: !!closest(":not(pre) > code"),
      quote: !!closest("blockquote"),
      ul: !task && list === "UL",
      ol: list === "OL",
      task,
    },
  };
}
