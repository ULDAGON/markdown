// Edits on the markdown source as pure text operations. The caller applies an Edit to the textarea.

export type ToolId =
  | "bold" | "italic" | "strike" | "code"
  | "heading"
  | "quote" | "ul" | "ol" | "task"
  | "link" | "codeblock" | "table" | "hr";

/** Replace start..end with text, then select select[0]..select[1] inside the new text. */
export type Edit = { start: number; end: number; text: string; select: [number, number] };

const LIST = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;
type Prefix = { test: RegExp; make: (i: number) => string; keep?: boolean };
const PREFIX: Record<"quote" | "ul" | "ol" | "task", Prefix> = {
  quote: { test: /^> ?/, make: () => "> ", keep: true },
  ul: { test: /^\s*[-*+] (?!\[[ xX]\] )/, make: () => "- " },
  ol: { test: /^\s*\d+[.)] /, make: (i: number) => `${i + 1}. ` },
  task: { test: /^\s*[-*+] \[[ xX]\] /, make: () => "- [ ] " },
};
const TABLE = "| column | column |\n| --- | --- |\n| cell | cell |";

const edit = (start: number, end: number, text: string, from = text.length, to = from): Edit => ({
  start,
  end,
  text,
  select: [from, to],
});

// lastIndexOf with a negative start still looks at index 0, so the first line needs its own case.
const lineStart = (value: string, index: number) => (index === 0 ? 0 : value.lastIndexOf("\n", index - 1) + 1);

function lineEnd(value: string, index: number) {
  const newline = value.indexOf("\n", index);
  return newline === -1 ? value.length : newline;
}

function wrap(marker: string, placeholder: string, value: string, s: number, e: number): Edit {
  const m = marker.length;
  const sel = value.slice(s, e);
  if (value.slice(s - m, s) === marker && value.slice(e, e + m) === marker) return edit(s - m, e + m, sel, 0, sel.length);
  if (sel.length > 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(m, -m);
    return edit(s, e, inner, 0, inner.length);
  }
  const inner = sel || placeholder;
  return edit(s, e, marker + inner + marker, m, m + inner.length);
}

// Apply fn to every line the selection touches. around holds the line before and the line after them.
function lines(value: string, s: number, e: number, fn: (lines: string[], around: string[]) => string[]): Edit {
  const start = lineStart(value, s);
  // A selection that ends right after a line break does not touch the next line.
  const end = lineEnd(value, e > s && value[e - 1] === "\n" ? e - 1 : e);
  const around = [start ? value.slice(lineStart(value, start - 1), start - 1) : "", value.slice(end + 1, lineEnd(value, end + 1))];
  const text = fn(value.slice(start, end).split("\n"), around).join("\n");
  return edit(start, end, text, s === e ? text.length : 0);
}

function prefix(kind: keyof typeof PREFIX, value: string, s: number, e: number): Edit {
  const { test, make, keep } = PREFIX[kind];
  return lines(value, s, e, (ls, around) => {
    // An empty list item renders its marker as text, so a list leaves out the blank lines between selected lines.
    const skip = (l: string) => !keep && !l.trim() && ls.some((other) => other.trim());
    const all = ls.every((l) => skip(l) || test.test(l));
    // A task inside a list stays in it as a bullet: as a plain line it would join the item before it.
    const off = kind === "task" && around.some((l) => LIST.test(l)) ? /\[[ xX]\] / : test;
    let item = 0;
    return ls.map((l) => {
      if (skip(l)) return l;
      if (all) return l.replace(off, "");
      const marker = make(item++);
      // A list marker replaces the marker that the line has, after its indent.
      return keep ? marker + l : l.replace(LIST, "$1").replace(/^\s*/, `$&${marker}`);
    });
  });
}

