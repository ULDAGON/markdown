import type { Element, ElementContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultHandlers, toMdast, type Handle, type State } from "hast-util-to-mdast";
import type { ListItem, Parent, Root } from "mdast";
import remarkGfm, { type Options as GfmOptions } from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify, { type Options } from "remark-stringify";
import { unified } from "unified";
import { EXIT, visit } from "unist-util-visit";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const handlers: Record<string, Handle> = {
  ul: nestStrayLists,
  ol: nestStrayLists,
  li(state, node) {
    const item = defaultHandlers.li(state, node);
    // hast-util-to-mdast takes an item with a nested list of two items for a loose item. Only a loose item has a `p`.
    item.spread = node.children.some((child) => child.type === "element" && child.tagName === "p");
    return item;
  },
  sup(state, node) {
    const label = footnoteLabel(node);
    return label ? { type: "footnoteReference", identifier: label, label } : state.all(node);
  },
  span(state, node, parent) {
    if (hasClass(node, "katex-display")) return { type: "math", value: texOf(node) };
    if (hasClass(node, "katex")) return { type: "inlineMath", value: texOf(node) };
    // KaTeX shows TeX that it cannot parse as plain text.
    if (hasClass(node, "katex-error")) {
      const display = parent?.type === "element" && hasClass(parent, "display-math");
      return { type: display ? "math" : "inlineMath", value: textOf(node) };
    }
    return state.all(node);
  },
};

type Style = Options & GfmOptions;

export function hasClass(node: Element, name: string): boolean {
  const { className } = node.properties;
  return Array.isArray(className) && className.includes(name);
}

export function toMarkdown(html: string, original: string): string {
  const mdast = toMdast(fromHtml(html, { fragment: true }), { handlers, newlines: true }) as Root;
  // Chrome types U+00A0 for a space that would collapse. A no-break space of the source makes its block rich (render.ts).
  // The preview holds a caret in a new, empty code span on a U+200B (markAtCaret), which is no text either.
  visit(mdast, (node) => {
    if ("value" in node) node.value = node.value.replaceAll("\u00a0", " ").replaceAll("\u200b", "");
  });
  // A mark that got no text, as an empty code span that the caret left, would write its bare markers.
  visit(mdast, ["inlineCode", "strong", "emphasis", "delete"] as const, (node, index, parent) => {
    if (node.type === "inlineCode" ? node.value : node.children.length) return;
    parent!.children.splice(index!, 1);
    return index;
  });
  visit(mdast, ["paragraph", "heading", "tableCell"] as const, trimBlock);
  visit(mdast, "listItem", keepEmptyTaskBox);
  const parsed = parser.parse(original);
  const style = styleOf(parsed, original);
  return mdast.children[0]?.type === "table" ? keepTableRows(mdast, parsed, original, style) : stringify(mdast, style);
}

function stringify(mdast: Root, style: Style): string {
  return unified()
    .use(remarkGfm, style)
    .use(remarkMath)
    .use(remarkStringify, { ...style, handlers: { text } })
    .stringify(mdast)
    .trimEnd();
}

/**
 * The default text handler with one change. `safe` decides on the first character after a text, which for a footnote
 * reference is the `[` of `[^1]`: it would escape a `!` before it as the start of an image. GFM reads `![^1]` as a
 * `!` and a footnote reference, so `safe` gets the `^` instead.
 */
const text: NonNullable<Options["handlers"]>["text"] = (node, parent, state, info) => {
  const siblings = parent?.children ?? [];
  const index = siblings.indexOf(node);
  const afterNode = siblings[index + 1];
  const after = afterNode?.type === "footnoteReference" ? "^" : info.after;
  return state.safe(node.value, { ...info, after, afterNode, beforeNode: siblings[index - 1] });
};

/**
 * An edit in a table writes only the rows whose cells changed; all other lines of `original` stay byte for byte.
 * The rows are compared without padding, because the padding of a row depends on the other rows.
 * A changed row is padded when the original lines are, which then all have one length.
 */
function keepTableRows(table: Root, parsed: Root, original: string, style: Style): string {
  const lines = original.split("\n");
  const compact = { ...style, tablePipeAlign: false };
  const before = stringify(parsed, compact).split("\n");
  const after = stringify(table, compact).split("\n");
  const written = new Set(lines.map((line) => line.length)).size === 1 ? stringify(table, style).split("\n") : after;
  return written.map((line, i) => (after[i] === before[i] ? lines[i] : line)).join("\n");
}

