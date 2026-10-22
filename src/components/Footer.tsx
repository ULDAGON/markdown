"use client";
import { stats } from "@/lib/stats";
import ThemeToggle from "./ThemeToggle";

type Props = { text: string; note: string | null; onClear: () => void };

/** Clear on the left, the theme on the right; a note shows between them until it is null again. */
export default function Footer({ text, note, onClear }: Props) {
  return (
    <footer className="status">
      <button className="btn" onClick={onClear}>clear</button>
      <span className="num stats">{stats(text)}</span>
      <span className="note">{note}</span>
      <ThemeToggle />
    </footer>
  );
}
