import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Root as MdastRoot } from "mdast";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Transformer } from "unified";
import { EXIT, SKIP, visit } from "unist-util-visit";
import { hasClass, toMarkdown } from "./to-markdown.ts";

export type BlockRange = { start: number; end: number };

type PlannedBlock = BlockRange & { rich: boolean };

// The block markers are set between the two processors, after sanitize, so HTML in the source cannot set them.
const toHast = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(emptyTaskItems)
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "" })
  .use(rehypeRaw)
  .use(rehypeSanitize)
  .use(wrapDisplayMath);

const toHtml = unified()
  .use(linkFootnotes)
  .use(rehypeSlug)
  .use(rehypeKatex)
  .use(trimTaskSpace)
  .use(markLossyBlocks)
  .use(lockRichContent)
  .use(rehypeHighlight)
  .use(rehypeStringify);

export function render(markdown: string): { html: string; blocks: BlockRange[] } {
  const mdast = toHast.parse(markdown);
  const planned = planBlocks(mdast);
  const tree = toHtml.runSync(markBlocks(toHast.runSync(mdast, markdown), planned), markdown);
  markTaskBoxes(tree, mdast, markdown);
  const blocks = tree.children.filter(isBlock).map((node) => ({
    start: Number(node.properties.dataStart),
    end: Number(node.properties.dataEnd),
  }));
  return { html: toHtml.stringify(tree), blocks };
}

function isBlock(node: RootContent): node is Element {
  return node.type === "element" && node.properties.dataStart !== undefined;
}

/**
 * The source range of each top-level block, and whether it is rich because it has no rich-text form: code, math and raw HTML.
 * A raw HTML block that opens a tag takes the blocks up to its closing tag, because the browser nests them in it.
 */
function planBlocks(tree: MdastRoot): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  let openTags = 0;
  for (const node of tree.children) {
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    if (openTags > 0) blocks.at(-1)!.end = end;
    else blocks.push({ start, end, rich: node.type === "code" || node.type === "math" || node.type === "html" });
    if (node.type === "html") openTags = Math.max(0, openTags + tagBalance(node.value));
  }
  return blocks;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * Open tags minus close tags. It does not know tags with an optional end tag (`<p>`, `<li>`),
 * a `>` in an attribute value, or HTML inside a paragraph; a tag that is never closed takes the rest of the text.
 */
function tagBalance(html: string): number {
  let balance = 0;
  const tags = html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(\/?)([a-z][\w-]*)[^>]*?(\/?)>/gi);
  for (const [, close, name, selfClosing] of tags) {
    if (!VOID_TAGS.has(name.toLowerCase()) && !selfClosing) balance += close ? -1 : 1;
  }
  return balance;
}

/**
 * Gives each planned block that renders to something its range on one top-level element.
 * The hast nodes keep the source position of their block through rehype-raw and sanitize.
 */
function markBlocks(tree: Root, planned: PlannedBlock[]): Root {
  const children: RootContent[] = [];
  let group: RootContent[] = [];
  let block: PlannedBlock | undefined;
  const flush = () => {
    if (block) children.push(markBlock(block, group));
    group = [];
  };
  for (const node of tree.children) {
    const offset = node.position?.start.offset;
    const owner = offset === undefined ? undefined : planned.find((b) => b.start <= offset && offset < b.end);
    if (owner !== block) {
      flush();
      block = owner;
    }
    if (owner) group.push(node);
    else children.push(node);
  }
  flush();
  return { ...tree, children };
}

function markBlock({ start, end, rich }: PlannedBlock, nodes: RootContent[]): Element {
  const properties = { dataStart: start, dataEnd: end, ...(rich && { dataRich: true }) };
  const [node] = nodes;
  // Sanitize drops doctypes and comments, so only elements and text are left.
  if (nodes.length > 1 || node.type !== "element") return element(properties, nodes as ElementContent[]);
  const code = node.tagName === "pre" ? node.children.find((child) => child.type === "element") : undefined;
  if (code && hasClass(code, "language-mermaid")) {
    return element({ ...properties, className: ["diagram"] }, [{ ...node, children: code.children }]);
  }
  return { ...node, properties: { ...node.properties, ...properties } };
}

function element(properties: Element["properties"], children: ElementContent[]): Element {
  return { type: "element", tagName: "div", properties, children };
}

/**
 * KaTeX replaces the `pre` of display math. The wrapper keeps the block markers,
 * and tells toMarkdown that TeX which KaTeX cannot parse is display math.
 */
