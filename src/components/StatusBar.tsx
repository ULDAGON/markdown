"use client";
import { stats } from "@/lib/stats";
import { useMod } from "./useMod";

/** The note replaces the key hints until it is null again. */
export default function StatusBar({ text, note }: { text: string; note: string | null }) {
  const mod = useMod();
  return (
    <footer className="status">
      <span className="num">{stats(text)}</span>
      <span className="keys">
        {note ?? (
          <>
            <kbd>{mod}b</kbd> bold · <kbd>{mod}i</kbd> italic · <kbd>{mod}k</kbd> link · <kbd>{mod}s</kbd> download
          </>
        )}
      </span>
    </footer>
  );
}
