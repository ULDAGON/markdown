import { useCallback, useEffect, type RefObject } from "react";

// Keyed by theme and source, so a render of the preview does not draw an unchanged diagram again.
let drawn = new Map<string, string>();
let count = 0;
let latest = 0; // the number of the newest draw

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
    lineColor: colour("--c-text-dim"),
    textColor: colour("--c-text"),
    fontFamily: token("--mono"),
    // ULDAGON surfaces are flat: mermaid 12 shades its nodes with a shadow and a gradient border by default.
    dropShadow: "none",
    useGradient: false,
  };
}

async function drawAll(root: HTMLElement) {
  const mine = ++latest;
  const diagrams = [...root.querySelectorAll<HTMLElement>(".diagram")];
  const used = new Map<string, string>();
  if (diagrams.length) {
    const { default: mermaid } = await import("mermaid");
    // initialize is global, so a draw that another one overtook at an await must stop: it would render or cache with the wrong theme.
    if (mine !== latest) return;
    // The colours, not the name of the theme: the debug panel changes them inside one theme.
    const variables = themeVariables();
    const theme = JSON.stringify(variables);
    mermaid.initialize({ startOnLoad: false, theme: "base", securityLevel: "strict", themeVariables: variables });
    for (const diagram of diagrams) {
      const pre = diagram.querySelector("pre");
      if (!pre) continue;
      const key = `${theme}\n${pre.textContent}`;
      let svg = drawn.get(key);
      if (svg === undefined) {
        try {
          // parse throws on an error; render alone would leave its error drawing in the page.
          await mermaid.parse(pre.textContent!);
          if (mine !== latest) return;
          svg = (await mermaid.render(`diagram-${++count}`, pre.textContent!)).svg;
          if (mine !== latest) return;
          drawn.set(key, svg);
        } catch {
          if (mine !== latest) return;
          svg = "";
        }
      }
      used.set(key, svg);
      pre.hidden = svg !== "";
      diagram.querySelector(":scope > :not(pre)")?.remove();
      diagram.insertAdjacentHTML("beforeend", svg || "<small>diagram error.</small>");
    }
  }
  drawn = used;
}

/** Draw the diagrams of the article with Mermaid in the colours of the theme, and again when the colours change. */
export function useMermaid(article: RefObject<HTMLElement | null>) {
  const draw = useCallback(() => drawAll(article.current!), [article]);
  useEffect(() => {
    const observer = new MutationObserver(draw);
    // data-theme switches the colours; style holds the colours of the debug panel. A draw with the same colours is a cache hit.
    observer.observe(document.documentElement, { attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, [draw]);
  return draw;
}
