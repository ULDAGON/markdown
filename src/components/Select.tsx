"use client";
import { useEffect, useId, useRef, useState } from "react";

export type Option = { value: string; label: string };

type Props = { label: string; tip?: string; options: Option[]; value: string; onChange: (value: string) => void };

/**
 * A listbox instead of a native <select>: the native popup cannot take the theme. As in the ULDAGON kit.
 * A press on it does not take the focus, so the caret and the selection of an editor stay where they are.
 */
export default function Select({ label, tip, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];

  // A press outside closes the list. So does Escape anywhere: a list opened by a press has no focus to get the key.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // Escape closes the list only: not also an open raw edit or the link field
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const show = () => {
    setActive(options.indexOf(selected));
    setOpen(true);
  };
  const pick = (i: number) => {
    setOpen(false);
    if (options[i].value !== value) onChange(options[i].value);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      if (!open) return show();
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) pick(active);
      else show();
    }
  };

  return (
    <div className="select" ref={root} data-tip={open ? undefined : tip} onMouseDown={(e) => e.preventDefault()}>
      <button
        type="button"
        className="select-button"
        role="combobox"
        aria-label={label}
        data-value={value}
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        {selected.label}
      </button>
      <ul className="options" role="listbox" id={id} aria-label={`${label} options`} hidden={!open}>
        {options.map((o, i) => (
          <li
            key={o.value}
            id={`${id}-${i}`}
            role="option"
            aria-selected={o.value === value}
            data-active={i === active || undefined}
            onPointerEnter={() => setActive(i)}
            onClick={() => pick(i)}
          >
            {o.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
