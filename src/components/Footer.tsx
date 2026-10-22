"use client";
import { stats } from "@/lib/stats";
import ThemeToggle from "./ThemeToggle";
import { useMod } from "./useMod";

type Props = { text: string; note: string | null; onClear: () => void; onDebug: () => void };

/** Clear on the left, the theme on the right. The note replaces the key hints until it is null again. */
export default function Footer({ text, note, onClear, onDebug }: Props) {
  const mod = useMod();
  return (
    <footer className="status">
      <button className="btn" onClick={onClear}>clear</button>
      <span className="num stats">{stats(text)}</span>
      <span className="keys" data-note={note ? "" : undefined}>
        {note ?? (
          <>
            <kbd>{mod}b</kbd> bold · <kbd>{mod}i</kbd> italic · <kbd>{mod}k</kbd> link
          </>
        )}
      </span>
      <button className="link" onClick={onDebug} title={`debug · ${mod}.`}>debug</button>
      <ThemeToggle />
    </footer>
  );
}
