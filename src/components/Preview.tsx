"use client";
import { useMemo } from "react";
import { render } from "@/lib/markdown/render";
import Toolbar from "./Toolbar";

// The tools and onChange are not wired yet: the preview only shows the markdown for now.
export default function Preview({ markdown, ref }: { markdown: string; onChange: (markdown: string) => void; ref?: React.Ref<HTMLElement> }) {
  // The editor re-renders on every caret move; render the markdown only when it changed.
  const html = useMemo(() => render(markdown).html, [markdown]);
  return (
    <section className="card" aria-label="preview">
      <Toolbar label="preview" onRun={() => {}} heading={0} />
      <article className="prose" ref={ref} contentEditable={false} spellCheck={false} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
