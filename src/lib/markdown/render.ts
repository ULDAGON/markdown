import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Root as MdastRoot, RootContent as MdastContent } from "mdast";
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
  .use(lockRichContent)
  .use(trimTaskSpace)
  .use(rehypeHighlight)
  .use(rehypeStringify);

export function render(markdown: string): { html: string; blocks: BlockRange[] } {
  const mdast = toHast.parse(markdown);
  const planned = planBlocks(mdast, markdown);
  const tree = toHtml.runSync(markBlocks(toHast.runSync(mdast, markdown), planned), markdown);
  const blocks = tree.children.filter(isBlock).map((node) => ({
    start: Number(node.properties.dataStart),
    end: Number(node.properties.dataEnd),
  }));
  return { html: toHtml.stringify(tree), blocks };
}

export function hasClass(node: Element, name: string): boolean {
  const { className } = node.properties;
  return Array.isArray(className) && className.includes(name);
}

function isBlock(node: RootContent): node is Element {
  return node.type === "element" && node.properties.dataStart !== undefined;
}

/** Node types that toMarkdown drops or rewrites. */
const LOSSY = new Set(["html", "linkReference", "imageReference", "definition", "footnoteDefinition"]);
/** Text that toMarkdown rewrites: a character reference, and a no-break space, which toMarkdown takes for one that the browser typed. */
const LOSSY_TEXT = /\u00a0|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/i;

/**
 * The source range of each top-level block, and whether it is rich: edited as source text, not as rich text.
 * A block is rich when it has no rich-text form (code, math, raw HTML) or when toMarkdown cannot give its source back.
 * A raw HTML block that opens a tag takes the blocks up to its closing tag, because the browser nests them in it.
 */
function planBlocks(tree: MdastRoot, source: string): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  let openTags = 0;
  for (const node of tree.children) {
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    if (openTags > 0) blocks.at(-1)!.end = end;
    else blocks.push({ start, end, rich: isRich(node, source.slice(start, end)) });
    if (node.type === "html") openTags = Math.max(0, openTags + tagBalance(node.value));
  }
  return blocks;
}

function isRich(node: MdastContent, source: string): boolean {
  if (node.type === "code" || node.type === "math" || LOSSY_TEXT.test(source)) return true;
  let lossy = false;
  visit(node, (child) => {
    if (!LOSSY.has(child.type)) return;
    lossy = true;
    return EXIT;
  });
  return lossy;
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
  const properties = { dataStart: start, dataEnd: end, ...((rich || dropsUrl(nodes)) && { dataRich: true }) };
  const [node] = nodes;
  // Sanitize drops doctypes and comments, so only elements and text are left.
  if (nodes.length > 1 || node.type !== "element") return element(properties, nodes as ElementContent[]);
  const code = node.tagName === "pre" ? node.children.find((child) => child.type === "element") : undefined;
  if (code && hasClass(code, "language-mermaid")) {
    return element({ ...properties, className: ["diagram"] }, [{ ...node, children: code.children }]);
  }
  return { ...node, properties: { ...node.properties, ...properties } };
}

/** Sanitize removes an unsafe URL, as `javascript:`, but keeps its link or image: toMarkdown would write `[text]()`. */
function dropsUrl(nodes: RootContent[]): boolean {
  let dropped = false;
  visit({ type: "root", children: nodes }, "element", (node) => {
    const { tagName, properties } = node;
    dropped = (tagName === "a" && properties.href === undefined) || (tagName === "img" && properties.src === undefined);
    if (dropped) return EXIT;
  });
  return dropped;
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
