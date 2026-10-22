"use client";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { reconcile, type Child } from "@/lib/markdown/reconcile";
import { render, type Range as Block } from "@/lib/markdown/render";
import { toMarkdown } from "@/lib/markdown/to-markdown";
import type { ToolId } from "@/lib/source-edits";
import { previewEdit, toolState } from "./preview-commands";
import { editRaw } from "./raw-edit";
import Toolbar, { ask, KEYMAP } from "./Toolbar";
import { useMermaid } from "./useMermaid";

type Props = { markdown: string; onChange: (markdown: string) => void; ref?: React.Ref<HTMLElement> };

const rangeOf = (el: HTMLElement): Block | undefined =>
  el.dataset.start === undefined ? undefined : { start: Number(el.dataset.start), end: Number(el.dataset.end) };

/**
 * The rendered card. The article holds its own DOM, not React: an edit there changes only its block in the source.
 * The source of each block is in its data-start and data-end; edited blocks are marked until the next sync.
 */
export default function Preview({ markdown, onChange, ref }: Props) {
  const card = useRef<HTMLElement>(null);
  const article = useRef<HTMLElement>(null);
  const live = useRef({
    source: null as string | null, // the text that the article shows
    rendered: [] as Block[], // the ranges that the blocks of the article had at the last sync
    changed: new Set<Element>(),
    edited: false, // the article differs from a fresh render of source
    saved: null as Range | null, // the last selection in the article, for the toolbar controls that take the focus
    timer: 0,
  }).current;
  const observer = useRef<MutationObserver>(null);
  const [tools, setTools] = useState<ReturnType<typeof toolState>>({ heading: 0, pressed: {} });
  const drawDiagrams = useMermaid(article);

  useImperativeHandle(ref, () => article.current!, []);

  function show(text: string) {
    const el = article.current!;
    const { html, blocks } = render(text);
    el.innerHTML = html;
    // A checkbox is disabled in the rendered HTML; in the preview a click toggles it.
    el.querySelectorAll("input[type=checkbox]").forEach((box) => box.removeAttribute("disabled"));
    observer.current!.takeRecords();
    Object.assign(live, { source: text, rendered: blocks, changed: new Set(), edited: false, saved: null });
    clearTimeout(live.timer);
    drawDiagrams();
  }

  function topLevel(node: Node): HTMLElement | null {
    while (node.parentNode && node.parentNode !== article.current) node = node.parentNode;
    return node.parentNode && node instanceof HTMLElement ? node : null;
  }

  function mark(records: MutationRecord[]) {
    for (const { target, addedNodes } of records) {
      for (const node of target === article.current ? addedNodes : [target]) {
        const block = topLevel(node);
        if (block && !(node instanceof Element ? node : node.parentElement)?.closest("[data-rich]")) live.changed.add(block);
      }
    }
  }

  function sync() {
    clearTimeout(live.timer);
    mark(observer.current!.takeRecords());
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
      const markdown = toMarkdown(el.outerHTML, range ? source.slice(range.start, range.end) : "");
      // An empty block, like the paragraph after Enter at the end of one, has no markdown until it gets text.
      // outdent leaves a bare <br> at the top level, which would become a hard break of its own.
      if (!markdown || el instanceof HTMLBRElement) {
        empty.add(el);
        continue;
      }
      synced.push(el);
      children.push({ range, markdown });
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
    observer.current = new MutationObserver(mark);
    observer.current.observe(el, { childList: true, characterData: true, subtree: true });
    const onSelection = () => {
      const selection = getSelection()!;
      if (!selection.rangeCount || !el.contains(selection.anchorNode)) return;
      live.saved = selection.getRangeAt(0).cloneRange();
      setTools(toolState());
    };
    document.addEventListener("selectionchange", onSelection);
    return () => {
      observer.current!.disconnect();
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
  // False when there is no selection to act on.
  function restore() {
    const el = article.current!;
    if (document.activeElement === el) return true;
    el.focus(); // blurs an open raw textarea, which renders again and drops the saved selection
    if (!live.saved) return false;
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(live.saved);
    return true;
  }

  // Text right in the article, outside any block, becomes a paragraph. execCommand does nothing while
  // another one runs, so in the input event of a tool it fails, and run calls it again after the tool.
  function wrapLooseText() {
    if (getSelection()?.anchorNode?.parentNode === article.current) document.execCommand("formatBlock", false, "p");
  }

  async function run(id: ToolId, arg?: number) {
    if (id === "link") {
      const url = await ask(card.current!.querySelector(".toolbar")!, { placeholder: "https://" });
      if (restore() && url) previewEdit("link", url);
    } else if (restore()) {
      previewEdit(id, arg);
    }
    wrapLooseText();
  }

  function editBlock(block: HTMLElement) {
    sync();
    const { start, end } = rangeOf(block)!;
    editRaw(block, live.source!.slice(start, end), (text) => {
      const source = live.source!;
      const next = text === null ? source : source.slice(0, start) + text + source.slice(end);
      show(next);
      if (next !== source) onChange(next);
    });
    observer.current!.takeRecords();
  }

  async function editMath(math: Element) {
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')!;
    const next = await ask(card.current!.querySelector(".toolbar")!, { placeholder: "tex", value: tex.textContent! });
    if (next === null || next === tex.textContent) return;
    tex.textContent = next;
    normalise();
  }

  function normalise() {
    sync();
    show(live.source!);
  }

  // Leaving the card renders it again. A closing toolbar field blurs with no new focus, and run then
  // focuses the article again; so look where the focus is once it has moved.
  function onBlur() {
    setTimeout(() => {
      if (live.edited && !card.current!.contains(document.activeElement)) normalise();
    });
  }

  function onInput(e: React.FormEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return; // typing in the raw textarea of a block
    wrapLooseText();
    edited();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const id = (e.metaKey || e.ctrlKey) && !e.altKey ? KEYMAP[e.key.toLowerCase()] : undefined;
    if (!id) return;
    e.preventDefault();
    run(id);
  }

  // A native click on a checkbox in an editable region does not toggle it.
  function onMouseDown(e: React.MouseEvent<HTMLElement>) {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    e.preventDefault();
    box.toggleAttribute("checked");
    live.changed.add(topLevel(box)!);
    edited();
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
