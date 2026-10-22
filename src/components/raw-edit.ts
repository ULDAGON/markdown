/**
 * Replace a rich block in place with a textarea of its markdown, which grows with its content.
 * Blur or ⌘enter calls done with the text, esc calls it with null. done is called once.
 */
export function editRaw(block: HTMLElement, markdown: string, done: (markdown: string | null) => void) {
  const area = Object.assign(document.createElement("textarea"), { className: "raw", value: markdown, spellcheck: false });
  // The textarea keeps the source range of the block, so a sync while it is open keeps the block.
  Object.assign(area.dataset, { start: block.dataset.start, end: block.dataset.end });
  const grow = () => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  let finished = false;
  // done renders the preview again; the removal of the focused textarea blurs it a second time.
  const finish = (text: string | null) => {
    if (finished) return;
    finished = true;
    done(text);
  };
  area.addEventListener("input", grow);
  area.addEventListener("blur", () => finish(area.value));
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") finish(null);
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(area.value);
    }
  });
  block.replaceWith(area);
  grow();
  area.focus();
}
