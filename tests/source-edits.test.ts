import assert from "node:assert/strict";
import { test } from "node:test";
import { continueList, headingLevel, selectionAfter, sourceEdit, type Edit } from "../src/lib/source-edits.ts";

// Apply an edit the way the textarea does, and report the text and the selected part.
function apply(value: string, edit: Edit) {
  const text = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return { text, selected: text.slice(edit.start + edit.select[0], edit.start + edit.select[1]) };
}
const run = (id: Parameters<typeof sourceEdit>[0], value: string, s: number, e = s, arg?: number) =>
  apply(value, sourceEdit(id, value, s, e, arg));
// Run a tool, then run it again on the text and the selection that it leaves.
function twice(id: Parameters<typeof sourceEdit>[0], value: string, s: number, e = s) {
  const first = sourceEdit(id, value, s, e);
  const { text } = apply(value, first);
  return run(id, text, first.start + first.select[0], first.start + first.select[1]).text;
}

test("wrap marks the selection", () => {
  assert.deepEqual(run("bold", "a word b", 2, 6), { text: "a **word** b", selected: "word" });
  assert.deepEqual(run("italic", "x", 0, 1), { text: "*x*", selected: "x" });
  assert.equal(run("strike", "x", 0, 1).text, "~~x~~");
  assert.equal(run("code", "x", 0, 1).text, "`x`");
});

test("wrap inserts only the markers at a caret, with the caret between them", () => {
  assert.deepEqual(run("bold", "", 0), { text: "****", selected: "" });
  assert.deepEqual(sourceEdit("bold", "a ", 2, 2).select, [2, 2]);
  assert.deepEqual(sourceEdit("code", "", 0, 0), { start: 0, end: 0, text: "``", select: [1, 1] });
});

test("wrap unwraps markers around the selection", () => {
  assert.deepEqual(run("bold", "a **word** b", 4, 8), { text: "a word b", selected: "word" });
});

test("wrap unwraps markers inside the selection", () => {
  assert.deepEqual(run("bold", "a **word** b", 2, 10), { text: "a word b", selected: "word" });
});

test("wrap keeps the spaces at the ends of the selection outside the markers", () => {
  assert.deepEqual(run("bold", "a word b", 2, 7), { text: "a **word** b", selected: "word" });
  assert.equal(run("code", "a  word  b", 1, 9).text, "a  `word`  b");
});

test("italic reads an underscore and a star, and tells a star from bold", () => {
  assert.equal(run("italic", "a _word_ b", 3, 7).text, "a word b");
  assert.equal(run("italic", "a *word* b", 3, 7).text, "a word b");
  assert.deepEqual(run("italic", "a **word** b", 4, 8), { text: "a ***word*** b", selected: "word" });
  assert.deepEqual(run("italic", "a **word** b", 2, 10), { text: "a ***word*** b", selected: "**word**" });
  assert.equal(run("italic", "a ***word*** b", 5, 9).text, "a **word** b");
  assert.equal(run("bold", "a ***word*** b", 5, 9).text, "a *word* b");
  assert.equal(run("italic", "a **word** b", 6).text, "a **wo**rd** b");
});

test("bold then italic, and both off again, restore the text", () => {
  const value = "a word b";
  const bold = apply(value, sourceEdit("bold", value, 2, 6)).text;
  assert.equal(twice("italic", bold, 4, 8), bold);
  assert.equal(twice("bold", value, 2, 6), value);
});

test("a caret inside a span of the mark removes the span", () => {
  assert.deepEqual(run("code", "alpha `beta` gamma", 9), { text: "alpha beta gamma", selected: "beta" });
  assert.equal(run("code", "alpha `beta` gamma", 8, 10).text, "alpha beta gamma");
  assert.equal(run("bold", "a **word** b", 6).text, "a word b");
  assert.equal(run("italic", "a *word* b", 5).text, "a word b");
  assert.equal(run("italic", "a _word_ b", 5).text, "a word b");
  assert.equal(run("strike", "a ~~word~~ b", 6).text, "a word b");
});

