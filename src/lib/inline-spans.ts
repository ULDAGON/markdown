import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";

// The syntax of the preview (render.ts): math too, so a star in `$a*b$` is no emphasis.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** An inline node by its offsets in the source. `content` is the range of its children; code, math and images have none. */
export type Span = { type: string; start: number; end: number; content?: [number, number] };
/** The inline content of a paragraph, a heading or a table cell: from its first to its last inline node. */
export type Inline = { start: number; end: number; spans: Span[] };

// A GFM autolink literal (`https://…` in text) makes nodes without a place in the source; they are left out.
const placed = (nodes: Nodes[]) => nodes.filter((node) => node.position);
const range = (nodes: Nodes[]): [number, number] => [nodes[0].position!.start.offset!, nodes.at(-1)!.position!.end.offset!];

/** Every run of inline content in the markdown, with its spans: all inline nodes but text and line breaks. */
export function inlines(markdown: string): Inline[] {
  const found: Inline[] = [];
  visit(parser.parse(markdown), ["paragraph", "heading", "tableCell"], (block) => {
    if (!("children" in block) || !block.children.length) return SKIP;
    const spans: Span[] = [];
    visit(block, (node) => {
      if (node === block || node.type === "text" || node.type === "break" || !node.position) return;
      const { start, end } = node.position;
      const children = "children" in node ? placed(node.children) : [];
      spans.push({ type: node.type, start: start.offset!, end: end.offset!, content: children.length ? range(children) : undefined });
    });
    const children = placed(block.children);
    if (!children.length) return SKIP;
    const [start, end] = range(children);
    found.push({ start, end, spans });
    return SKIP;
  });
  return found;
}

/** The source ranges of the GFM tables in the markdown. */
export function tableRanges(markdown: string): [number, number][] {
  const found: [number, number][] = [];
  visit(parser.parse(markdown), "table", (table) => {
    found.push([table.position!.start.offset!, table.position!.end.offset!]);
    return SKIP;
  });
  return found;
}
