// Edits on the markdown source as pure text operations. The caller applies an Edit to the textarea.

import { inlines, tableRanges, type Span } from "./inline-spans.ts";

export type ToolId =
  | "bold" | "italic" | "strike" | "code"
  | "heading"
  | "quote" | "ul" | "ol" | "task"
  | "link" | "codeblock" | "table" | "hr";

/** Replace start..end with text, then select select[0]..select[1] inside the new text. */
export type Edit = { start: number; end: number; text: string; select: [number, number] };

type Mark = "bold" | "italic" | "strike" | "code";
/** The markdown node of a mark, and the marker it writes. */
const MARK: Record<Mark, { type: string; marker: string }> = {
  bold: { type: "strong", marker: "**" },
  italic: { type: "emphasis", marker: "*" },
  strike: { type: "delete", marker: "~~" },
  code: { type: "inlineCode", marker: "`" },
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

/** The syntax at the start of a line: quote markers, indent, then the list marker and the task box of an item. */
function syntax(line: string) {
  const [head, quote, indent, marker = "", box = ""] = line.match(/^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:((?:[-*+]|\d+[.)])[ \t])(\[[ xX]\](?:[ \t]|$))?)?/)!;
  return { quote, indent, marker, box, rest: line.slice(head.length) };
}
const syntaxAt = (value: string, index: number) => syntax(value.slice(lineStart(value, index), lineEnd(value, index)));

/** A replacement of start..end; the selection leaves out the markers it adds at both ends of text. */
type Part = { start: number; end: number; text: string; added: number };