/** Chrome's outdent of a nested item leaves a list directly in a list: it is the nested list of the item before it. */
function nestStrayLists(state: State, node: Element) {
  const children: ElementContent[] = [];
  let item = -1;
  for (const child of node.children) {
    const list = child.type === "element" && (child.tagName === "ul" || child.tagName === "ol");
    if (list && item >= 0) {
      const parent = children[item] as Element;
      children[item] = { ...parent, children: [...parent.children, child] };
      continue;
    }
    if (child.type === "element" && child.tagName === "li") item = children.length;
    children.push(child);
  }
  return defaultHandlers[node.tagName as "ul" | "ol"](state, { ...node, children });
}

/** `<sup><a href="#user-content-fn-label" data-footnote-ref>` gives `label`. */
function footnoteLabel(sup: Element): string | undefined {
  const link = sup.children.find((child) => child.type === "element" && child.properties.dataFootnoteRef !== undefined);
  const href = link?.type === "element" ? link.properties.href : undefined;
  if (typeof href !== "string" || !href.startsWith("#user-content-fn-")) return undefined;
  return decodeURIComponent(href.slice("#user-content-fn-".length));
}

function texOf(katex: Element): string {
  let tex = "";
  visit(katex, "element", (node) => {
    if (node.tagName !== "annotation" || node.properties.encoding !== "application/x-tex") return;
    tex = textOf(node);
    return EXIT;
  });
  return tex;
}

function textOf(node: Element): string {
  let text = "";
  visit(node, "text", (child) => {
    text += child.value;
  });
  return text;
}

/**
 * Markdown cannot hold a space at the start or the end of a block, where Chrome types one so that it does not collapse.
 * A `<br>` that the editor leaves at the end of a block would print as a stray `\`.
 */
function trimBlock(block: Parent) {
  let first = block.children[0];
  while (first && "children" in first) first = first.children[0];
  if (first?.type === "text") first.value = first.value.trimStart();
  let parent = block;
  while (true) {
    const last = parent.children.at(-1);
    if (last?.type === "break") parent.children.pop();
    else if (last && "children" in last) parent = last;
    else {
      if (last?.type === "text") last.value = last.value.trimEnd();
      return;
    }
  }
}

/**
 * GFM writes the box of a task item in front of its text, so an empty task item would lose it.
 * Its box is written as raw text: render.ts reads a list item of only `[ ]` as an empty task item.
 */
function keepEmptyTaskBox(item: ListItem) {
  const empty = item.children.every((child) => child.type === "paragraph" && child.children.every((node) => node.type === "text" && !node.value));
  if (item.checked == null || !empty) return;
  item.children = [{ type: "paragraph", children: [{ type: "html", value: item.checked ? "[x]" : "[ ]" }] }];
  item.checked = null;
}

/** Takes the markers that `original` uses, so an edit keeps the style of the source. */
function styleOf(parsed: Root, original: string): Style {
  const style: Style = { bullet: "-", emphasis: "*", strong: "*", fence: "`", rule: "-", listItemIndent: "one" };
  visit(parsed, (node) => {
    // A GFM autolink literal (`https://…` in text) makes nodes without a place in the source.
    const start = node.position?.start.offset;
    if (start === undefined) return;
    const mark = original[start];
    if (node.type === "emphasis") style.emphasis = mark as "*" | "_";
    if (node.type === "strong") style.strong = mark as "*" | "_";
    if (node.type === "thematicBreak") style.rule = mark as "*" | "-" | "_";
    if (node.type === "heading" && mark !== "#") style.setext = true;
    if (node.type === "code" && (mark === "`" || mark === "~")) style.fence = mark;
    if (node.type === "list" && !node.ordered) style.bullet = mark as "*" | "+" | "-";
    if (node.type === "list" && node.ordered) {
      style.bulletOrdered = original.slice(start).match(/^\d+([.)])/)?.[1] as "." | ")";
      const [first, second] = node.children.map((item) => parseInt(original.slice(item.position!.start.offset!)));
      if (second !== undefined) style.incrementListMarker = second !== first;
    }
    if (node.type === "listItem") style.listItemIndent = /^\S+ {2}/.test(original.slice(start)) ? "tab" : "one";
  });
  return style;
}
