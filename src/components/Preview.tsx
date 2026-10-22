"use client";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { reconcile, type Child } from "@/lib/markdown/reconcile";
import { render, type BlockRange } from "@/lib/markdown/render";
import { toMarkdown } from "@/lib/markdown/to-markdown";
import { selectionAfter, sourceEdit, type ToolId } from "@/lib/source-edits";
import { besideLocked, closest, enter, isCommand, previewEdit, toolState } from "./preview-commands";
import { rangeOf, selectSource, toSource, topLevel } from "./preview-selection";
import { editRaw } from "./raw-edit";
import Toolbar, { ask, KEYMAP } from "./Toolbar";
import { useMermaid } from "./useMermaid";

// A list item marker with a task box, after the indent and the quote markers of its line.
const TASK_MARKER = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/gm;

type Props = { markdown: string; onChange: (markdown: string) => void; ref?: React.Ref<HTMLElement> };

/**
 * The rendered card. The article holds its own DOM, not React: an edit there changes only its block in the source.
 * The source of each block is in its data-start and data-end; edited blocks are marked until the next sync.
 */
export default function Preview({ markdown, onChange, ref }: Props) {
  const card = useRef<HTMLElement>(null);
  const article = useRef<HTMLElement>(null);
  const live = useRef({
    source: null as string | null, // the text that the article shows
    rendered: [] as BlockRange[], // the ranges that the blocks of the article had at the last sync
    changed: new Set<Element>(),
    edited: false, // the article differs from a fresh render of source
    saved: null as Range | null, // the last selection in the article, for the toolbar controls that take the focus
    timer: 0,
    observer: null as MutationObserver | null,
  }).current;
  const [tools, setTools] = useState<ReturnType<typeof toolState>>({ heading: 0, pressed: {} });
  const drawDiagrams = useMermaid(article);

  useImperativeHandle(ref, () => article.current!, []);

  function show(text: string) {
    const el = article.current!;
    const { html, blocks } = render(text);
    el.innerHTML = html;
    // A checkbox is disabled in the rendered HTML; in the preview a click toggles it. Only the task items of
    // a block with a source range can: a checkbox in raw HTML or in the footnotes would turn that into markdown.
    el.querySelectorAll(":scope > [data-start]:not([data-rich]) :is(li.task-list-item, li.task-list-item > p) > input[type=checkbox]").forEach((box) => box.removeAttribute("disabled"));
    // The caret cannot go into an empty block, as the heading that a tool makes on an empty line; a <br> gives it a line.
    el.querySelectorAll(":scope > :is(h1, h2, h3, h4, h5, h6, blockquote), li").forEach((block) => {
      const empty = !block.textContent!.trim() && [...block.children].every((child) => child instanceof HTMLInputElement);
      if (empty) block.append(document.createElement("br"));
    });
    live.observer!.takeRecords();
    Object.assign(live, { source: text, rendered: blocks, changed: new Set(), edited: false, saved: null });
    clearTimeout(live.timer);
    drawDiagrams();
  }

  // The footnotes section and the rich blocks are not editable here. The footnotes have no range, so a
  // change in them would make sync turn the generated section into a new block of the source.
  const editable = (block: HTMLElement | null): block is HTMLElement => !!block && block.getAttribute("contenteditable") !== "false";

  function mark(records: MutationRecord[]) {
    for (const { target, addedNodes } of records) {
      for (const node of target === article.current ? addedNodes : [target]) {
        const block = topLevel(article.current!, node);
        if (editable(block)) live.changed.add(block);
      }
    }
  }

  function sync() {
    clearTimeout(live.timer);
    mark(live.observer!.takeRecords());
    const source = live.source!;
    const synced: HTMLElement[] = [];
    const children: Child[] = [];
    const empty = new Set<Element>();
    for (const el of article.current!.children as HTMLCollectionOf<HTMLElement>) {
      const range = rangeOf(el);
      // An element without a range that nobody edited is generated, like the footnotes section.
      if (!live.changed.has(el)) {
        if (range) {
          synced.push(el);
          children.push({ range });
        }
        continue;
      }
      const markdown = el instanceof HTMLTextAreaElement ? el.value : toMarkdown(el.outerHTML, range ? source.slice(range.start, range.end) : "");
      // An empty block, like the paragraph after Enter at the end of one, has no markdown until it gets text.
      // outdent leaves a bare <br> at the top level, which would become a hard break of its own.
      if (!markdown || el instanceof HTMLBRElement) {
        empty.add(el);
        // Enter copies the range of a block to the block that it splits off; an empty block has no source.
        delete el.dataset.start;
        delete el.dataset.end;
        continue;
      }
      synced.push(el);
      children.push({ markdown });
    }
    const { text, ranges } = reconcile(source, live.rendered, children);
    synced.forEach((el, i) => {
      el.dataset.start = String(ranges[i].start);
      el.dataset.end = String(ranges[i].end);
    });
    Object.assign(live, { source: text, rendered: ranges, changed: empty });
    if (text !== source) onChange(text);
  }

  useEffect(() => {
    const el = article.current!;
    live.observer = new MutationObserver(mark);
    live.observer.observe(el, { childList: true, characterData: true, subtree: true });
    const onSelection = () => {
      const selection = getSelection()!;
      if (selection.rangeCount && el.contains(selection.anchorNode)) {
        live.saved = selection.getRangeAt(0).cloneRange();
        setTools(toolState());
      } else if (!card.current!.contains(selection.anchorNode)) {
        live.saved = null; // the caret is in the markdown card now; the toolbar field of this card keeps it
      }
    };
    document.addEventListener("selectionchange", onSelection);
    return () => {
      live.observer!.disconnect();
      document.removeEventListener("selectionchange", onSelection);
      clearTimeout(live.timer);
    };
  }, []);

  // Leave the DOM alone when the markdown is the text that the article already shows: the caret stays.
  useEffect(() => {
    if (markdown !== live.source) show(markdown);
  });

  function edited() {
    live.edited = true;
    clearTimeout(live.timer);
    live.timer = window.setTimeout(sync, 120);
  }

  // A toolbar control can hold the focus; put it and the selection back into the article.
  // False when there is no selection in the preview to act on.
  function restore() {
    const el = article.current!;
    if (document.activeElement === el) return true;
    if (!live.saved) return false; // the focus stays where it is, as in the markdown card
    el.focus(); // blurs an open raw textarea, which renders again and drops the saved selection
    if (!live.saved) return false;
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(live.saved);
    return true;
  }

  // Text right in the article, outside any block, becomes a paragraph; so does the block that is left when all
  // text is deleted. execCommand does nothing while another one runs, so in the input event of a tool it fails,
  // and run calls it again after the tool.
  function wrapLooseText() {
    const el = article.current!;
    const node = getSelection()?.anchorNode;
    if (node?.parentNode === el && (node instanceof Text || !el.textContent!.trim())) document.execCommand("formatBlock", false, "p");
  }

  async function run(id: ToolId, arg?: number) {
    if (!isCommand(id)) {
      if (restore()) editSource(id, arg);
      return;
    }
    if (id === "link") {
      const url = await ask(card.current!.querySelector(".toolbar")!, { placeholder: "https://", value: closest("a")?.getAttribute("href") ?? "" });
      if (restore() && url) previewEdit("link", url);
    } else if (restore()) {
      previewEdit(id);
    }
    wrapLooseText();
  }

  // The tool makes the edit of the markdown card on the same source text, so both cards give the same markdown.
  function editSource(id: ToolId, arg?: number) {
    sync();
    const el = article.current!;
    const source = live.source!;
    // Inline code wraps the text itself; a block tool takes the syntax at the edges of a block with it.
    const { text, start, end } = toSource(el, source, getSelection()!.getRangeAt(0), id !== "code");
    const edit = sourceEdit(id, text, start, end, arg);
    const next = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    show(next);
    if (next !== source) onChange(next);
    selectSource(el, next, ...selectionAfter(id, text, edit, start, end));
  }

  function editBlock(rich: HTMLElement) {
    article.current!.querySelector("textarea")?.blur(); // commits an open raw edit
    sync();
    const range = rangeOf(rich);
    // The commit of a raw edit renders the article again: the clicked block is a new element by then, at the range
    // that sync gave the old one.
    const block = range && article.current!.querySelector<HTMLElement>(`:scope > [data-start="${range.start}"]`);
    if (!block) return;
    const area = editRaw(block, live.source!.slice(range.start, range.end), (keep) => {
      if (keep) live.changed.add(area);
      commit();
    });
    live.observer!.takeRecords();
  }

  async function editMath(math: Element) {
    if (!editable(topLevel(article.current!, math))) return;
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')!;
    const next = await ask(card.current!.querySelector(".toolbar")!, { placeholder: "tex", value: tex.textContent! });
    if (next === null || next === tex.textContent) return;
    tex.textContent = next;
    commit();
  }

  // Write the edits to the source and render the article again from it.
  function commit() {
    sync();
    show(live.source!);
  }

  // Leaving the card renders it again. A closing toolbar field blurs with no new focus, and run then
  // focuses the article again; so look where the focus is once it has moved.
  function onBlur() {
    setTimeout(() => {
      if (live.edited && !card.current!.contains(document.activeElement)) commit();
    });
  }

  function onInput(e: React.FormEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return; // typing in the raw textarea of a block
    wrapLooseText();
    edited();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return; // keys in the raw textarea of a block
    const mod = e.metaKey || e.ctrlKey;
    const id = mod && !e.altKey ? KEYMAP[e.key.toLowerCase()] : undefined;
    const selection = getSelection()!;
    if (id) {
      e.preventDefault();
      run(id);
    } else if (mod || e.altKey || !selection.isCollapsed) {
      return;
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (enter()) e.preventDefault();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      const block = topLevel(article.current!, selection.anchorNode!);
      if (block && besideLocked(block, e.key === "Backspace")) e.preventDefault();
    }
  }

  // A native click on a checkbox in an editable region does not toggle it. The click toggles the task marker in
  // the source instead of the box in the article: toMarkdown would drop the box of an empty item. The k-th box of
  // a block stands for its k-th task marker, and the toggle keeps the length of the source, so the ranges stay.
  function onMouseDown(e: React.MouseEvent<HTMLElement>) {
    const box = e.target as Element;
    // A press on a rich block leaves an open raw edit to the click, which commits it before it opens the block.
    if (box.closest("[data-rich]")) return e.preventDefault();
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    const block = topLevel(article.current!, box);
    if (!editable(block)) return;
    e.preventDefault();
    sync();
    const source = live.source!;
    const { start, end } = rangeOf(block)!;
    const nth = [...block.querySelectorAll("input[type=checkbox]")].indexOf(box);
    const marker = [...source.slice(start, end).matchAll(TASK_MARKER)][nth];
    const at = start + marker.index + marker[0].length - 2;
    box.toggleAttribute("checked");
    live.source = source.slice(0, at) + (marker[1] === " " ? "x" : " ") + source.slice(at + 1);
    onChange(live.source);
  }

  function onClick(e: React.MouseEvent<HTMLElement>) {
    const target = e.target as Element;
    if (target instanceof HTMLInputElement) return e.preventDefault(); // the checkbox toggles on mousedown
    const rich = target.closest<HTMLElement>("[data-rich]");
    if (rich) return editBlock(rich);
    const math = target.closest(".katex");
    if (math) editMath(math);
  }

  return (
    <section className="card" aria-label="preview" ref={card} onBlur={onBlur}>
      <Toolbar label="preview" onRun={run} heading={tools.heading} pressed={tools.pressed} />
      <article
        className="prose"
        ref={article}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onClick={onClick}
      />
    </section>
  );
}