test("a caret between two spans of the mark is outside both", () => {
  assert.equal(run("bold", "**a** b **c**", 7).text, "**a** b**** **c**");
  assert.equal(run("italic", "* *a* b", 7).text, "* *a* b**");
});

test("a mark across blocks marks the text of each block inside its line syntax", () => {
  assert.equal(run("bold", "one\n\ntwo", 0, 8).text, "**one**\n\n**two**");
  assert.equal(run("bold", "- one\n- two\n- three", 0, 19).text, "- **one**\n- **two**\n- **three**");
  assert.equal(run("code", "## head\n\nbody text", 5, 11).text, "## he`ad`\n\n`bo`dy text");
  assert.equal(run("italic", "> - [ ] a\n> 1. b", 0, 16).text, "> - [ ] *a*\n> 1. *b*");
  assert.equal(twice("strike", "- one\n- two", 2, 11), "- one\n- two");
});

test("a mark on the lines of one paragraph is one span", () => {
  assert.equal(run("bold", "a\nb", 0, 3).text, "**a\nb**");
  assert.equal(run("bold", "**one**\ntwo", 0, 11).text, "**one\ntwo**");
  assert.equal(run("bold", "> a\n> b", 0, 7).text, "> **a\n> b**");
  assert.equal(run("bold", "> a\n> b", 4, 7).text, "> a\n> **b**");
  assert.equal(run("bold", "a\r\nb", 0, 4).text, "**a\r\nb**");
});

test("a mark reads the spans of the markdown and removes no text", () => {
  assert.equal(run("italic", "snake_case_name", 6, 10).text, "snake_*case*_name");
  assert.equal(run("italic", "a \\*b\\* c", 4, 5).text, "a \\**b*\\* c");
  assert.equal(run("italic", "2 * 3 * 4", 4, 5).text, "2 * *3* * 4");
  assert.equal(run("bold", "a ** b ** c", 5, 6).text, "a ** **b** ** c");
  assert.equal(run("italic", "[*](u) b [*](v)", 7, 8).text, "[*](u) *b* [*](v)");
  assert.equal(run("italic", "`*` b `*`", 4, 5).text, "`*` *b* `*`");
  assert.equal(run("italic", "x $a*b$ y", 8, 9).text, "x $a*b$ *y*");
});

test("a mark off removes only the markers of the span that holds the selection", () => {
  assert.equal(run("italic", "x `a*b` *c* y", 9, 10).text, "x `a*b` c y");
  assert.equal(run("strike", "a ~b~ c", 3, 4).text, "a b c");
  assert.equal(run("bold", "a __b__ c", 4, 5).text, "a b c");
  assert.deepEqual(run("code", "x `` a`b `` y", 6, 7), { text: "x a`b y", selected: "a`b" });
  assert.equal(run("bold", "- [ ] **a**", 8, 9).text, "- [ ] a");
  assert.equal(run("bold", "## **h** ##", 5, 6).text, "## h ##");
});

test("a mark over marked and unmarked text takes the inner markers off and marks it all", () => {
  assert.deepEqual(run("bold", "a **b** c", 0, 9), { text: "**a b c**", selected: "a b c" });
  assert.equal(run("bold", "**a** b", 2, 7).text, "**a b**");
  assert.equal(run("bold", "**a** b", 0, 7).text, "**a b**");
  assert.equal(run("italic", "a *b* c *d* e", 0, 13).text, "*a b c d e*");
});

test("a mark does not start or end inside another span: it takes the whole span", () => {
  assert.equal(run("bold", "a [link b](u) c", 0, 7).text, "**a [link b](u)** c");
  assert.equal(run("bold", "[a](u)", 3, 6).text, "**[a](u)**");
  assert.equal(run("bold", "x `code` y", 3, 5).text, "x **`code`** y");
  assert.equal(run("italic", "x $a*b$ y", 3, 6).text, "x *$a*b$* y");
  assert.equal(run("bold", "a [link](u) b", 4, 6).text, "a [l**in**k](u) b");
});

