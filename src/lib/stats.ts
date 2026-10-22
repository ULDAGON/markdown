const count = new Intl.NumberFormat("en-US");
const graphemes = new Intl.Segmenter("en-US", { granularity: "grapheme" });

/** "1,300 characters · 7 min read" */
export function stats(text: string): string {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = [...graphemes.segment(text)].length;
  return [
    `${count.format(characters)} ${characters === 1 ? "character" : "characters"}`,
    words ? `${Math.ceil(words / 200)} min read` : "— read",
  ].join(" · ");
}
