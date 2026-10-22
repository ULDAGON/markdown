// Edits on the markdown source as pure text operations. The caller applies an Edit to the textarea.

export type ToolId =
  | "bold" | "italic" | "strike" | "code"
  | "heading"
  | "quote" | "ul" | "ol" | "task"
  | "link" | "codeblock" | "table" | "hr";

/** Replace start..end with text, then select select[0]..select[1] inside the new text. */
export type Edit = { start: number; end: number; text: string; select: [number, number] };

type Mark = "bold" | "italic" | "strike" | "code";
/** A mark writes its marker; it reads a run of one of its characters whose length holds. */
const MARK: Record<Mark, { marker: string; chars: string; holds: (run: number) => boolean }> = {
  bold: { marker: "**", chars: "*", holds: (run) => run >= 2 },
  // `***x***` is bold and italic, so an odd run is italic and the `**` of bold is not. An intraword `_` is no emphasis.
  italic: { marker: "*", chars: "*_", holds: (run) => run % 2 === 1 },
  strike: { marker: "~~", chars: "~", holds: (run) => run >= 2 },
  code: { marker: "`", chars: "`", holds: (run) => run >= 1 },
};
// The syntax at the start of a line that a mark stays out of: indent, quote, heading, list marker, task box.
const SYNTAX = /^(?:\s*(?:> ?|#{1,6} |(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?))*\s*/;
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

/** A replacement of start..end; the selection leaves out the markers it adds at both ends of text. */
type Part = { start: number; end: number; text: string; added: number };

function mark(id: Mark, value: string, s: number, e: number): Edit {
  const { marker, chars, holds } = MARK[id];
  const m = marker.length;

  // The part that removes the markers of the span that a..b is in, or null. The markers at the ends of a..b count too.
  function unmark(a: number, b: number): Part | null {
    const start = lineStart(value, a);
    const line = value.slice(start, lineEnd(value, a));
    const from = line.match(SYNTAX)![0].length;
    for (const c of chars) {
      let [x, y] = [a - start, b - start];
      while (x < y && line[x] === c) x++;
      while (y > x && line[y - 1] === c) y--;
      const runs = [...line.slice(from).matchAll(new RegExp(`\\${c}+`, "g"))]
        .filter((run) => holds(run[0].length))
        .map((run) => [from + run.index, from + run.index + run[0].length]);
      const before = runs.filter(([, end]) => end <= x);
      const after = runs.filter(([begin]) => begin >= y);
      // An odd count of markers before it and none inside it: a..b is inside one span.
      if (before.length % 2 && after.length && before.length + after.length === runs.length) {
        const [open, close] = [start + before.at(-1)![1] - m, start + after[0][0] + m];
        const text = value.slice(open + m, close - m);
        return { start: open, end: close, text, added: 0 };
      }
    }
    return null;
  }

  // Each line of the selection is marked on its own, after its line syntax and without the spaces at its ends.
  const ranges: [number, number][] = [];
  for (let at = lineStart(value, s); at <= e; at = lineEnd(value, at) + 1) {
    const line = value.slice(at, lineEnd(value, at));
    const [a, b] = [Math.max(s, at + line.match(SYNTAX)![0].length), Math.min(e, at + line.length)];
    const text = value.slice(a, b);
    if (text.trim()) ranges.push([a + text.length - text.trimStart().length, b - text.length + text.trimEnd().length]);
  }
  if (!ranges.length) ranges.push([s, s]);

  const spans = ranges.map(([a, b]) => unmark(a, b));
  const on = spans.some((span) => !span);
  const parts = ranges.map(([a, b], i): Part => {
    const text = value.slice(a, b) || id;
    if (!on) return spans[i]!;
    if (spans[i]) return { start: a, end: b, text, added: 0 };
    return { start: a, end: b, text: marker + text + marker, added: m };
  });
  let text = "";
  for (const [i, part] of parts.entries()) text += value.slice(i ? parts[i - 1].end : part.start, part.start) + part.text;
  const last = parts.at(-1)!;
  return edit(parts[0].start, last.end, text, parts[0].added, text.length - last.added);
}

// Apply fn to every line the selection touches, and select them. around holds the line before and the line after them.
function lines(value: string, s: number, e: number, fn: (lines: string[], around: string[]) => string[]): Edit {
  const start = lineStart(value, s);
  // A selection that ends right after a line break does not touch the next line.
  const end = lineEnd(value, e > s && value[e - 1] === "\n" ? e - 1 : e);
  const around = [start ? value.slice(lineStart(value, start - 1), start - 1) : "", value.slice(end + 1, lineEnd(value, end + 1))];
  const text = fn(value.slice(start, end).split("\n"), around).join("\n");
  return edit(start, end, text, s === e ? text.length : 0, text.length);
}

// An empty list item or heading renders its marker as text, so they leave out the blank lines between selected lines.
const blank = (line: string, lines: string[]) => !line.trim() && lines.some((other) => other.trim());

function heading(level: number, value: string, s: number, e: number): Edit {
  return lines(value, s, e, (ls) => ls.map((l) => (blank(l, ls) ? l : (level ? "#".repeat(level) + " " : "") + l.replace(/^#{1,6} /, ""))));
}

function quote(value: string, s: number, e: number): Edit {
  return lines(value, s, e, (ls) => (ls.every((l) => /^> ?/.test(l)) ? ls.map((l) => l.replace(/^> ?/, "")) : ls.map((l) => "> " + l)));
}

type List = "ul" | "ol" | "task";
/** A line as a list item: marker and box are empty when the line has none. */
function item(line: string) {
  const [head, indent, marker = "", box = ""] = line.match(/^(\s*)(?:([-*+] |\d+[.)] )(\[[ xX]\] )?)?/)!;
  return { indent, marker, box, rest: line.slice(head.length) };
}
const numbered = (marker: string) => /^\d/.test(marker);
const IS: Record<List, (i: ReturnType<typeof item>) => boolean> = {
  ul: (i) => !!i.marker && !numbered(i.marker) && !i.box,
  ol: (i) => numbered(i.marker) && !i.box,
  task: (i) => !!i.box,
};

function list(kind: List, value: string, s: number, e: number): Edit {
  return lines(value, s, e, (ls, around) => {
    const items = ls.map(item);
    if (items.every((i, n) => blank(ls[n], ls) || IS[kind](i))) {
      // A numbered item or a task inside a list stays an item: as a plain line it would join the item before it.
      const inList = around.some((l) => item(l).marker);
      return items.map(({ indent, marker, rest }, n) => {
        if (blank(ls[n], ls)) return ls[n];
        if (kind === "task" && (inList || numbered(marker))) return indent + marker + rest;
        return indent + (kind === "ol" && inList ? "- " : "") + rest;
      });
    }
    // A child item starts at the text of its parent, so it moves with the width of the new parent marker.
    const parents: { text: number; moved: number }[] = [];
    const count: number[] = []; // the number of the item on each level
    return items.map(({ indent, marker, rest }, n) => {
      if (blank(ls[n], ls)) return ls[n];
      while (parents.length && indent.length < parents.at(-1)!.text) parents.pop();
      const parent = parents.at(-1);
      const at = parent ? parent.moved + indent.length - parent.text : indent.length;
      count.length = parents.length + 1;
      count[parents.length] = (count[parents.length] ?? 0) + 1;
      // A task on a numbered item keeps its number.
      const next = kind === "ol" ? `${count[parents.length]}. ` : kind === "task" && numbered(marker) ? marker : "- ";
      if (marker) parents.push({ text: indent.length + marker.length, moved: at + next.length });
      return " ".repeat(at) + next + (kind === "task" ? "[ ] " : "") + rest;
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
    case "bold":
    case "italic":
    case "strike":
    case "code": return mark(id, value, s, e);
    case "heading": return heading(arg, value, s, e);
    case "quote": return quote(value, s, e);
    case "ul":
    case "ol":
    case "task": return list(id, value, s, e);
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
