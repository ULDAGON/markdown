import type { Range } from "./render.ts";

export type Child = { range?: Range; markdown?: string };

const BLANK_LINE = "\n\n";

/**
 * Splices the edited preview blocks into the source and keeps all other text byte for byte.
 * A rendered block is kept only when a clean child holds its range; all other blocks are replaced.
 */
export function reconcile(
  source: string,
  rendered: Range[],
  children: Child[],
): { text: string; ranges: Range[] } {
  let text = "";
  const ranges: Range[] = [];
  let hunkStart = 0;
  let afterKeptBlock = false;
  let edited: string[] = [];

  const writeHunk = (hunkEnd: number, beforeKeptBlock: boolean) => {
    const replaced = rendered.filter((r) => r.start >= hunkStart && r.end <= hunkEnd);
    if (replaced.length === 0 && edited.length === 0) {
      text += source.slice(hunkStart, hunkEnd);
      return;
    }
    const before = replaced.length ? source.slice(hunkStart, replaced[0].start) : "";
    const after = source.slice(replaced.length ? replaced[replaced.length - 1].end : hunkStart, hunkEnd);
    const leftovers = replaced
      .slice(1)
      .map((r, i) => source.slice(replaced[i].end, r.start).trim())
      .filter((leftover) => leftover !== "");
    // The gaps at the hunk edges stay as they are; they only get a blank line when they have
    // none, because a single newline can join the new text with its neighbour into one paragraph.
    const left = afterKeptBlock || before.trim() ? endWithBlankLine(before) : before;
    const right = beforeKeptBlock || after.trim() ? startWithBlankLine(after) : after;

    const pieces = [...edited, ...leftovers];
    if (pieces.length === 0) {
      const merged = left.trimEnd() + right;
      text += afterKeptBlock ? merged : merged.trimStart();
      return;
    }
    text += left;
    pieces.forEach((piece, i) => {
      if (i > 0) text += BLANK_LINE;
      if (i < edited.length) ranges.push({ start: text.length, end: text.length + piece.length });
      text += piece;
    });
    text += right;
  };

  for (const child of children) {
    if (child.markdown !== undefined) {
      edited.push(child.markdown);
      continue;
    }
    const kept = child.range;
    if (!kept || kept.start < hunkStart) {
      throw new Error("reconcile: each clean child needs a range, and clean children must be in source order");
    }
    writeHunk(kept.start, true);
    ranges.push({ start: text.length, end: text.length + kept.end - kept.start });
    text += source.slice(kept.start, kept.end);
    hunkStart = kept.end;
    afterKeptBlock = true;
    edited = [];
  }
  writeHunk(source.length, false);
  return { text, ranges };
}

function endWithBlankLine(gap: string): string {
  return /\n\s*\n\s*$/.test(gap) ? gap : gap.trimEnd() + BLANK_LINE;
}

function startWithBlankLine(gap: string): string {
  return /^\s*\n\s*\n/.test(gap) ? gap : BLANK_LINE + gap.trimStart();
}
