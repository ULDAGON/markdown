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

// Apply fn to every line the selection touches.
function lines(value: string, s: number, e: number, fn: (lines: string[]) => string[]): Edit {
  const start = lineStart(value, s);
  // A selection that ends right after a line break does not touch the next line.
  const last = e > s && value[e - 1] === "\n" ? e - 1 : e;
  const newline = value.indexOf("\n", last);
  const end = newline === -1 ? value.length : newline;
  const text = fn(value.slice(start, end).split("\n")).join("\n");
  return edit(start, end, text, s === e ? text.length : 0);
}

function prefix(kind: keyof typeof PREFIX, value: string, s: number, e: number): Edit {
  const { test, make, keep } = PREFIX[kind];
  return lines(value, s, e, (ls) => {
    const all = ls.every((l) => test.test(l));
    return ls.map((l, i) => (all ? l.replace(test, "") : make(i) + (keep ? l : l.replace(LIST, "$1"))));
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

/** Enter inside a list starts the next item; Enter on an empty item ends the list. Null: not in a list. */
export function continueList(value: string, caret: number): Edit | null {
  const start = lineStart(value, caret);
  const line = value.slice(start, caret);
  const m = line.match(/^(\s*)(> |[-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/);
  if (!m) return null;
  // Only a line that is nothing but the marker ends the list; Enter after the marker of an item with text splits it.
  const newline = value.indexOf("\n", caret);
  if ((newline === -1 ? value.length : newline) - start === m[0].length) return edit(start, caret, "", 0, 0);
  const next = m[3] ? `${m[1]}${Number(m[3]) + 1}${m[4]} ` : m[1] + m[2].replace(/\[[xX]\]/, "[ ]");
  return edit(caret, caret, "\n" + next);
}

/** The level of the heading on the caret line, 0 for text. */
export function headingLevel(value: string, caret: number): number {
  return value.slice(lineStart(value, caret)).match(/^(#{1,6})\s/)?.[1].length ?? 0;
}