function mark(id: Mark, value: string, s: number, e: number): Edit {
  const { type, marker } = MARK[id];
  const blocks = inlines(value);
  const own = (spans: Span[]) => spans.filter((span) => span.type === type);

  // The width of the markers at each end of a span. `~` and `~~` both strike; a code span opens with any run of
  // backticks, and a space on both sides of its text is part of its syntax.
  function width({ type, start, end }: Span) {
    if (type === "strong") return 2;
    if (type === "emphasis") return 1;
    let w = 0;
    while (value[start + w] === value[start]) w++;
    return type === "inlineCode" && /^ [^]*[^ ][^]* $/.test(value.slice(start + w, end - w)) ? w + 1 : w;
  }
  // The source of a..b without the markers of spans.
  function strip(a: number, b: number, spans: Span[]) {
    const cuts = spans.flatMap((span) => [[span.start, span.start + width(span)], [span.end - width(span), span.end]]);
    let [text, at] = ["", a];
    for (const [from, to] of cuts.sort((x, y) => x[0] - y[0])) [text, at] = [text + value.slice(at, from), to];
    return text + value.slice(at, b);
  }

  // The part of each paragraph, heading or table cell that the selection covers, without the spaces and quote markers
  // at its ends. A caret is in the block it touches; outside all blocks it is after the line syntax. A selection
  // without such text, as of spaces or in a code block, has nothing to mark.
  function outside(i: number) {
    const { quote, indent } = syntaxAt(value, i);
    return /\s/.test(value[i]) || i - lineStart(value, i) < quote.length + indent.length;
  }
  const ranges = blocks.flatMap(({ start, end, spans }) => {
    if (s === e) return start <= s && s <= end ? [{ spans, a: s, b: s }] : [];
    let [a, b] = [Math.max(s, start), Math.min(e, end)];
    while (a < b && outside(a)) a++;
    while (b > a && outside(b - 1)) b--;
    return a < b ? [{ spans, a, b }] : [];
  });
  if (!ranges.length) {
    if (s < e) return edit(s, e, value.slice(s, e), 0, e - s);
    const { rest } = syntaxAt(value, s);
    const at = Math.max(s, lineEnd(value, s) - rest.length);
    ranges.push({ spans: [], a: at, b: at });
  }

  // A span of the mark that holds a selection, or holds a caret inside it, decides that the mark is on.
  const holds = (span: Span, a: number, b: number) => (a === b ? span.start < a && b < span.end : span.start <= a && b <= span.end);
  const holders = ranges.map(({ spans, a, b }) => own(spans).findLast((span) => holds(span, a, b)));
  const on = holders.some((holder) => !holder);
  // Italic writes the emphasis of its block, else of the document. An underscore inside a word, or next to another
  // underscore, is no emphasis.
  function underscore(spans: Span[], a: number, b: number) {
    const emphasis = (spans: Span[]) => spans.filter((span) => span.type === "emphasis");
    const style = emphasis(spans).length ? emphasis(spans) : blocks.flatMap((block) => emphasis(block.spans));
    return style.some((span) => value[span.start] === "_") && !/[\p{L}\p{N}_]/u.test(value.slice(a - 1, a) + value.slice(b, b + 1));
  }

  function wrap(spans: Span[], a: number, b: number): Part {
    // A mark cannot start or end in the syntax of another span, nor inside code or math: the part grows to whole spans.
    const cuts = ({ start, end, content }: Span) => {
      if (a <= start && end <= b) return false;
      if (!content) return start < b && a < end;
      const inside = (p: number) => start < p && p < end;
      const syntax = (p: number) => inside(p) && (p < content[0] || p > content[1]);
      return inside(a) !== inside(b) || syntax(a) || syntax(b);
    };
    for (let span = spans.find(cuts); span; span = spans.find(cuts)) [a, b] = [Math.min(a, span.start), Math.max(b, span.end)];
    // At a caret only the markers go in, with the caret between them: no placeholder word to type over.
    const text = strip(a, b, own(spans).filter((span) => a <= span.start && span.end <= b));
    let [open, close] = [marker, marker];
    if (id === "code") {
      // A code span needs a longer run of backticks than it holds, and a space next to a backtick at an end.
      const fence = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
      const pad = /^`|`$/.test(text) ? " " : "";
      [open, close] = [fence + pad, pad + fence];
    } else if (id === "italic" && underscore(spans, a, b)) {
      [open, close] = ["_", "_"];
    }
    return { start: a, end: b, text: open + text + close, added: open.length };
  }

  const parts = ranges.map(({ spans, a, b }, i): Part => {
    const holder = holders[i];
    if (!on) return { start: holder!.start, end: holder!.end, text: strip(holder!.start, holder!.end, [holder!]), added: 0 };
    return holder ? { start: a, end: b, text: value.slice(a, b), added: 0 } : wrap(spans, a, b);
  });
  let text = "";
  for (const [i, part] of parts.entries()) text += value.slice(i ? parts[i - 1].end : part.start, part.start) + part.text;
  const last = parts.at(-1)!;
  return edit(parts[0].start, last.end, text, parts[0].added, text.length - last.added);
}

// Apply fn to every line the selection touches, and select them. around holds the line before and the line after them.
// The rows of a table stay as they are: a quote or a list marker in front of a row would break the table.
function lines(value: string, s: number, e: number, fn: (lines: string[], around: string[]) => string[]): Edit {
  const start = lineStart(value, s);
  // A selection that ends right after a line break does not touch the next line.
  const end = lineEnd(value, e > s && value[e - 1] === "\n" ? e - 1 : e);
  const around = [start ? value.slice(lineStart(value, start - 1), start - 1) : "", value.slice(end + 1, lineEnd(value, end + 1))];
  const rows = value.slice(start, end).split("\n");
  const tables = tableRanges(value);
  let at = start;
  const inTable = rows.map((row) => {
    const inside = tables.some(([a, b]) => a <= at && at < b);
    at += row.length + 1;
    return inside;
  });
  const text = fn(rows, around).map((row, n) => (inTable[n] ? rows[n] : row)).join("\n");
  return edit(start, end, text, s === e ? text.length : 0, text.length);
}

// An empty list item or heading renders its marker as text, so they leave out the blank lines between selected lines.
const blank = (line: string, lines: string[]) => !line.trim() && lines.some((other) => other.trim());

