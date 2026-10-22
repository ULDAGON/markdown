import type { BlockRange } from "@/lib/markdown/render";

/*
 * The selection of the preview as a selection of its markdown source, and back. Each top-level block knows its
 * source range (data-start, data-end). Inside a block, each rendered character is found in the source of the
 * block, in order, so the markdown syntax between the characters is skipped. That is exact for text; a syntax
 * character that equals the next character of the text can be taken first, as the space in `[a](b "c d") x`.
 */

type Spot = { node: Text; offset: number; at: number };
type Side = "start" | "end";

export const rangeOf = (el: Element): BlockRange | undefined =>
  el instanceof HTMLElement && el.dataset.start !== undefined ? { start: Number(el.dataset.start), end: Number(el.dataset.end) } : undefined;

const rangedBlocks = (article: HTMLElement) => [...article.children].filter((el) => rangeOf(el));

export function topLevel(article: HTMLElement, node: Node): HTMLElement | null {
  while (node.parentNode && node.parentNode !== article) node = node.parentNode;
  return node.parentNode && node instanceof HTMLElement ? node : null;
}

function spotsOf(block: Element, source: string): Spot[] {
  const range = rangeOf(block)!;
  const spots: Spot[] = [];
  let at = range.start;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // Whitespace between elements, as between list items, is not in the source; text that the reader cannot
    // edit, as KaTeX or a heading anchor, is not in it either.
    if (!node.data.trim() || !node.parentElement!.isContentEditable) continue;
    for (let offset = 0; offset < node.data.length; offset++) {
      const found = source.indexOf(node.data[offset], at);
      if (found === -1 || found >= range.end) continue;
      spots.push({ node, offset, at: found });
      at = found + 1;
    }
  }
  return spots;
}

/**
 * The source offset of a point. The start side takes the character after the point, the end side the one before.
 * With blockEdges, the edges of the text of a block take the edges of the source of the block, with their syntax.
 */
function offsetOf(article: HTMLElement, source: string, node: Node, offset: number, side: Side, blockEdges: boolean): number {
  const point = document.createRange();
  point.setStart(node, offset);
  const block = topLevel(article, node);
  const range = block && rangeOf(block);
  if (!range) {
    // A point outside the blocks with a source, as in a new empty block, takes the nearest edge of the blocks around it.
    const blocks = rangedBlocks(article);
    const after = blocks.findIndex((el) => point.comparePoint(el, 0) >= 0);
    if (side === "start") return after === -1 ? source.length : rangeOf(blocks[after])!.start;
    const before = blocks[(after === -1 ? blocks.length : after) - 1];
    return before ? rangeOf(before)!.end : 0;
  }
  const spots = spotsOf(block, source);
  const next = spots.findIndex((spot) => point.comparePoint(spot.node, spot.offset) >= 0);
  const [before, after] = next === -1 ? [spots.at(-1), undefined] : [spots[next - 1], spots[next]];
  if (!before) return blockEdges || !after ? range.start : after.at;
  if (!after) return blockEdges ? range.end : before.at + 1;
  return side === "start" ? after.at : before.at + 1;
}

/**
 * The selection of the article as a selection of source, which the article shows. A caret in a new empty
 * block has no source yet: it gets an empty line of its own in the returned text.
 */
export function toSource(article: HTMLElement, source: string, selection: Range, blockEdges: boolean): { text: string; start: number; end: number } {
  const { startContainer, startOffset, endContainer, endOffset } = selection;
  const offset = (node: Node, offset: number, side: Side) => offsetOf(article, source, node, offset, side, blockEdges);
  if (!selection.collapsed) {
    const start = offset(startContainer, startOffset, "start");
    return { text: source, start, end: Math.max(start, offset(endContainer, endOffset, "end")) };
  }
  const block = topLevel(article, startContainer);
  if (block && !rangeOf(block)) {
    const at = offset(startContainer, startOffset, "end");
    const caret = at ? at + 2 : 0;
    return { text: source.slice(0, at) + "\n\n" + source.slice(at), start: caret, end: caret };
  }
  // A caret after a character stays with that character: at the end of a list item, it is on the line of that item.
  const at = offset(startContainer, startOffset, startContainer instanceof Text && startOffset > 0 ? "end" : "start");
  return { text: source, start: at, end: at };
}

/** The point of a source offset in the article. A caret takes a character on its own line first. */
function pointOf(article: HTMLElement, source: string, offset: number, side: Side | "caret"): [Node, number] {
  const blocks = rangedBlocks(article);
  // An offset between two blocks belongs to the block after it.
  const block = blocks.find((el) => offset <= rangeOf(el)!.end) ?? blocks.at(-1);
  if (!block) return [article, 0];
  const spots = spotsOf(block, source);
  if (!spots.length) {
    if (!(block as HTMLElement).isContentEditable) return [article, [...article.childNodes].indexOf(block) + 1];
    // An empty block holds the caret before its <br> (Preview.show).
    const br = block.querySelector("br");
    return br ? [br.parentNode!, [...br.parentNode!.childNodes].indexOf(br)] : [block, 0];
  }
  const next = spots.find((spot) => spot.at >= offset);
  const prev = spots.findLast((spot) => spot.at < offset);
  const sameLine = !!prev && !source.slice(prev.at, offset).includes("\n");
  const takeNext = !!next && (!prev || side === "start" || (side === "caret" && (next.at === offset || !sameLine)));
  return takeNext ? [next.node, next.offset] : [prev!.node, prev!.offset + 1];
}

/** Select start..end of source in the article, which shows that source. */
export function selectSource(article: HTMLElement, source: string, start: number, end: number) {
  const range = document.createRange();
  range.setStart(...pointOf(article, source, start, start === end ? "caret" : "start"));
  if (end > start) range.setEnd(...pointOf(article, source, end, "end"));
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
}