test("italic writes the emphasis of its block, else of the document, and a star inside a word", () => {
  assert.equal(run("italic", "_a_ b", 4, 5).text, "_a_ _b_");
  assert.equal(run("italic", "_a_\n\nb", 5, 6).text, "_a_\n\n_b_");
  assert.equal(run("italic", "_a_\n\n*d* b", 9, 10).text, "_a_\n\n*d* *b*");
  assert.equal(run("italic", "_a_ snake_case", 10, 14).text, "_a_ snake_*case*");
  assert.equal(run("italic", "_a_ bc", 4, 5).text, "_a_ *b*c");
  assert.equal(run("italic", "_a_ b ", 6).text, "_a_ b __");
  assert.equal(run("italic", "_a_ b", 5).text, "_a_ b**");
});

test("code fences text with backticks in a longer run", () => {
  assert.equal(run("code", "a ` b", 0, 5).text, "``a ` b``");
  assert.equal(run("code", "`x", 0, 2).text, "`` `x ``");
  assert.equal(twice("code", "`x", 0, 2), "`x");
});

test("a mark on a table marks each cell", () => {
  assert.equal(run("bold", "| a | b |\n| - | - |\n| c | d |", 20, 31).text, "| a | b |\n| - | - |\n| **c** | **d** |");
});

test("a mark at a caret outside any text goes after the line syntax", () => {
  assert.equal(run("bold", "- ", 0).text, "- ****");
  assert.equal(run("bold", "a\n\nb", 2).text, "a\n****\nb");
});

test("a mark on a selection without inline text changes nothing", () => {
  assert.deepEqual(run("bold", "a   b", 2, 3), { text: "a   b", selected: " " });
  assert.deepEqual(run("italic", "```\nx*y\n```", 4, 7), { text: "```\nx*y\n```", selected: "x*y" });
});

// The places a mark meets in real markdown: [text, the selected part].
const places: [string, string][] = [
  ["a word b", "word"],
  ["snake_case_name", "case"],
  ["see [the link](u) end", "link"],
  ["`x` word `y`", "word"],
  ["a \\*word\\* b", "word"],
  ["> a word\n> b", "word"],
  ["- a\n  - b word", "word"],
  ["- a\n\t- word", "word"],
  ["a\r\nword b", "word"],
];
for (const id of ["bold", "italic", "strike", "code"] as const) {
  test(`${id} twice restores the text`, () => {
    for (const [value, part] of places) {
      const [s, e] = [value.indexOf(part), value.indexOf(part) + part.length];
      assert.notEqual(run(id, value, s, e).text, value);
      assert.equal(twice(id, value, s, e), value, JSON.stringify(value));
    }
  });
}

// Lines a line tool turns on: [text, the selected part].
const lineTexts: [string, string][] = [
  ["a word b", "word"],
  ["one\ntwo", "one\ntwo"],
  ["> a\n> word", "a\n> word"],
  ["- a\n  word", "word"],
  ["\ta\n\tword", "a\n\tword"],
  ["a\r\nword\r\nb", "a\r\nword"],
  ["- a\n\t- b\n\tword", "word"],
];
for (const id of ["quote", "ul", "ol", "task"] as const) {
  test(`${id} twice restores the text`, () => {
    for (const [value, part] of lineTexts) {
      if (id === "task" && value.startsWith("- a\n")) continue; // a task in a list comes off as an item
      // A line that continues an item becomes an item, and off it is a paragraph of its own (separate).
      if (id !== "quote" && /\n[ \t]+word$/.test(value) && /^- /m.test(value)) continue;
      const [s, e] = [value.indexOf(part), value.indexOf(part) + part.length];
      assert.equal(twice(id, value, s, e), value, JSON.stringify(value));
    }
  });
}

