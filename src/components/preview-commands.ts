import type { ToolId } from "@/lib/source-edits";

// Rich-text commands on the selection in the preview. The caller puts the selection there first.

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

const exec = (command: string, arg?: string) => document.execCommand(command, false, arg);
const selected = () => getSelection()?.toString() ?? "";

function closest(selector: string): Element | null {
  const node = getSelection()?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(selector) ?? null;
}

// A task item of a loose list holds its checkbox in its first paragraph.
const TASK_ITEM = "li:has(> input[type=checkbox], > p:first-child > input[type=checkbox])";

const COMMANDS = ["bold", "italic", "strike", "link"] as const;
export type CommandTool = (typeof COMMANDS)[number];

/** These tools run as rich-text commands; the other tools edit the source (Preview). */
export const isCommand = (id: ToolId): id is CommandTool => (COMMANDS as readonly ToolId[]).includes(id);

/** Run a rich-text command. The link tool takes the URL. */
export function previewEdit(id: CommandTool, url = "") {
  switch (id) {
    case "bold": return exec("bold");
    case "italic": return exec("italic");
    case "strike": return exec("strikeThrough");
    case "link": return selected() ? exec("createLink", url) : exec("insertHTML", `<a href="${escape(url)}">${escape(url)}</a>`);
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
