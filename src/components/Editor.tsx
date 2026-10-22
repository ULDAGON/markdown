"use client";
import { useEffect, useRef, useState } from "react";
import { continueList, headingLevel, sourceEdit, type ToolId } from "@/lib/source-edits";
import { SAMPLE } from "@/lib/sample";
import { applyEdit } from "./applyEdit";
import Preview from "./Preview";
import StatusBar from "./StatusBar";
import Toolbar, { KEYMAP } from "./Toolbar";
import { useMod } from "./useMod";
import { useScrollSync } from "./useScrollSync";

const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} },
};
const normalise = (text: string) => text.replace(/\r\n/g, "\n");

export default function Editor() {
  const [text, setText] = useState("");
  const [name, setName] = useState("untitled.md");
  const [caret, setCaret] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const source = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLElement>(null);
  const noteTimer = useRef(0);
  const mod = useMod();

  useScrollSync(source, preview);

  // localStorage exists only in the browser, so the saved text loads after the first render.
  useEffect(() => {
    setText(normalise(store.get("md.text") ?? SAMPLE));
    setName(store.get("md.name") ?? "untitled.md");
  }, []);

  function say(message: string) {
    setNote(message);
    clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 4000);
  }

  function change(next: string) {
    setText(next);
    store.set("md.text", next);
  }

  function rename(next: string) {
    setName(next);
    store.set("md.name", next);
  }

  // ------------------------------------------------------------------ source
  function run(id: ToolId, arg?: number) {
    const el = source.current!;
    applyEdit(el, sourceEdit(id, el.value, el.selectionStart, el.selectionEnd, arg));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.metaKey || e.ctrlKey) {
      const id = e.altKey ? undefined : KEYMAP[e.key.toLowerCase()];
      if (!id) return;
      e.preventDefault();
      run(id);
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && el.selectionStart === el.selectionEnd) {
      const edit = continueList(el.value, el.selectionStart);
      if (!edit) return;
      e.preventDefault();
      applyEdit(el, edit);
    }
  }

  // ------------------------------------------------------------------ file
  function fileName() {
    const raw = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "untitled.md";
    return /\.[a-z0-9]+$/i.test(raw) ? raw : `${raw}.md`;
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: fileName() }).click();
    URL.revokeObjectURL(url);
    say(`saved ${fileName()}.`);
  }

  // Replace the whole text through the textarea, so ⌘z brings the old text back.
  function replaceAll(next: string) {
    applyEdit(source.current!, { start: 0, end: source.current!.value.length, text: next, select: [0, 0] });
  }

  async function open(file: File) {
    replaceAll(normalise(await file.text()));
    rename(file.name);
    say(`opened ${file.name}. ${mod}z in the source to undo.`);
  }

  // ⌘s downloads from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      download();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const hasFile = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <>
      <div className="actions">
        <div className="row">
          <button className="btn" onClick={() => { replaceAll(""); say(`cleared. ${mod}z in the source to undo.`); }}>clear</button>
        </div>
        <div className="row">
          <input
            className="field"
            value={name}
            onChange={(e) => rename(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label="file name"
            placeholder="untitled.md"
          />
          <button className="btn primary" onClick={download}>download</button>
        </div>
      </div>

      <main
        className="panes"
        data-drop={dropping || undefined}
        onDragOver={(e) => { if (hasFile(e)) { e.preventDefault(); setDropping(true); } }}
        // Moving over a child element also fires dragleave; only leaving the panes ends the drop.
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
        onDrop={(e) => {
          if (!hasFile(e)) return;
          e.preventDefault();
          setDropping(false);
          open(e.dataTransfer.files[0]);
        }}
      >
        <section className="card" aria-label="markdown">
          <Toolbar label="markdown" onRun={run} heading={headingLevel(text, caret)} />
          <textarea
            className="source"
            ref={source}
            value={text}
            onChange={(e) => { change(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            placeholder="type markdown."
          />
        </section>
        <Preview markdown={text} onChange={change} ref={preview} />
      </main>

      <StatusBar text={text} note={note} />
    </>
  );
}
