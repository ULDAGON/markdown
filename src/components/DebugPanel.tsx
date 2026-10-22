"use client";
import { useEffect, useState } from "react";
import { CONTROLS, GROUPS, storedKey, type Control } from "@/lib/debug-controls";
import type { Debug } from "./useDebug";

/** The value of each control from the stylesheet alone: the inline value of the panel is taken away to read it. */
function readDefaults(): Record<string, string> {
  const root = document.documentElement;
  const defaults: Record<string, string> = {};
  for (const control of CONTROLS) {
    if (!control.key.startsWith("--")) {
      if (control.kind === "select") defaults[control.key] = control.options[0][1];
      continue;
    }
    const inline = root.style.getPropertyValue(control.key);
    root.style.removeProperty(control.key);
    defaults[control.key] = getComputedStyle(root).getPropertyValue(control.key).trim();
    if (inline) root.style.setProperty(control.key, inline);
  }
  return defaults;
}

// A colour input takes only #rrggbb: a canvas turns any CSS colour into it.
function hex(color: string): string {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = color;
  return context.fillStyle.startsWith("#") ? context.fillStyle : "#000000";
}

type Props = { debug: Debug; onClose: () => void; say: (message: string) => void };

export default function DebugPanel({ debug, onClose, say }: Props) {
  const { values, theme, set } = debug;
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  // A value can change the default of another, as the grain type does for the grain size.
  useEffect(() => setDefaults(readDefaults()), [theme, values]);
  const changed = Object.keys(values).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(debug.css());
      say(`copied ${changed} ${changed === 1 ? "value" : "values"} as css.`);
    } catch {
      say("could not copy: the browser refused the clipboard.");
    }
  }

  function row(control: Control) {
    const key = storedKey(control, theme);
    const stored = values[key];
    const value = stored ?? defaults[control.key] ?? "";
    let input: React.ReactNode;
    if (control.kind === "range") {
      const number = parseFloat(value) || 0;
      const change = (next: string) => set(key, `${next}${control.unit}`);
      input = (
        <>
          <input type="range" min={control.min} max={control.max} step={control.step} value={number} onChange={(e) => change(e.target.value)} aria-label={control.label} />
          <input className="field num" type="number" min={control.min} max={control.max} step={control.step} value={number} onChange={(e) => change(e.target.value)} aria-label={`${control.label} value`} />
        </>
      );
    } else if (control.kind === "select") {
      input = (
        <select className="field" value={value} onChange={(e) => set(key, e.target.value)} aria-label={control.label}>
          {control.options.map(([label, option]) => (
            <option key={option} value={option}>{label}</option>
          ))}
        </select>
      );
    } else {
      input = <input type="color" value={value ? hex(value) : "#000000"} onChange={(e) => set(key, e.target.value)} aria-label={`${control.label} (${theme})`} />;
    }
    return (
      <div className="debug-row" key={control.key} data-changed={stored !== undefined || undefined}>
        <span className="debug-label">{control.label}{control.kind === "color" && <span className="dim"> · {theme}</span>}</span>
        <span className="debug-input">{input}</span>
        <button type="button" className="debug-reset" title="reset" aria-label={`reset ${control.label}`} disabled={stored === undefined} onClick={() => set(key, undefined)}>×</button>
      </div>
    );
  }

  return (
    <aside className="debug" aria-label="debug" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <header className="debug-head">
        <b>debug<span className="dot">.</span></b>
        <span className="dim num">{changed} changed</span>
        <button type="button" className="btn" onClick={copy} disabled={!changed}>copy css</button>
        <button type="button" className="btn" onClick={debug.reset} disabled={!changed}>reset</button>
        <button type="button" className="debug-close" aria-label="close debug" onClick={onClose}>×</button>
      </header>
      <div className="debug-body">
        {GROUPS.map((group, i) => (
          <details key={group.title} open={i < 3}>
            <summary>{group.title}</summary>
            {group.controls.map(row)}
          </details>
        ))}
      </div>
    </aside>
  );
}
