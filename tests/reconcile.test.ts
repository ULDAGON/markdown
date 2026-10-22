import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockRange } from "../src/lib/markdown/render.ts";
import { reconcile, type Child } from "../src/lib/markdown/reconcile.ts";

/** The ranges of the parts in the text, each searched after the previous one. */
function rangesOf(text: string, parts: string[]): BlockRange[] {
  let from = 0;
  return parts.map((part) => {
    const start = text.indexOf(part, from);
    assert.notEqual(start, -1, `"${part}" is not in the text`);
    from = start + part.length;
    return { start, end: from };
  });
}

function check(result: { text: string; ranges: BlockRange[] }, text: string, parts: string[]) {
  assert.equal(result.text, text);
  assert.deepEqual(result.ranges, rangesOf(text, parts));
}

const clean = (range: BlockRange): Child => ({ range });
const added = (markdown: string, from?: BlockRange): Child => ({ markdown, from });

test("no change keeps the text identical", () => {
  const source = "# Title\n\n\nPara one.\n\n[x]: http://x\n\n<!-- c -->\n\n- a\n- b\n";
  const rendered = rangesOf(source, ["# Title", "Para one.", "- a\n- b"]);
  const result = reconcile(source, rendered, rendered.map(clean));
  assert.equal(result.text, source);
  assert.deepEqual(result.ranges, rendered);
});

test("an edit in the middle keeps the odd text around it byte for byte", () => {
  const source = "# Title\n\n\n<!-- note -->\n\nOld para.\n\n[x]: http://x\n\n\nLast.";
  const [title, para, last] = rangesOf(source, ["# Title", "Old para.", "Last."]);
  const result = reconcile(source, [title, para, last], [clean(title), added("New *para*."), clean(last)]);
  check(
    result,
    "# Title\n\n\n<!-- note -->\n\nNew *para*.\n\n[x]: http://x\n\n\nLast.",
    ["# Title", "New *para*.", "Last."],
  );
});

test("Enter splits a block into two elements with the same range", () => {
  const source = "A\n\nBC\n\nD\n";
  const [a, bc, d] = rangesOf(source, ["A", "BC", "D"]);
  const result = reconcile(source, [a, bc, d], [clean(a), added("B", bc), added("C", bc), clean(d)]);
  check(result, "A\n\nB\n\nC\n\nD\n", ["A", "B", "C", "D"]);
});

test("Backspace merges two blocks into one", () => {
  const source = "A\n\nB\n\nC\n\nD\n";
  const [a, b, c, d] = rangesOf(source, ["A", "B", "C", "D"]);
  const result = reconcile(source, [a, b, c, d], [clean(a), added("BC", b), clean(d)]);
  check(result, "A\n\nBC\n\nD\n", ["A", "BC", "D"]);
});

test("a delete across blocks removes them and the extra blank lines", () => {
  const source = "A\n\nB\n\nC\n\nD\n";
  const [a, b, c, d] = rangesOf(source, ["A", "B", "C", "D"]);
  const result = reconcile(source, [a, b, c, d], [clean(a), clean(d)]);
  check(result, "A\n\nD\n", ["A", "D"]);
});

test("new blocks at the start", () => {
  const source = "A\n\nB\n";
  const [a, b] = rangesOf(source, ["A", "B"]);
  const result = reconcile(source, [a, b], [added("X"), added("Y"), clean(a), clean(b)]);
  check(result, "X\n\nY\n\nA\n\nB\n", ["X", "Y", "A", "B"]);
});

test("a new block in the middle goes after the previous kept block", () => {
  const source = "A\n\n[x]: http://x\n\nB\n";
  const [a, b] = rangesOf(source, ["A", "B"]);
  const result = reconcile(source, [a, b], [clean(a), added("X"), clean(b)]);
  check(result, "A\n\nX\n\n[x]: http://x\n\nB\n", ["A", "X", "B"]);
});

test("a new block at the end", () => {
  const source = "A\n\nB\n";
  const [a, b] = rangesOf(source, ["A", "B"]);
  const result = reconcile(source, [a, b], [clean(a), clean(b), added("X")]);
  check(result, "A\n\nB\n\nX\n", ["A", "B", "X"]);
});

test("a delete of all blocks leaves an empty text", () => {
  const source = "A\n\nB\n";
  const result = reconcile(source, rangesOf(source, ["A", "B"]), []);
  check(result, "", []);
});

test("a delete of all blocks keeps the text that renders to no block", () => {
  const source = "A\n\n[x]: http://x\n\nB\n";
  const result = reconcile(source, rangesOf(source, ["A", "B"]), []);
  check(result, "[x]: http://x\n", []);
});

test("a change of the first and of the last block", () => {
  const source = "A\n\nB\n\nC\n";
  const [a, b, c] = rangesOf(source, ["A", "B", "C"]);
  const result = reconcile(source, [a, b, c], [added("A2", a), clean(b), added("C2", c)]);
  check(result, "A2\n\nB\n\nC2\n", ["A2", "B", "C2"]);
});