test("list tools work inside a quote", () => {
  assert.equal(run("task", "> - a\n> - b", 4).text, "> - [ ] a\n> - b");
  assert.equal(run("task", "> - [ ] a\n> - [ ] b", 8).text, "> - a\n> - [ ] b");
  assert.equal(run("task", "> - [ ] a", 8).text, "> a");
  assert.equal(run("ul", "> a\n> b", 0, 7).text, "> - a\n> - b");
  assert.equal(run("ul", "> - a\n> - b", 0, 11).text, "> a\n> b");
  assert.equal(run("ol", "> a\n> b", 0, 7).text, "> 1. a\n> 2. b");
  assert.equal(run("ul", "> a\n>\n> b", 0, 9).text, "> - a\n>\n> - b");
});

test("list tools keep the indent as it is written, and read a tab as 4 columns", () => {
  assert.equal(run("ul", "\ta\n\tb", 0, 5).text, "\t- a\n\t- b");
  assert.equal(twice("ul", "\ta\n\tb", 0, 5), "\ta\n\tb");
  assert.equal(run("ol", "- a\n\t- b", 0, 8).text, "1. a\n     1. b");
});

test("an item that comes off is a paragraph of its own, and on again it joins the list", () => {
  assert.equal(run("ul", "- one\n- two\n- three", 14).text, "- one\n- two\n\nthree");
  assert.equal(twice("ul", "- one\n- two\n- three", 14), "- one\n- two\n- three");
  assert.equal(twice("ul", "- a\n- b\n- c", 6), "- a\n- b\n- c");
  assert.equal(run("ul", "> - a\n> - b", 10).text, "> - a\n>\n> b");
  assert.equal(twice("ul", "> - a\n> - b", 10), "> - a\n> - b");
  assert.equal(twice("ol", "1. a\n2. b\n3. c", 8), "1. a\n2. b\n3. c");
  // A line that is not next to a list does not take a blank line.
  assert.equal(twice("ul", "one\ntwo", 5), "one\ntwo");
});

test("selectionAfter keeps the caret on its text when a blank line comes or goes", () => {
  for (const [value, at] of [["- one\n- two\n- three", 16], ["- one\n- two\n\nthree", 15]] as const) {
    const edit = sourceEdit("ul", value, at, at);
    const text = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
    const [s] = selectionAfter("ul", value, edit, at, at);
    assert.equal(text.slice(s - 2, s), value.slice(at - 2, at));
  }
});

test("off inside a list: a bullet or a number comes off, a task keeps its item", () => {
  assert.equal(run("ul", "- a\n- b\n- c", 6).text, "- a\n\nb\n\n- c");
  assert.equal(run("ol", "1. a\n2. b\n3. c", 8).text, "1. a\n\nb\n\n3. c");
  assert.equal(run("task", "- [ ] a\n- [ ] b\n- [ ] c", 14).text, "- [ ] a\n- b\n- [ ] c");
  assert.equal(run("task", "1. a\n2. [ ] b", 9).text, "1. a\n2. b");
});

test("a list on lines that are partly items keeps their markers and boxes", () => {
  assert.equal(run("task", "- [x] a\nb", 0, 9).text, "- [x] a\n- [ ] b");
  assert.equal(run("ul", "* a\nb", 0, 5).text, "* a\n* b".replace("* b", "- b"));
});

test("heading sets, replaces and clears the level", () => {
  assert.equal(run("heading", "title", 2, 2, 2).text, "## title");
  assert.equal(run("heading", "# title", 3, 3, 3).text, "### title");
  assert.equal(run("heading", "### title", 0, 0, 0).text, "title");
});

test("heading works on the first line when it is empty and on every selected line", () => {
  assert.equal(run("heading", "\nb", 0, 0, 1).text, "# \nb");
  assert.equal(run("heading", "a\nb\nc", 0, 3, 1).text, "# a\n# b\nc");
});

