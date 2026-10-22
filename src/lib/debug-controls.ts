// The settings of the debug panel. Each one is a CSS custom property (`--x`) or a data attribute of <html> (`data-x`);
// globals.css reads them. A colour is kept for each theme: its stored key is `--x@dark` or `--x@light`.

/** A select of a data attribute lists the default of the stylesheet (no attribute) first. */
export type Control =
  | { kind: "range"; key: string; label: string; min: number; max: number; step: number; unit: string }
  | { kind: "select"; key: string; label: string; options: [label: string, value: string][] }
  | { kind: "color"; key: string; label: string };

type Group = { title: string; controls: Control[] };

const px = (key: string, label: string, min: number, max: number, step = 1): Control => ({ kind: "range", key, label, min, max, step, unit: "px" });
const num = (key: string, label: string, min: number, max: number, step: number, unit = ""): Control => ({ kind: "range", key, label, min, max, step, unit });
const pick = (key: string, label: string, ...options: [string, string][]): Control => ({ kind: "select", key, label, options });
const onOff = (key: string, label: string): Control => pick(key, label, ["on", "on"], ["off", "off"]);

export const GROUPS: Group[] = [
  {
    title: "layout",
    controls: [
      px("--page-pad", "page padding", 0, 64),
      px("--pane-gap", "gap between cards", 0, 48),
      px("--source-pad-x", "source padding x", 0, 64),
      px("--source-pad-y", "source padding y", 0, 64),
      px("--preview-pad-x", "preview padding x", 0, 96),
      px("--preview-pad-y", "preview padding y", 0, 96),
      pick("--preview-measure", "preview line length", ["full", "none"], ["60ch", "60ch"], ["70ch", "70ch"], ["80ch", "80ch"], ["100ch", "100ch"]),
      px("--footer-pad", "footer padding y", 0, 24),
    ],
  },
  {
    title: "shape",
    controls: [
      px("--radius-card", "card radius", 0, 32),
      px("--radius-control", "button radius", 0, 20),
      px("--radius-tool", "tool radius", 0, 16),
      px("--radius-code", "code radius", 0, 16),
      px("--radius-box", "checkbox radius", 0, 8),
      num("--border-card", "card border", 0, 4, 0.5, "px"),
      num("--border-control", "button border", 0, 4, 0.5, "px"),
      num("--border-toolbar", "toolbar divider", 0, 4, 0.5, "px"),
      num("--line-a", "hairline strength", 0, 60, 1, "%"),
      num("--card-a", "card surface lift", 0, 60, 0.5, "%"),
    ],
  },
  {
    title: "editor buttons",
    controls: [
      pick("data-tool-style", "button style", ["solid", "solid"], ["outline", "outline"], ["ghost", "ghost"]),
      pick("data-tool-hover", "hover", ["tint", "tint"], ["invert", "invert"], ["text", "text"]),
      pick("data-tool-pressed", "pressed", ["outline", "outline"], ["fill", "fill"], ["underline", "underline"]),
      px("--tool-h", "button height", 16, 40),
      px("--tool-pad", "button padding x", 0, 16),
      px("--toolbar-gap", "gap between buttons", 0, 16),
      px("--toolbar-pad", "toolbar padding", 0, 16),
      onOff("data-tool-seps", "separators"),
      onOff("data-card-labels", "card labels"),
    ],
  },
  {
    title: "type",
    controls: [
      px("--size-ui", "interface size", 10, 18),
      num("--leading-ui", "interface leading", 1, 2, 0.05),
      px("--source-size", "source size", 10, 20),
      num("--source-leading", "source leading", 1, 2.4, 0.05),
      pick("--preview-font", "preview font", ["sans", "var(--sans)"], ["serif", "var(--serif)"], ["mono", "var(--mono)"]),
      px("--size-text", "preview size", 12, 24),
      num("--leading-text", "preview leading", 1.1, 2.4, 0.05),
      num("--heading-scale", "heading scale", 0.6, 1.6, 0.05),
      pick("--heading-weight", "heading weight", ["300", "300"], ["400", "400"], ["500", "500"], ["600", "600"], ["700", "700"]),
    ],
  },
  {
    title: "colour",
    controls: [
      { kind: "color", key: "--c-bg", label: "background" },
      { kind: "color", key: "--c-text", label: "text" },
      { kind: "color", key: "--c-accent", label: "accent" },
      num("--muted-a", "dim text strength", 20, 100, 1, "%"),
    ],
  },
  {
    title: "grain",
    controls: [
      pick("data-grain", "grain", ["noise", "noise"], ["dither", "dither"], ["off", "off"]),
      pick("data-grain-layer", "layer", ["behind cards", "behind"], ["above all", "above"]),
      pick("--grain-color", "grain colour", ["text", "var(--c-text)"], ["accent", "var(--c-accent)"]),
      num("--grain-opacity", "opacity", 0, 0.5, 0.01),
      px("--grain-size", "grain size", 2, 400),
      pick("--grain-blend", "blend", ["normal", "normal"], ["overlay", "overlay"], ["soft light", "soft-light"], ["multiply", "multiply"], ["screen", "screen"]),
      pick("data-grain-motion", "motion", ["off", "off"], ["on", "on"]),
    ],
  },
  {
    title: "footer",
    controls: [onOff("data-footer-stats", "stats"), num("--border-footer", "top border", 0, 4, 0.5, "px")],
  },
  {
    title: "motion",
    controls: [num("--t-fast", "hover speed", 0, 1, 0.01, "s"), num("--t-theme", "theme speed", 0, 2, 0.05, "s")],
  },
];

export const CONTROLS = GROUPS.flatMap((group) => group.controls);

/** The stored key of a control: a colour is kept for each theme. */
export const storedKey = (control: Control, theme: string) => (control.kind === "color" ? `${control.key}@${theme}` : control.key);

/** Apply stored values to <html>: CSS properties, data attributes, and the colours of the theme. Also inlined in layout.tsx. */
export function applyDebug(values: Record<string, string>, root: HTMLElement) {
  const theme = root.dataset.theme ?? "dark";
  for (const control of CONTROLS) {
    const value = values[storedKey(control, theme)];
    if (control.key.startsWith("--")) {
      if (value === undefined) root.style.removeProperty(control.key);
      else root.style.setProperty(control.key, value);
    } else if (value === undefined) root.removeAttribute(control.key);
    else root.setAttribute(control.key, value);
  }
}

/** The changed values as CSS, to copy into the code. */
export function toCss(values: Record<string, string>): string {
  const blocks: Record<string, string[]> = {};
  const add = (selector: string, line: string) => (blocks[selector] ??= []).push(line);
  for (const [key, value] of Object.entries(values)) {
    const [name, theme] = key.split("@");
    if (name.startsWith("--")) add(theme ? `[data-theme=${theme}]` : ":root", `  ${name}: ${value};`);
    else add("/* attributes of <html> */", `  ${name}="${value}"`);
  }
  return Object.entries(blocks)
    .map(([selector, lines]) => (selector.startsWith("/*") ? `${selector}\n${lines.join("\n")}` : `${selector} {\n${lines.join("\n")}\n}`))
    .join("\n\n");
}
