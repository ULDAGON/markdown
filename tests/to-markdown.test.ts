import assert from "node:assert/strict";
import { test } from "node:test";
import { fromHtml } from "hast-util-from-html";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { render } from "../src/lib/markdown/render.ts";
import { toMarkdown } from "../src/lib/markdown/to-markdown.ts";

const printer = unified().use(rehypeStringify);

/** The outerHTML of each top-level element, as the preview gives it. */
function topLevelHtml(html: string): string[] {
  return fromHtml(html, { fragment: true })
    .children.filter((node) => node.type === "element")
    .map((element) => printer.stringify({ type: "root", children: [element] }));
}

/** The source of the one block of `markdown`, from its rendered HTML. */
function roundTrip(markdown: string): string {
  const [element] = topLevelHtml(render(markdown).html);
  return toMarkdown(element, markdown);
}

const fixture = [
  "# Heading",
  'A paragraph with **bold**, *italic*, ~~strike~~, `code`, a [link](https://example.com "Title"), a note[^1] and $x^2$.\nIt has a soft line break.',
  "- bullet one\n- bullet two\n  - nested",
  "1. first\n2. second",
  "- [ ] open task\n- [x] done task",
  "> A quote\n> on two lines.",
  "| Name | Value |\n| ---- | ----: |\n| a    |     1 |",
  "---",
  "```js\nconst a = 1\n```",
  "$$\nE = mc^2\n$$",
  "[^1]: The note.",
].join("\n\n");

test("every block of the fixture converts back to its own source", () => {
  const { html, blocks } = render(fixture);
  const elements = topLevelHtml(html);
  assert.equal(blocks.length, 10);
  blocks.forEach(({ start, end }, index) => {
    const original = fixture.slice(start, end);
    assert.equal(toMarkdown(elements[index], original), original);
  });
});

test("the elements that execCommand makes become markdown", () => {
  const html = '<div><b>bold</b> <i>italic</i> <strike>gone</strike> <s>too</s> <font color="red">red</font><span style="color: red">dish</span> end<br></div>';
  assert.equal(toMarkdown(html, ""), "**bold** *italic* ~~gone~~ ~~too~~ reddish end");
});

test("a break at the end of a block is dropped", () => {
  assert.equal(toMarkdown("<p><b>bold<br></b></p>", ""), "**bold**");
  assert.equal(toMarkdown("<p>one<br>two</p>", ""), "one\\\ntwo");
});

test("a no-break space is a space, and a space at the start or end of a block is dropped", () => {
  assert.equal(toMarkdown("<p>end&nbsp;</p>", ""), "end");
  assert.equal(toMarkdown("<p><b>end&nbsp;</b><br></p>", ""), "**end**");
  assert.equal(toMarkdown("<p>&nbsp; &nbsp;<i>start</i></p>", ""), "*start*");
  assert.equal(toMarkdown("<p>a&nbsp; b&nbsp; <code>c&nbsp; d</code></p>", ""), "a  b  `c  d`");
});

test("an edit in a table writes only the changed row, in the style of the original", () => {
  const cases = [
    ["| a | b |\n| --- | --- |\n| **cell** | two |\n| x | y |", "two", "three", "| a | b |\n| --- | --- |\n| **cell** | three |\n| x | y |"],
    ["|a|  b |\n|--|--|\n| 1 | 2 |\n|3|4|", "2", "5", "|a|  b |\n|--|--|\n| 1 | 5 |\n|3|4|"],
    ["| Name | Value |\n| ---- | ----: |\n| a    |     1 |\n| bb   |    22 |", "1", "3", "| Name | Value |\n| ---- | ----: |\n| a    |     3 |\n| bb   |    22 |"],
    ["| Name | Value |\n| ---- | ----: |\n| a    |     1 |\n| bb   |    22 |", "1", "333333", "| Name | Value |\n| ---- | ----: |\n| a    | 333333 |\n| bb   |    22 |"],
  ];
  for (const [original, cell, typed, expected] of cases) {
    const [table] = topLevelHtml(render(original).html);
    assert.equal(toMarkdown(table.replace(`>${cell}<`, `>${typed}<`), original), expected);
  }
});

test("a list keeps its spread: tight with a nested list of two items, loose with a blank line", () => {
  const nested = "- [ ] a\n  - [ ] b\n  - [x] c\n- [ ] d";
  const [list] = topLevelHtml(render(nested).html);
  const toggled = list.replace('<input type="checkbox" disabled>b', '<input type="checkbox" checked disabled>b');
  assert.equal(toMarkdown(toggled, nested), "- [ ] a\n  - [x] b\n  - [x] c\n- [ ] d");
  assert.equal(roundTrip("- a\n\n  - b\n  - c\n\n- d"), "- a\n\n  - b\n  - c\n\n- d");
});

test("a list directly in a list is the nested list of the item before it", () => {
  assert.equal(toMarkdown("<ul><li>one</li><ul><li>two</li></ul><li>X</li></ul>", "- one\n  - two"), "- one\n  - two\n- X");
  assert.equal(toMarkdown("<ol><li>one</li><ol><li>two</li></ol></ol>", ""), "1. one\n   1. two");
});

test("a ! before a footnote reference is not escaped, before a link text it is", () => {
  const html = '<p>Text!<sup><a href="#user-content-fn-1" data-footnote-ref>1</a></sup> and ![a]</p>';
  assert.equal(toMarkdown(html, ""), "Text![^1] and !\\[a]");
});

test("the checked attribute is the state of a task", () => {
  const html = '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> task</li></ul>';
  assert.equal(toMarkdown(html, "- [ ] task"), "- [x] task");
});

test("TeX that KaTeX cannot parse keeps its delimiters", () => {
  assert.equal(roundTrip("a $\\frac{1}{$ b"), "a $\\frac{1}{$ b");
  assert.equal(roundTrip("> $$\n> \\frac{1}{\n> $$"), "> $$\n> \\frac{1}{\n> $$");
});

test("the markers of the original block stay", () => {
  const cases = [
    ["_x_ and __y__", "<p><em>x</em> and <strong>y</strong></p>"],
    ["* item", "<ul><li>item</li></ul>"],
    ["+ item", "<ul><li>item</li></ul>"],
    ["1) item", "<ol><li>item</li></ol>"],
    ["1. a\n1. b", "<ol><li>a</li><li>b</li></ol>"],
    ["-   x", "<ul><li>x</li></ul>"],
    ["~~~\ncode\n~~~", "<pre><code>code\n</code></pre>"],
    ["***", "<hr>"],
    ["Title\n=====", "<h1>Title</h1>"],
  ];
  for (const [original, html] of cases) assert.equal(toMarkdown(html, original), original);
});

test("without an original block the defaults apply", () => {
  const html = "<ul><li><em>x</em> <strong>y</strong></li></ul><hr><pre><code>z\n</code></pre>";
  assert.equal(toMarkdown(html, ""), "- *x* **y**\n\n---\n\n```\nz\n```");
});
