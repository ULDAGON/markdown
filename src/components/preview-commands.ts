import type { ToolId } from "@/lib/source-edits";

// Rich-text commands on the selection in the preview. The caller puts the selection there first.

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

const exec = (command: string, arg?: string) => document.execCommand(command, false, arg);
const selected = () => getSelection()?.toString() ?? "";

/** The closest element at the selection that matches the selector. */
export function closest(selector: string): Element | null {
  const node = getSelection()?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(selector) ?? null;
}

// A task item of a loose list holds its checkbox in its first paragraph.
const boxOf = (item: Element | null) => item?.querySelector(":scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]");

/** The text of the element before or after the caret. */
function textBeside(element: Element, before: boolean): string {
  const { anchorNode, anchorOffset } = getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(element);
  if (before) range.setEnd(anchorNode!, anchorOffset);
  else range.setStart(anchorNode!, anchorOffset);
  return range.toString();
}

const COMMANDS = ["bold", "italic", "strike", "link"] as const;
export type CommandTool = (typeof COMMANDS)[number];

/** These tools run as rich-text commands; the other tools edit the source (Preview). */
export const isCommand = (id: ToolId): id is CommandTool => (COMMANDS as readonly ToolId[]).includes(id);

/** Run a rich-text command. The link tool takes the URL; on an existing link it changes the URL of the whole link. */
export function previewEdit(id: CommandTool, url = "") {
  switch (id) {
    case "bold": return exec("bold");
    case "italic": return exec("italic");
    case "strike": return exec("strikeThrough");
    case "link": {
      const link = closest("a");
      if (link) getSelection()!.selectAllChildren(link);
      return selected() ? exec("createLink", url) : exec("insertHTML", `<a href="${escape(url)}">${escape(url)}</a>`);
    }
  }
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
  if (heading?.textContent!.trim() && !textBeside(heading, true)) {
    heading.before(Object.assign(document.createElement("p"), { innerHTML: "<br>" }));
    return true;
  }
  // An empty task item ends as an empty item does, once its box is gone.
  if (box && !item!.textContent!.trim()) {
    box.remove();
    return false;
  }
  // The browser makes the next item of a task item without a box.
  if (box) {
    exec("insertParagraph");
    exec("insertHTML", '<input type="checkbox">');
    return true;
  }
  // An empty line ends a quote, as an empty item ends a list; what follows it in the quote stays a quote.
  if (quoted && !quoted.textContent!.trim()) {
    const rest = document.createElement("blockquote");
    while (quoted.nextSibling) rest.append(quoted.nextSibling);
    quoted.parentElement!.after(quoted, ...(rest.childElementCount ? [rest] : []));
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
  return (locked(block) || locked(back ? block.previousElementSibling : block.nextElementSibling)) && !textBeside(block, back);
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
