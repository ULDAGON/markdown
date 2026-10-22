import type { Edit } from "@/lib/source-edits";

/** Apply an Edit to the textarea through the browser, so its undo stack keeps it: ⌘z undoes it like typing. */
export function applyEdit(el: HTMLTextAreaElement, { start, end, text, select }: Edit) {
  el.focus();
  el.setSelectionRange(start, end);
  const done = text ? document.execCommand("insertText", false, text) : document.execCommand("delete");
  if (!done) {
    el.setRangeText(text, start, end);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(start + select[0], start + select[1]);
}
