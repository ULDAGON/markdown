import { useCallback, useEffect, type RefObject } from "react";

// Keyed by theme and source, so a render of the preview does not draw an unchanged diagram again.
const drawn = new Map<string, string>();
let count = 0;

function themeVariables() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  // Mermaid reads only plain colours, and some tokens are color-mix() expressions. A pixel over the background resolves them.
  const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const colour = (name: string) => {
    for (const fill of [token("--c-bg"), token(name)]) {
      pixel.fillStyle = fill;
      pixel.fillRect(0, 0, 1, 1);
    }
    const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    background: colour("--c-bg"),
    primaryColor: colour("--c-bg"),
    primaryTextColor: colour("--c-text"),
    primaryBorderColor: colour("--c-accent"),
    lineColor: colour("--c-line"),
    textColor: colour("--c-text"),
    fontFamily: token("--mono"),
  };
}

async function drawAll(root: HTMLElement) {
  const diagrams = [...root.querySelectorAll<HTMLElement>(".diagram")];
  if (!diagrams.length) return;
  const { default: mermaid } = await import("mermaid");
  const theme = document.documentElement.dataset.theme;
  mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: themeVariables() });
  for (const diagram of diagrams) {
    const pre = diagram.querySelector("pre")!;
    const key = `${theme}\n${pre.textContent}`;
    let svg = drawn.get(key);
    if (svg === undefined) {
      try {
        // parse throws on an error; render alone would leave its error drawing in the page.
        await mermaid.parse(pre.textContent!);
        svg = (await mermaid.render(`diagram-${++count}`, pre.textContent!)).svg;
        drawn.set(key, svg);
      } catch {
        svg = "";
      }
    }
    pre.hidden = svg !== "";
    diagram.querySelector(":scope > :not(pre)")?.remove();
    diagram.insertAdjacentHTML("beforeend", svg || "<small>diagram error.</small>");
  }
}

/** Draw the diagrams of the article with Mermaid in the colours of the theme, and again when the theme changes. */
export function useMermaid(article: RefObject<HTMLElement | null>) {
  const draw = useCallback(() => drawAll(article.current!), [article]);
  useEffect(() => {
    const observer = new MutationObserver(draw);
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [draw]);
  return draw;
}
