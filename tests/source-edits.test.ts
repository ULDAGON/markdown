import assert from "node:assert/strict";
import { test } from "node:test";
import { continueList, headingLevel, sourceEdit, type Edit } from "../src/lib/source-edits.ts";

// Apply an edit the way the textarea does, and report the text and the selected part.
function apply(value: string, edit: Edit) {
  const text = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return { text, selected: text.slice(edit.start + edit.select[0], edit.start + edit.select[1]) };
}
const run = (id: Parameters<typeof sourceEdit>[0], value: string, s: number, e = s, arg?: number) =>
  apply(value, sourceEdit(id, value, s, e, arg));

test("wrap marks the selection", () => {
  assert.deepEqual(run("bold", "a word b", 2, 6), { text: "a **word** b", selected: "word" });
  assert.deepEqual(run("italic", "x", 0, 1), { text: "_x_", selected: "x" });
  assert.equal(run("strike", "x", 0, 1).text, "~~x~~");
  assert.equal(run("code", "x", 0, 1).text, "`x`");
});

test("wrap inserts a placeholder at a caret", () => {
  assert.deepEqual(run("bold", "", 0), { text: "**bold**", selected: "bold" });
});

test("wrap unwraps markers around the selection", () => {
  assert.deepEqual(run("bold", "a **word** b", 4, 8), { text: "a word b", selected: "word" });
});

test("wrap unwraps markers inside the selection", () => {
  assert.deepEqual(run("bold", "a **word** b", 2, 10), { text: "a word b", selected: "word" });
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

test("link without a selection inserts a text and an address", () => {
  assert.deepEqual(run("link", "", 0), { text: "[text](https://)", selected: "https://" });
});

test("link with a selected URL keeps the URL and selects the text", () => {
  assert.deepEqual(run("link", "https://uldagon.com", 0, 19), { text: "[text](https://uldagon.com)", selected: "text" });
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

test("code block wraps the selection, or a placeholder", () => {
  assert.deepEqual(run("codeblock", "x = 1", 0, 5), { text: "```\nx = 1\n```\n", selected: "x = 1" });
  assert.deepEqual(run("codeblock", "", 0), { text: "```\ncode\n```\n", selected: "code" });
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

test("continueList returns null outside a list", () => {
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
