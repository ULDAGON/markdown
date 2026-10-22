"use client";
import { Fragment } from "react";
import type { ToolId } from "@/lib/source-edits";
import Select from "./Select";
import { useMod } from "./useMod";

type Tool = { id: ToolId; label: string; title: string; key?: string; cls?: string };

// One set of tools for both cards. Each card maps the ids to its own kind of edit.
const GROUPS: (Tool[] | "heading")[] = [
  [
    { id: "bold", label: "B", title: "bold", key: "b", cls: "b" },
    { id: "italic", label: "I", title: "italic", key: "i", cls: "i" },
    { id: "strike", label: "S", title: "strikethrough", cls: "s" },
    { id: "code", label: "<>", title: "inline code" },
  ],
  "heading",
  [
    { id: "quote", label: ">", title: "quote" },
    { id: "ul", label: "-", title: "bullet list" },
    { id: "ol", label: "1.", title: "numbered list" },
    { id: "task", label: "[ ]", title: "task list" },
  ],
  [
    { id: "link", label: "link", title: "link", key: "k" },
    { id: "codeblock", label: "```", title: "code block" },
    { id: "table", label: "table", title: "table" },
    { id: "hr", label: "---", title: "horizontal rule" },
  ],
];

/** The tools with a key, for ⌘ or ctrl and the key in either card. */
export const KEYMAP: Record<string, ToolId> = Object.fromEntries(
  GROUPS.flat().flatMap((tool) => (typeof tool === "string" || !tool.key ? [] : [[tool.key, tool.id]])),
);

const HEADINGS = ["text", "h1", "h2", "h3", "h4", "h5", "h6"].map((label, level) => ({ label, value: String(level) }));

type Props = {
  label: string;
  onRun: (id: ToolId, arg?: number) => void;
  /** Level of the heading under the caret, 0 for text. */
  heading: number;
  pressed?: Partial<Record<ToolId, boolean>>;
};

export default function Toolbar({ label, onRun, heading, pressed }: Props) {
  const mod = useMod();
  return (
    <div className="toolbar">
      {GROUPS.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep" />}
          {group === "heading" ? (
            <Select label="heading" tip="heading" options={HEADINGS} value={String(heading)} onChange={(level) => onRun("heading", Number(level))} />
          ) : (
            group.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={`tool ${tool.cls ?? ""}`}
                data-tip={tool.key ? `${tool.title} · ${mod}${tool.key}` : tool.title}
                aria-label={tool.title}
                aria-pressed={pressed?.[tool.id]}
                // Keep the caret and the selection where they are.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onRun(tool.id)}
              >
                {tool.label}
              </button>
            ))
          )}
        </Fragment>
      ))}
      <span className="label">{label}</span>
    </div>
  );
}

/** The toolbar turns into one field. Resolves to the text of the field, or null on esc. */
export function ask(toolbar: HTMLElement, { placeholder, value = "" }: { placeholder: string; value?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const form = Object.assign(document.createElement("form"), { className: "ask" });
    const input = Object.assign(document.createElement("input"), { className: "field", placeholder, value, spellcheck: false });
    form.append(input, Object.assign(document.createElement("span"), { textContent: "enter · esc" }));
    // The removal blurs the field, which calls done a second time.
    let open = true;
    const done = (text: string | null) => {
      if (!open) return;
      open = false;
      resolve(text);
      form.remove();
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); done(input.value.trim() || null); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") done(null); });
    input.addEventListener("blur", () => done(null));
    toolbar.append(form);
    input.focus();
    input.select();
  });
}