// The heading goes after the quote and list syntax of its line: `- ## a` is a heading in a list item.
function heading(level: number, value: string, s: number, e: number): Edit {
  return lines(value, s, e, (ls) =>
    ls.map((l) => {
      const { quote, indent, marker, box, rest } = syntax(l);
      // GFM reads `- [ ] ## a` as the text `## a`: a task item holds no heading.
      if (blank(l, ls) || box) return l;
      return quote + indent + marker + box + (level ? "#".repeat(level) + " " : "") + rest.replace(/^#{1,6} /, "");
    }),
  );
}

function quote(value: string, s: number, e: number): Edit {
  return lines(value, s, e, (ls) => (ls.every((l) => /^> ?/.test(l)) ? ls.map((l) => l.replace(/^> ?/, "")) : ls.map((l) => "> " + l)));
}

type List = "ul" | "ol" | "task";
const numbered = (marker: string) => /^\d/.test(marker);
const IS: Record<List, (i: ReturnType<typeof syntax>) => boolean> = {
  ul: (i) => !!i.marker && !numbered(i.marker) && !i.box,
  ol: (i) => numbered(i.marker) && !i.box,
  task: (i) => !!i.box,
};
// The column of an indent: a tab goes to the next multiple of 4.
const columns = (indent: string) => [...indent].reduce((column, c) => (c === "\t" ? column + 4 - (column % 4) : column + 1), 0);

function list(kind: List, value: string, s: number, e: number): Edit {
  let plain = false; // an item became a line of text
  const result = lines(value, s, e, (ls, around) => {
    const items = ls.map(syntax);
    const texts = items.map((i) => i.marker + i.rest);
    if (items.every((i, n) => blank(texts[n], texts) || IS[kind](i))) {
      // Off takes off what on puts on: the marker, or the box of a task. A task outside a list was a line of text,
      // so its bullet goes too; a task inside a list, or with a number, was an item.
      const inList = around.some((l) => syntax(l).marker);
      plain = kind !== "task" || !(inList || items.some((i) => numbered(i.marker)));
      return items.map(({ quote, indent, marker, rest }, n) => {
        if (blank(texts[n], texts)) return ls[n];
        return quote + indent + (kind === "task" && (inList || numbered(marker)) ? marker : "") + rest;
      });
    }
    // A child item starts at the text of its parent, so it moves with the width of the new parent marker.
    const parents: { text: number; moved: number }[] = [];
    const count: number[] = [numberAbove(value, s)]; // the number of the item on each level
    return items.map(({ quote, indent, marker, box, rest }, n) => {
      if (blank(texts[n], texts)) return ls[n];
      const column = columns(indent);
      while (parents.length && column < parents.at(-1)!.text) parents.pop();
      const parent = parents.at(-1);
      const at = parent ? parent.moved + column - parent.text : column;
      count.length = parents.length + 1;
      count[parents.length] = (count[parents.length] ?? 0) + 1;
      // A bullet keeps its character, and a task keeps the marker of the item it is made from.
      const next = kind === "ol" ? `${count[parents.length]}. ` : marker && (kind === "task" || !numbered(marker)) ? marker : "- ";
      if (marker) parents.push({ text: column + marker.length, moved: at + next.length });
      return quote + (at === column ? indent : " ".repeat(at)) + next + (kind === "task" ? box || "[ ] " : "") + rest;
    });
  });
  if (result.text === value.slice(result.start, result.end)) return result; // nothing changed, as on a table row
  return plain ? separate(value, result) : join(value, result);
}

const isItem = (line: string | null) => line !== null && !!syntax(line).marker;

// The number of the numbered item above the line of s at the same indent, also across one blank line; else 0.
function numberAbove(value: string, s: number): number {
  const start = lineStart(value, s);
  let above = lineBefore(value, start);
  if (isBlank(above) && start) above = lineBefore(value, lineStart(value, start - 1));
  if (above === null) return 0;
  const item = syntax(above);
  const same = columns(item.indent) === columns(syntax(value.slice(start, lineEnd(value, start))).indent);
  return same ? Number(item.marker.match(/^\d+/)?.[0] ?? 0) : 0;
}
// A blank line, also `>` in a quote.
const isBlank = (line: string | null) => line !== null && !syntax(line).marker && !syntax(line).rest.trim();
const lineBefore = (value: string, start: number) => (start ? value.slice(lineStart(value, start - 1), start - 1) : null);
const lineAfter = (value: string, end: number) => (end < value.length ? value.slice(end + 1, lineEnd(value, end + 1)) : null);

// A line of text right after a list item continues that item, so an item that becomes text gets a blank line
// between it and the list items around it; an item that joins a list again takes those blank lines away.
function separate(value: string, { start, end, text, select }: Edit): Edit {
  const gap = syntax(value.slice(start, lineEnd(value, start))).quote.trimEnd();
  const before = isItem(lineBefore(value, start)) ? gap + "\n" : "";
  const after = isItem(lineAfter(value, end)) ? "\n" + gap : "";
  return { start, end, text: before + text + after, select: [select[0] + before.length, select[1] + before.length] };
}

function join(value: string, edit: Edit): Edit {
  let { start, end } = edit;
  if (isBlank(lineBefore(value, start)) && isItem(lineBefore(value, lineStart(value, start - 1)))) start = lineStart(value, start - 1);
  if (isBlank(lineAfter(value, end)) && isItem(lineAfter(value, lineEnd(value, end + 1)))) end = lineEnd(value, end + 1);
  return { ...edit, start, end };
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
  if (/^https?:\/\/\S+$/.test(sel)) return edit(s, e, `[](${sel})`, 1, 1);
  // A caret goes between the brackets for the text; a selection is the text, and the URL is selected to type over.
  if (!sel) return edit(s, e, "[](https://)", 1, 1);
  return edit(s, e, `[${sel}](https://)`, sel.length + 3, sel.length + 11);
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
    case "codeblock": return block(value, s, e, (sel) => ({ text: "```\n" + sel + "\n```", from: 4, to: 4 + sel.length }));
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
  // A list tool can add or take away a blank line in front of the lines (separate, join): the rows move with it.
  const leading = (rows: string[]) => Math.max(0, rows.findIndex((row) => !isBlank(row)));
  const shift = leading(after) - leading(before);
  const follow = (offset: number) => {
    const head = value.slice(edit.start, offset).split("\n");
    const row = head.length - 1;
    const [from, to] = [before[row], after[row + shift]];
    let kept = 0; // the end of the line that the edit keeps
    while (kept < Math.min(from.length, to.length) && from.at(-1 - kept) === to.at(-1 - kept)) kept++;
    return edit.start + after.slice(0, row + shift + 1).join("\n").length - Math.min(from.length - head[row].length, kept);
  };
  return [follow(s), follow(e)];
}

/** Enter inside a list or a quote starts the next item; Enter on an empty item ends it. Null: in neither. */
export function continueList(value: string, caret: number): Edit | null {
  const start = lineStart(value, caret);
  const { quote, indent, marker, box, rest } = syntax(value.slice(start, caret));
  if (!quote && !marker) return null;
  // Only a line that is nothing but the syntax ends the list; Enter after the marker of an item with text splits it.
  if (lineEnd(value, caret) === caret && !rest) return edit(start, caret, "", 0, 0);
  const next = quote + indent + marker.replace(/\d+/, (number) => String(Number(number) + 1)) + box.replace(/[xX]/, " ");
  return edit(caret, caret, "\n" + next);
}

/** The level of the heading on the caret line, 0 for text. */
export function headingLevel(value: string, caret: number): number {
  return syntaxAt(value, caret).rest.match(/^(#{1,6})\s/)?.[1].length ?? 0;
}
