import type { Element } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultHandlers, toMdast, type Handle } from "hast-util-to-mdast";
import type { Parent, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify, { type Options } from "remark-stringify";
import { unified } from "unified";
import { EXIT, visit } from "unist-util-visit";
import { hasClass } from "./render.ts";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const handlers: Record<string, Handle> = {
  a: (state, node) => (hasClass(node, "anchor") ? undefined : defaultHandlers.a(state, node)),
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

export function toMarkdown(html: string, original: string): string {
  const mdast = toMdast(fromHtml(html, { fragment: true }), { handlers, newlines: true }) as Root;
  visit(mdast, ["paragraph", "heading", "tableCell"] as const, trimBlockEnd);
  return unified()
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkStringify, styleOf(original))
    .stringify(mdast)
    .trimEnd();
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
 * A `<br>` that the editor leaves at the end of a block would print as a stray `\`.
 * Chrome types U+00A0 for a space at the end of a text, where a space would collapse;
 * markdown cannot hold a space at the end of a block, so it goes. A U+00A0 elsewhere stays.
 */
function trimBlockEnd(block: Parent) {
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

/** Takes the markers that `original` uses, so an edit keeps the style of the source. */
function styleOf(original: string): Options {
  const style: Options = { bullet: "-", emphasis: "*", strong: "*", fence: "`", rule: "-", listItemIndent: "one" };
  visit(parser.parse(original), (node) => {
    const start = node.position!.start.offset!;
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