// A block on lines of its own, with a blank line around it where markdown needs one.
function block(value: string, s: number, e: number, make: (selected: string) => { text: string; from: number; to: number }): Edit {
  const { text, from, to } = make(value.slice(s, e));
  const before = s === 0 || value.slice(s - 2, s) === "\n\n" ? "" : value[s - 1] === "\n" ? "\n" : "\n\n";
  const after = e === value.length ? "\n" : value.slice(e, e + 2) === "\n\n" ? "" : value[e] === "\n" ? "\n" : "\n\n";
  return edit(s, e, before + text + after, before.length + from, before.length + to);
}

function link(value: string, s: number, e: number): Edit {
  const sel = value.slice(s, e);
  if (/^https?:\/\/\S+$/.test(sel)) return edit(s, e, `[text](${sel})`, 1, 5);
  const text = sel || "text";
  return edit(s, e, `[${text}](https://)`, text.length + 3, text.length + 11);
}

/** The edit for a tool. `arg` is the heading level (0 clears the heading). */
export function sourceEdit(id: ToolId, value: string, s: number, e: number, arg = 0): Edit {
  switch (id) {
    case "bold": return wrap("**", "bold", value, s, e);
    case "italic": return wrap("_", "italic", value, s, e);
    case "strike": return wrap("~~", "strike", value, s, e);
    case "code": return wrap("`", "code", value, s, e);
    case "heading": return lines(value, s, e, (ls) => ls.map((l) => (arg ? "#".repeat(arg) + " " : "") + l.replace(/^#{1,6}\s+/, "")));
    case "quote":
    case "ul":
    case "ol":
    case "task": return prefix(id, value, s, e);
    case "link": return link(value, s, e);
    case "codeblock": return block(value, s, e, (sel) => ({ text: "```\n" + (sel || "code") + "\n```", from: 4, to: 4 + (sel || "code").length }));
    case "table": return block(value, s, e, () => ({ text: TABLE, from: 2, to: 8 }));
    case "hr": return block(value, s, e, () => ({ text: "---", from: 3, to: 3 }));
  }
}

const LINE_TOOLS = new Set<ToolId>(["heading", "quote", "ul", "ol", "task"]);

/**
 * The selection s..e of value after the edit of a tool, on the same text. A line tool keeps each end at its
 * distance to the end of its line; any other tool selects what it selects in the markdown card.
 */
export function selectionAfter(id: ToolId, value: string, edit: Edit, s: number, e: number): [number, number] {
  if (!LINE_TOOLS.has(id)) return [edit.start + edit.select[0], edit.start + edit.select[1]];
  const before = value.slice(edit.start, edit.end).split("\n");
  const after = edit.text.split("\n");
  const follow = (offset: number) => {
    const head = value.slice(edit.start, offset).split("\n");
    const row = head.length - 1;
    const [from, to] = [before[row], after[row]];
    let kept = 0; // the end of the line that the edit keeps
    while (kept < Math.min(from.length, to.length) && from.at(-1 - kept) === to.at(-1 - kept)) kept++;
    return edit.start + after.slice(0, row + 1).join("\n").length - Math.min(from.length - head[row].length, kept);
  };
  return [follow(s), follow(e)];
}

/** Enter inside a list starts the next item; Enter on an empty item ends the list. Null: not in a list. */
export function continueList(value: string, caret: number): Edit | null {
  const start = lineStart(value, caret);
  const line = value.slice(start, caret);
  const m = line.match(/^(\s*)(> |[-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/);
  if (!m) return null;
  // Only a line that is nothing but the marker ends the list; Enter after the marker of an item with text splits it.
  if (lineEnd(value, caret) - start === m[0].length) return edit(start, caret, "", 0, 0);
  const next = m[3] ? `${m[1]}${Number(m[3]) + 1}${m[4]} ` : m[1] + m[2].replace(/\[[xX]\]/, "[ ]");
  return edit(caret, caret, "\n" + next);
}

/** The level of the heading on the caret line, 0 for text. */
export function headingLevel(value: string, caret: number): number {
  return value.slice(lineStart(value, caret)).match(/^(#{1,6})\s/)?.[1].length ?? 0;
}