function wrapDisplayMath(): Transformer<Root> {
  return (tree: Root) => {
    visit(tree, "element", (node, index, parent) => {
      const code = node.tagName === "pre" ? node.children.find((child) => child.type === "element") : undefined;
      if (!code || !hasClass(code, "language-math") || !parent || index === undefined) return;
      parent.children[index] = { ...element({ className: ["display-math"] }, [node]), position: node.position };
      return SKIP;
    });
  };
}

/**
 * remark-rehype runs without a clobber prefix, so sanitize adds `user-content-` to the
 * footnote ids exactly once. Sanitize leaves hrefs alone, so the links get the prefix here.
 */
function linkFootnotes(): Transformer<Root> {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      const { href, dataFootnoteRef, dataFootnoteBackref } = node.properties;
      if (typeof href === "string" && (dataFootnoteRef !== undefined || dataFootnoteBackref !== undefined)) {
        node.properties.href = "#user-content-" + href.slice(1);
      }
    });
  };
}

const roundTrips = new Map<string, boolean>();

/**
 * A block is rich unless toMarkdown gives its source back, so that an edit in it changes only the typed text.
 * The result is kept by the HTML and the source of the block: render runs on each keystroke, and the HTML of a block
 * can change with text elsewhere, as a footnote reference without its definition renders as text.
 */
function markLossyBlocks(): Transformer<Root> {
  return (tree, file) => {
    if (roundTrips.size > 5000) roundTrips.clear();
    for (const node of tree.children) {
      if (!isBlock(node) || node.properties.dataRich !== undefined) continue;
      const { dataStart, dataEnd, ...properties } = node.properties;
      const source = String(file.value).slice(Number(dataStart), Number(dataEnd));
      // Without its range, the HTML of a block stays the same when an edit above it moves it.
      const html = toHtml.stringify({ type: "root", children: [{ ...node, properties }] });
      const key = html + "\0" + source;
      // A space at the end of a block is no content, as the space after `- [ ] ` that the task tool types: toMarkdown drops it.
      if (!roundTrips.has(key)) roundTrips.set(key, toMarkdown(html, source) === source.trimEnd());
      if (!roundTrips.get(key)) node.properties.dataRich = true;
    }
  };
}

/** Rich blocks, math and the footnotes section are not editable as rich text. */
function lockRichContent(): Transformer<Root> {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      const { dataRich, dataFootnotes } = node.properties;
      if (dataRich === undefined && dataFootnotes === undefined && !hasClass(node, "katex")) return;
      node.properties.contentEditable = "false";
      return SKIP;
    });
  };
}

/** The checkbox of a task item stands in the list gutter (globals.css); a space after it would indent the first line. */
function trimTaskSpace(): Transformer<Root> {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      const [box, text] = node.children;
      if (box?.type === "element" && box.tagName === "input" && text?.type === "text") text.value = text.value.replace(/^ /, "");
    });
  };
}

/**
 * GFM shows a list item of only `[ ]` as that text. Here it is an empty task item, as the task tool makes it on an
 * empty line, so the text typed after its checkbox makes a task. An escaped `\[ ]` stays text.
 */
function emptyTaskItems(): Transformer<MdastRoot> {
  return (tree, file) => {
    visit(tree, "listItem", (item) => {
      const [paragraph] = item.children;
      if (item.checked != null || item.children.length !== 1 || paragraph.type !== "paragraph") return;
      const box = String(file.value).slice(paragraph.position!.start.offset, paragraph.position!.end.offset).match(/^\[([ xX])\]\s*$/);
      if (!box) return;
      item.checked = box[1] !== " ";
      item.children = [];
    });
  };
}

/**
 * Gives the checkbox of each task item the source offset of its `[`, where a click toggles the task.
 * The item finds its checkbox by its source position, which raw HTML cannot fake: a raw `<li>` starts at a `<`, a list item at its marker.
 * The `[` is the first one after the marker, because only white space and quote markers stand between them.
 */
function markTaskBoxes(tree: Root, mdast: MdastRoot, source: string) {
  const boxes = new Map<number, number>();
  visit(mdast, "listItem", (item) => {
    const start = item.position!.start.offset!;
    if (item.checked != null) boxes.set(start, source.indexOf("[", start));
  });
  visit(tree, "element", (node) => {
    const offset = node.tagName === "li" ? boxes.get(node.position?.start.offset ?? -1) : undefined;
    if (offset === undefined) return;
    // The checkbox is the first element of the item, or of its first paragraph.
    visit(node, "element", (box) => {
      if (box.tagName !== "input") return;
      box.properties.dataTask = offset;
      return EXIT;
    });
  });
}
