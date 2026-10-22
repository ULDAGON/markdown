import assert from "node:assert/strict";
import { test } from "node:test";
import type { Element } from "hast";
import { fromHtml } from "hast-util-from-html";
import { hasClass, render } from "../src/lib/markdown/render.ts";

function topLevel(html: string): Element[] {
  return fromHtml(html, { fragment: true }).children.filter((node) => node.type === "element");
}

function find(node: Element, test: (element: Element) => boolean): Element | undefined {
  if (test(node)) return node;
  for (const child of node.children) {
    const found = child.type === "element" ? find(child, test) : undefined;
    if (found) return found;
  }
}

function findAll(nodes: Element[], test: (element: Element) => boolean): Element[] {
  return nodes.flatMap((node) => [
    ...(test(node) ? [node] : []),
    ...findAll(node.children.filter((child) => child.type === "element"), test),
  ]);
}

/** The source of each block, and whether it is rich. */
function blocksOf(markdown: string): [string, boolean][] {
  const { html, blocks } = render(markdown);
  const marked = topLevel(html).filter((element) => element.properties.dataStart !== undefined);
  return blocks.map(({ start, end }, index) => [markdown.slice(start, end), marked[index].properties.dataRich !== undefined]);
}

const source = [
  "# Title",
  "Text with a note[^n] and $x^2$.",
  "- one\n- two",
  "```js\nconst a = 1\n```",
  "```mermaid\ngraph A --> B<c>\n```",
  "$$\nE = mc^2\n$$",
  '<div onclick="steal()">raw<script>alert(1)</script><img src="x.png" onerror="alert(1)"></div>',
  "[^n]: The note.",
].join("\n\n");

const { html, blocks } = render(source);
const elements = topLevel(html);
const [heading, paragraph, list, code, diagram, math, raw, footnotes] = elements;

test("offsets slice back to the source of each block", () => {
  assert.deepEqual(
    blocks.map(({ start, end }) => source.slice(start, end)),
    source.split("\n\n").slice(0, -1),
  );
  const marked = elements.filter((element) => element.properties.dataStart !== undefined);
  assert.deepEqual(
    marked.map((element) => ({ start: Number(element.properties.dataStart), end: Number(element.properties.dataEnd) })),
    blocks,
  );
});

test("code, math, Mermaid and raw HTML are rich blocks", () => {
  for (const block of [code, diagram, math, raw]) {
    assert.ok(block.properties.dataRich !== undefined, block.tagName);
    assert.equal(block.properties.contentEditable, "false");
  }
  for (const block of [heading, paragraph, list]) assert.equal(block.properties.dataRich, undefined);
  assert.equal(code.tagName, "pre");
  assert.ok(find(code, (node) => hasClass(node, "hljs-keyword")));
  assert.ok(find(math, (node) => hasClass(node, "katex-display")));
});

test("a block that toMarkdown cannot give back is rich", () => {
  const lossy = [
    "H<sub>2</sub>O",
    "x <!-- keep --> y",
    "see [docs][d]",
    "![logo][d]",
    "a&nbsp;b",
    "&copy; 2026",
    "&#123;",
    "> quote\n>\n> [e]: https://e.f",
  ];
  const markdown = [...lossy, "plain *text*", "[d]: https://x.y"].join("\n\n");
  assert.deepEqual(blocksOf(markdown), [...lossy.map((block): [string, boolean] => [block, true]), ["plain *text*", false]]);
});

test("raw HTML that encloses markdown is one rich block", () => {
  assert.deepEqual(blocksOf('<div align="center">\n\n# Title\n\n</div>\n\ntext'), [
    ['<div align="center">\n\n# Title\n\n</div>', true],
    ["text", false],
  ]);
  const details = "<details><summary>s</summary>\n\n- [ ] t\n\n</details>";
  assert.deepEqual(blocksOf(details + "\n\n<div>x</div>\n\nafter"), [
    [details, true],
    ["<div>x</div>", true],
    ["after", false],
  ]);
  const [block] = topLevel(render(details).html);
  assert.equal(block.tagName, "details");
  assert.equal(block.properties.contentEditable, "false");
  assert.ok(find(block, (node) => node.tagName === "li"));
});

test("an HTML comment on its own renders to no block", () => {
  assert.deepEqual(blocksOf("<!-- c -->\n\npara"), [["para", false]]);
});

test("HTML in the source cannot set the block markers", () => {
  const spoof = '</div>\n<p data-start="0" data-end="3" data-rich>spoof</p>';
  assert.deepEqual(blocksOf(spoof + "\n\nreal para"), [
    [spoof, true],
    ["real para", false],
  ]);
  const { html } = render(spoof + '\n\nHi <span data-rich data-start="1">x</span>\n\n<div class="diagram">no pre</div>');
  const elements = topLevel(html);
  const markers = (node: Element) =>
    node.properties.dataStart !== undefined || node.properties.dataEnd !== undefined || node.properties.dataRich !== undefined;
  assert.deepEqual(findAll(elements, markers), elements);
  assert.deepEqual(findAll(elements, (node) => hasClass(node, "diagram")), []);
});

test("a Mermaid block is a diagram with its escaped source and no highlighting", () => {
  assert.equal(diagram.tagName, "div");
  assert.ok(hasClass(diagram, "diagram"));
  assert.match(html, /<div [^>]*class="diagram"[^>]*><pre>graph A --> B&#x3C;c>\n<\/pre><\/div>/);
});

test("footnote references link to the footnotes section, which is not editable", () => {
  const ref = find(paragraph, (node) => node.properties.dataFootnoteRef !== undefined)!;
  const item = find(footnotes, (node) => node.tagName === "li")!;
  const backref = find(footnotes, (node) => node.properties.dataFootnoteBackref !== undefined)!;
  assert.equal(ref.properties.href, "#user-content-fn-n");
  assert.equal(item.properties.id, "user-content-fn-n");
  assert.equal(backref.properties.href, "#" + ref.properties.id);
  assert.equal(footnotes.tagName, "section");
  assert.equal(footnotes.properties.contentEditable, "false");
  assert.equal(footnotes.properties.dataStart, undefined);
});

test("headings get a non-editable anchor to their slug", () => {
  const anchor = heading.children.at(-1) as Element;
  // No prefix on heading ids: links the user writes as `[x](#title)` must keep working.
  assert.equal(heading.properties.id, "title");
  assert.equal(anchor.tagName, "a");
  assert.ok(hasClass(anchor, "anchor"));
  assert.equal(anchor.properties.href, "#title");
  assert.equal(anchor.properties.contentEditable, "false");
  assert.equal(anchor.properties.ariaHidden, "true");
});

test("raw HTML loses scripts and event handlers", () => {
  assert.doesNotMatch(html, /<script|alert|onerror|onclick|steal/);
  assert.ok(find(raw, (node) => node.tagName === "img"));
});

test("inline math is not editable", () => {
  const katex = find(paragraph, (node) => hasClass(node, "katex"))!;
  assert.equal(katex.properties.contentEditable, "false");
});

test("the text of a task item starts right after its checkbox", () => {
  assert.match(render("- [ ] tight").html, /<li class="task-list-item"><input type="checkbox" disabled>tight<\/li>/);
  assert.match(render("- [x] loose\n\n- [ ] b").html, /<p><input type="checkbox" checked disabled>loose<\/p>/);
});

test("a list item of only a checkbox is an empty task item; an escaped one is text", () => {
  assert.match(render("- [ ] ").html, /<li class="task-list-item"><input type="checkbox" disabled><\/li>/);
  assert.match(render("- \\[ ]").html, /<li>\[ \]<\/li>/);
});
