const count = new Intl.NumberFormat("en-US");
const graphemes = new Intl.Segmenter("en-US", { granularity: "grapheme" });

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`;
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`;
}

/** "1,300 characters · 1.3 kb · 7 min read" */
export function stats(text: string): string {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = [...graphemes.segment(text)].length;
  return [
    `${count.format(characters)} ${characters === 1 ? "character" : "characters"}`,
    size(new TextEncoder().encode(text).length),
    words ? `${Math.ceil(words / 200)} min read` : "— read",
  ].join(" · ");
}
