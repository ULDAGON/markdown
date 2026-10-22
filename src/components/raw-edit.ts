/**
 * Replace a rich block in place with a textarea of its markdown, which grows with its content.
 * Blur or ⌘enter calls done(true), esc done(false); done is called once. The textarea keeps the source range of the
 * block, so a sync while it is open keeps the block, and the sync of a commit takes its value as the markdown of the block.
 */
export function editRaw(block: HTMLElement, markdown: string, done: (commit: boolean) => void): HTMLTextAreaElement {
  const area = Object.assign(document.createElement("textarea"), { className: "raw", value: markdown, spellcheck: false });
  Object.assign(area.dataset, { start: block.dataset.start, end: block.dataset.end });
  // scrollHeight leaves out the border, which the height includes (border-box).
  const grow = () => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
  };
  let finished = false;
  // done renders the preview again; the removal of the focused textarea blurs it a second time.
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    done(commit);
  };
  area.addEventListener("input", grow);
  area.addEventListener("blur", () => finish(true));
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") finish(false);
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true);
    }
  });
  block.replaceWith(area);
  grow();
  area.focus();
  return area;
}
