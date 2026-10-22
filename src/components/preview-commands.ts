import type { ToolId } from "@/lib/source-edits";

// The toolbar tools as rich edits on the selection in the preview. The caller puts the selection there first.

const TABLE = "<table><thead><tr><th>column</th><th>column</th></tr></thead><tbody><tr><td>cell</td><td>cell</td></tr></tbody></table><p><br></p>";
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

const exec = (command: string, arg?: string) => document.execCommand(command, false, arg);
const selected = () => getSelection()?.toString() ?? "";

function closest(selector: string): Element | null {
  const node = getSelection()?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(selector) ?? null;
}

function toggleCode() {
  const code = closest(":not(pre) > code");
  if (!code) return exec("insertHTML", `<code>${escape(selected() || "code")}</code>`);
  const range = document.createRange();
  range.selectNode(code);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  exec("insertText", code.textContent ?? "");
}

const TASK_ITEM = "li:has(> input[type=checkbox])";

// Remove the checkbox, with the space after it, of each task item that the selection touches.
function removeTasks() {
  const selection = getSelection()!;
  const range = selection.getRangeAt(0);
  const root = closest('[contenteditable="true"]') ?? document;
  const boxes = [...root.querySelectorAll(TASK_ITEM)]
    .filter((item) => range.intersectsNode(item))
    .map((item) => item.querySelector(":scope > input[type=checkbox]")!);
  for (const box of boxes) {
    const gap = document.createRange();
    gap.setStartBefore(box);
    const next = box.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" ")) gap.setEnd(next, 1);
    else gap.setEndAfter(box);
    selection.removeAllRanges();
    selection.addRange(gap);
    exec("delete"); // as an editing command, so it fires the input event that schedules the sync
  }
}

/** Run a tool. The heading tool takes the level (0 for text), the link tool the URL. */
export function previewEdit(id: ToolId, arg?: number | string) {
  switch (id) {
    case "bold": return exec("bold");
    case "italic": return exec("italic");
    case "strike": return exec("strikeThrough");
    case "code": return toggleCode();
    case "heading": return exec("formatBlock", arg ? `h${arg}` : "p");
    case "quote": return closest("blockquote") ? exec("outdent") : exec("formatBlock", "blockquote");
    case "ul": return exec("insertUnorderedList");
    case "ol": return exec("insertOrderedList");
    case "task": return closest(TASK_ITEM) ? removeTasks() : exec("insertHTML", `<ul><li><input type="checkbox"> ${escape(selected() || "task")}</li></ul>`);
    case "link": {
      const url = String(arg);
      return selected() ? exec("createLink", url) : exec("insertHTML", `<a href="${escape(url)}">${escape(url)}</a>`);
    }
    case "codeblock": return exec("formatBlock", "pre");
    case "table": return exec("insertHTML", TABLE);
    case "hr": return exec("insertHorizontalRule");
  }
}

/** The pressed tools and the heading level at the selection. */
export function toolState(): { heading: number; pressed: Partial<Record<ToolId, boolean>> } {
  const heading = closest("h1, h2, h3, h4, h5, h6");
  const task = !!closest(TASK_ITEM);
  return {
    heading: heading ? Number(heading.tagName[1]) : 0,
    pressed: {
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      strike: document.queryCommandState("strikeThrough"),
      code: !!closest(":not(pre) > code"),
      quote: !!closest("blockquote"),
      ul: !task && !!closest("ul"),
      ol: !!closest("ol"),
      task,
    },
  };
}