test("heading leaves out blank lines and goes after the quote and list syntax", () => {
  assert.equal(run("heading", "one\n\ntwo", 0, 8, 2).text, "## one\n\n## two");
  assert.equal(run("heading", "- a\n  - b", 8, 8, 2).text, "- a\n  - ## b");
  assert.equal(run("heading", "- a\n  - ## b", 11, 11, 0).text, "- a\n  - b");
  assert.equal(run("heading", "> - b", 4, 4, 3).text, "> - ### b");
  assert.equal(headingLevel("> - ### b", 8), 3);
});

test("heading puts the caret at the end of a single line", () => {
  assert.deepEqual(sourceEdit("heading", "title", 2, 2, 1).select, [7, 7]);
});

test("list kinds toggle on and off", () => {
  assert.equal(run("ul", "a\nb", 0, 3).text, "- a\n- b");
  assert.equal(run("ul", "- a\n- b", 0, 7).text, "a\nb");
  assert.equal(run("ol", "a\nb", 0, 3).text, "1. a\n2. b");
  assert.equal(run("ol", "1. a\n2. b", 0, 9).text, "a\nb");
  assert.equal(run("task", "a", 0).text, "- [ ] a");
  assert.equal(run("task", "- [x] a", 0).text, "a");
  assert.equal(run("quote", "a\nb", 0, 3).text, "> a\n> b");
  assert.equal(run("quote", "> a\n> b", 0, 7).text, "a\nb");
});

test("a list leaves out the blank lines between selected lines", () => {
  assert.equal(run("task", "a\n\nb", 0, 4).text, "- [ ] a\n\n- [ ] b");
  assert.equal(run("task", "- [ ] a\n\n- [ ] b", 0, 16).text, "a\n\nb");
  assert.equal(run("ol", "a\n\nb", 0, 4).text, "1. a\n\n2. b");
  assert.equal(run("ul", "", 0).text, "- ");
  assert.equal(run("quote", "a\n\nb", 0, 4).text, "> a\n> \n> b");
});

test("a task inside a list turns back into a bullet, a task on its own into a line", () => {
  assert.equal(run("task", "- a\n- b\n- c", 6).text, "- a\n- [ ] b\n- c");
  assert.equal(run("task", "- a\n- [ ] b\n- c", 6).text, "- a\n- b\n- c");
  assert.equal(run("task", "- [ ] a\n- b", 0).text, "- a\n- b");
  assert.equal(run("task", "- a\n  - [x] b", 8).text, "- a\n  - b");
  assert.equal(run("task", "- a\n  - b", 8).text, "- a\n  - [ ] b");
  assert.equal(run("task", "x\n\n- [ ] a\n- [ ] b\n\ny", 3, 16).text, "x\n\na\nb\n\ny");
});

test("a line tool selects every line it changed, so a second click toggles them all", () => {
  assert.deepEqual(run("quote", "a\nb", 0, 3), { text: "> a\n> b", selected: "> a\n> b" });
  for (const id of ["quote", "ul", "ol", "task"] as const) assert.equal(twice(id, "one\ntwo\nthree", 1, 9), "one\ntwo\nthree");
});

test("taking a list marker off keeps the indent", () => {
  assert.equal(run("ul", "- a\n  - b", 8).text, "- a\n\n  b");
  assert.equal(twice("ul", "- a\n  - b", 8), "- a\n  - b");
  assert.equal(run("ol", "1. a\n   1. b\n2. c", 11).text, "1. a\n\n   b\n\n2. c");
  assert.equal(twice("ol", "1. a\n   1. b\n2. c", 11), "1. a\n   1. b\n2. c");
  assert.equal(run("ol", "  1. a\n  2. b", 0, 13).text, "  a\n  b");
});

