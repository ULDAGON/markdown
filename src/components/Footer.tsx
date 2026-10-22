"use client";
import { stats } from "@/lib/stats";
import ThemeToggle from "./ThemeToggle";
import { useMod } from "./useMod";

type Props = { text: string; note: string | null; onClear: () => void; onDebug: () => void };

/** Clear on the left, the theme on the right; a note shows between them until it is null again. */
export default function Footer({ text, note, onClear, onDebug }: Props) {
  const mod = useMod();
  return (
    <footer className="status">
      <button className="btn" onClick={onClear}>clear</button>
      <span className="num stats">{stats(text)}</span>
      <span className="note">{note}</span>
      <button className="link" onClick={onDebug} data-tip={`debug · ${mod}.`} data-tip-up="" data-tip-end="">debug</button>
      <ThemeToggle />
    </footer>
  );
}