test("the final newline stays absent", () => {
  const source = "A\n\nB";
  const [a, b] = rangesOf(source, ["A", "B"]);
  check(reconcile(source, [a, b], [clean(a), added("B2")]), "A\n\nB2", ["A", "B2"]);
  check(reconcile(source, [a, b], [clean(a)]), "A", ["A"]);
});

test("the final newline stays present", () => {
  const source = "A\n\nB\n";
  const [a, b] = rangesOf(source, ["A", "B"]);
  check(reconcile(source, [a, b], [clean(a), added("B2")]), "A\n\nB2\n", ["A", "B2"]);
  check(reconcile(source, [a, b], [clean(a)]), "A\n", ["A"]);
});

test("a definition between two merged blocks goes after the merged block", () => {
  const source = "A\n\nB\n\n[^1]: note\n\nC\n\nD";
  const [a, b, c, d] = rangesOf(source, ["A", "B", "C", "D"]);
  const result = reconcile(source, [a, b, c, d], [clean(a), added("BC", b), clean(d)]);
  check(result, "A\n\nBC\n\n[^1]: note\n\nD", ["A", "BC", "D"]);
});

test("a comment between two edited blocks stays between them", () => {
  const source = "one\n\n<!-- keep   this -->\n\ntwo";
  const [one, two] = rangesOf(source, ["one", "two"]);
  const result = reconcile(source, [one, two], [added("one1", one), added("two2", two)]);
  check(result, "one1\n\n<!-- keep   this -->\n\ntwo2", ["one1", "two2"]);
});

test("an edited block goes where the block that it came from was", () => {
  // The first block was emptied, the second one split.
  const source = "aaa\n\n<!-- c -->\n\nbbb ccc\n\nend";
  const [aaa, bbbccc, end] = rangesOf(source, ["aaa", "bbb ccc", "end"]);
  const result = reconcile(source, [aaa, bbbccc, end], [added("bbb", bbbccc), added("ccc", bbbccc), clean(end)]);
  check(result, "<!-- c -->\n\nbbb\n\nccc\n\nend", ["bbb", "ccc", "end"]);
});

test("a block from nowhere or from before the block in front of it goes after that block", () => {
  const source = "A\n\n<!-- c -->\n\nB";
  const [a, b] = rangesOf(source, ["A", "B"]);
  check(reconcile(source, [a, b], [added("A2", a), added("X"), added("B2", b)]), "A2\n\nX\n\n<!-- c -->\n\nB2", ["A2", "X", "B2"]);
  check(reconcile(source, [a, b], [added("B2", b), added("A2", a)]), "<!-- c -->\n\nB2\n\nA2", ["B2", "A2"]);
});

test("a single newline at a hunk edge becomes a blank line", () => {
  const source = "# H\nText\n";
  const [heading, text] = rangesOf(source, ["# H", "Text"]);
  const result = reconcile(source, [heading, text], [added("H"), clean(text)]);
  check(result, "H\n\nText\n", ["H", "Text"]);
});

test("a single newline next to text that renders to no block becomes a blank line", () => {
  const source = "[x]: http://x\n# H\n[y]: http://y\n";
  const [heading] = rangesOf(source, ["# H"]);
  const result = reconcile(source, [heading], [added("H")]);
  check(result, "[x]: http://x\n\nH\n\n[y]: http://y\n", ["H"]);
});

test("a block replaced by blank markdown is removed with its blank line", () => {
  const source = "A\n\nB\n\nC\n";
  const [a, b, c] = rangesOf(source, ["A", "B", "C"]);
  check(reconcile(source, [a, b, c], [clean(a), added(""), clean(c)]), "A\n\nC\n", ["A", "C"]);
  check(reconcile(source, [a, b, c], [added(" \n"), clean(b), clean(c)]), "B\n\nC\n", ["B", "C"]);
  check(reconcile(source, [a, b, c], [clean(a), clean(b), added("")]), "A\n\nB\n", ["A", "B"]);
  check(reconcile("B", [{ start: 0, end: 1 }], [added("")]), "", []);
});

test("the blank lines around new markdown go, the indent of its first line stays", () => {
  const source = "A\n\nB\n\nC";
  const [a, b, c] = rangesOf(source, ["A", "B", "C"]);
  const result = reconcile(source, [a, b, c], [clean(a), added("\n\n    code\n\n"), clean(c)]);
  check(result, "A\n\n    code\n\nC", ["A", "    code", "C"]);
});

test("clean children out of source order throw", () => {
  const source = "A\n\nB\n";
  const [a, b] = rangesOf(source, ["A", "B"]);
  assert.throws(() => reconcile(source, [a, b], [clean(b), clean(a)]), /source order/);
});