test("a task is the item it was made from, with a box", () => {
  assert.equal(twice("task", "a", 0), "a");
  assert.equal(twice("task", "- a\n- b", 6), "- a\n- b");
  assert.equal(run("task", "1. a", 3).text, "1. [ ] a");
  assert.equal(run("task", "1. [ ] a", 3).text, "1. a");
  assert.equal(twice("task", "1) a\n2) b", 0, 9), "1) a\n2) b");
});

test("a numbered list counts on each level and moves the child items to the text of their parent", () => {
  assert.equal(run("ol", "- a\n  - b\n  - c", 0, 15).text, "1. a\n   1. b\n   2. c");
  assert.equal(run("ol", "- a\n  - b\n- c\n  - d", 0, 21).text, "1. a\n   1. b\n2. c\n   1. d");
  assert.equal(run("ul", "1. a\n   1. b\n   2. c", 0, 22).text, "- a\n  - b\n  - c");
  assert.equal(run("ol", "- a\n  - b", 8).text, "- a\n  1. b");
});

test("selectionAfter keeps a line edit on the same text", () => {
  const after = (value: string, s: number, e: number, id: Parameters<typeof sourceEdit>[0] = "task") => {
    const edit = sourceEdit(id, value, s, e, 1);
    const [from, to] = selectionAfter(id, value, edit, s, e);
    const text = apply(value, edit).text;
    return text.slice(0, from) + "|" + text.slice(from, to) + (to > from ? "|" : "") + text.slice(to);
  };
  assert.equal(after("test", 2, 2), "- [ ] te|st");
  assert.equal(after("- [ ] test", 2, 2), "|test");
  assert.equal(after("a\nbc", 0, 3, "ol"), "1. |a\n2. b|c");
  assert.equal(after("title", 5, 5, "heading"), "# title|");
});

test("selectionAfter takes the selection of any other tool from its edit", () => {
  assert.deepEqual(selectionAfter("codeblock", "x", sourceEdit("codeblock", "x", 0, 1), 0, 1), [4, 5]);
  assert.deepEqual(selectionAfter("code", "x", sourceEdit("code", "x", 0, 1), 0, 1), [1, 2]);
});

test("a selection that ends at a line start does not touch the next line", () => {
  assert.equal(run("quote", "a\nb\nc", 0, 2).text, "> a\nb\nc");
  assert.equal(run("heading", "a\nb", 0, 2, 1).text, "# a\nb");
});

test("a list kind replaces another kind", () => {
  assert.equal(run("ol", "- a\n- b", 0, 7).text, "1. a\n2. b");
  assert.equal(run("ul", "- [ ] a", 0).text, "- a");
  assert.equal(run("task", "- a", 0).text, "- [ ] a");
  assert.equal(run("quote", "- a", 0).text, "> - a");
});

test("link wraps the selection and selects the address", () => {
  assert.deepEqual(run("link", "see here", 4, 8), { text: "see [here](https://)", selected: "https://" });
});

test("link without a selection puts the caret in empty brackets before the address", () => {
  assert.deepEqual(run("link", "", 0), { text: "[](https://)", selected: "" });
  assert.deepEqual(sourceEdit("link", "", 0, 0).select, [1, 1]);
});

test("link with a selected URL keeps the URL and puts the caret in the text", () => {
  assert.deepEqual(run("link", "https://uldagon.com", 0, 19), { text: "[](https://uldagon.com)", selected: "" });
});

test("block at the start of the text has no blank line before", () => {
  assert.deepEqual(run("hr", "", 0), { text: "---\n", selected: "" });
});

test("block after a line gets a blank line before and after", () => {
  assert.equal(run("hr", "a", 1).text, "a\n\n---\n");
  assert.equal(run("hr", "a\nb", 2).text, "a\n\n---\n\nb");
});

test("block keeps blank lines that exist", () => {
  assert.equal(run("hr", "a\n\n\n\nb", 3).text, "a\n\n---\n\nb");
  assert.equal(run("hr", "a\n\n", 3).text, "a\n\n---\n");
});

test("code block wraps the selection, or an empty line with the caret on it", () => {
  assert.deepEqual(run("codeblock", "x = 1", 0, 5), { text: "```\nx = 1\n```\n", selected: "x = 1" });
  assert.deepEqual(run("codeblock", "", 0), { text: "```\n\n```\n", selected: "" });
  assert.deepEqual(sourceEdit("codeblock", "", 0, 0).select, [4, 4]);
});

test("table inserts a table and selects the first header", () => {
  assert.deepEqual(run("table", "", 0), {
    text: "| column | column |\n| --- | --- |\n| cell | cell |\n",
    selected: "column",
  });
});

test("continueList numbers the next item", () => {
  assert.deepEqual(continueList("1. a", 4), { start: 4, end: 4, text: "\n2. ", select: [4, 4] });
  assert.deepEqual(continueList("9) a", 4)?.text, "\n10) ");
});

test("continueList keeps the marker, the indent and the quote", () => {
  assert.equal(continueList("- a", 3)?.text, "\n- ");
  assert.equal(continueList("  * a", 5)?.text, "\n  * ");
  assert.equal(continueList("> a", 3)?.text, "\n> ");
});

test("continueList opens an unchecked task after a checked one", () => {
  assert.equal(continueList("- [x] a", 7)?.text, "\n- [ ] ");
});

test("continueList ends the list on an empty item", () => {
  assert.deepEqual(continueList("- a\n- ", 6), { start: 4, end: 6, text: "", select: [0, 0] });
  assert.deepEqual(continueList("1. ", 3), { start: 0, end: 3, text: "", select: [0, 0] });
});

test("continueList splits an item when the caret is right after the marker", () => {
  assert.deepEqual(apply("- foo", continueList("- foo", 2)!).text, "- \n- foo");
  assert.deepEqual(apply("- a\n- foo\n- b", continueList("- a\n- foo\n- b", 6)!).text, "- a\n- \n- foo\n- b");
});

test("continueList ends the list on an empty item that is not the last line", () => {
  assert.deepEqual(continueList("- a\n- \nb", 6), { start: 4, end: 6, text: "", select: [0, 0] });
});

test("continueList keeps the quote of an item in a quote", () => {
  assert.equal(continueList("> - a", 5)?.text, "\n> - ");
  assert.equal(continueList("> 1. [x] a", 10)?.text, "\n> 2. [ ] ");
  assert.deepEqual(continueList("> - ", 4), { start: 0, end: 4, text: "", select: [0, 0] });
  assert.equal(continueList("\t- a", 4)?.text, "\n\t- ");
});

test("continueList returns null outside a list", () => {
  assert.equal(continueList("-", 1), null);
  assert.equal(continueList("**a**", 5), null);
  assert.equal(continueList("plain", 5), null);
  assert.equal(continueList("", 0), null);
});

test("continueList splits an item at the caret", () => {
  assert.deepEqual(apply("- ab", continueList("- ab", 3)!).text, "- a\n- b");
});

test("headingLevel reads the caret line", () => {
  assert.equal(headingLevel("# a\n### b\nc", 0), 1);
  assert.equal(headingLevel("# a\n### b\nc", 6), 3);
  assert.equal(headingLevel("# a\n### b\nc", 10), 0);
  assert.equal(headingLevel("####### seven", 0), 0);
  assert.equal(headingLevel("", 0), 0);
});

test("line tools leave table rows and a heading leaves task items as they are", () => {
  const table = "| a | b |\n| --- | --- |\n| cell | two |\n\nend";
  for (const id of ["quote", "ul", "ol", "task"] as const) assert.equal(run(id, table, 30).text, table, id);
  assert.equal(run("heading", table, 30, 30, 2).text, table);
  assert.equal(run("heading", "- [ ] open", 8, 8, 2).text, "- [ ] open");
});

test("marks work on a line with a bare URL", () => {
  assert.equal(run("bold", "see https://a.example/x now", 24, 27).text, "see https://a.example/x **now**");
});
