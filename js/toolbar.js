// One set of tools for both cards. Each card maps the ids to its own kind of edit.
const GROUPS = [
  [
    { id: "bold", label: "B", title: "bold", key: "b", cls: "b" },
    { id: "italic", label: "I", title: "italic", key: "i", cls: "i" },
    { id: "strike", label: "S", title: "strikethrough", cls: "s" },
    { id: "code", label: "<>", title: "inline code" },
  ],
  "heading",
  [
    { id: "quote", label: ">", title: "quote" },
    { id: "ul", label: "-", title: "bullet list" },
    { id: "ol", label: "1.", title: "numbered list" },
    { id: "task", label: "[ ]", title: "task list" },
  ],
  [
    { id: "link", label: "link", title: "link", key: "k" },
    { id: "codeblock", label: "```", title: "code block" },
    { id: "table", label: "table", title: "table" },
    { id: "hr", label: "---", title: "horizontal rule" },
  ],
];

const HEADINGS = ["text", "h1", "h2", "h3", "h4", "h5", "h6"];
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "ctrl+";

// run(id, arg) does the edit. Returns setters for the state the card reports back.
export function renderToolbar(el, label, run) {
  const buttons = {};
  for (const group of GROUPS) {
    if (el.children.length) el.append(Object.assign(document.createElement("span"), { className: "sep" }));
    if (group === "heading") { el.append(headingPicker(run)); continue; }
    for (const tool of group) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `tool ${tool.cls ?? ""}`;
      b.textContent = tool.label;
      b.title = tool.key ? `${tool.title} · ${MOD}${tool.key}` : tool.title;
      b.setAttribute("aria-label", tool.title);
      // Keep the caret and the selection where they are.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => run(tool.id));
      buttons[tool.id] = b;
      el.append(b);
    }
  }
  el.append(Object.assign(document.createElement("span"), { className: "label", textContent: label }));

  const select = el.querySelector("select");
  return {
    heading(level) { select.value = String(level); },
    pressed(id, on) { buttons[id]?.setAttribute("aria-pressed", String(on)); },
  };
}

function headingPicker(run) {
  const wrap = Object.assign(document.createElement("span"), { className: "pick" });
  const select = document.createElement("select");
  select.setAttribute("aria-label", "heading");
  select.title = "heading";
  HEADINGS.forEach((name, level) => select.append(new Option(name, String(level))));
  select.addEventListener("change", () => run("heading", Number(select.value)));
  wrap.append(select);
  return wrap;
}

// The toolbar turns into one field for a URL. Resolves to the URL, or null on esc.
export function askUrl(toolbar) {
  return new Promise((resolve) => {
    const form = Object.assign(document.createElement("form"), { className: "ask" });
    const input = Object.assign(document.createElement("input"), { className: "field", placeholder: "https://", spellcheck: false });
    form.append(input, Object.assign(document.createElement("span"), { textContent: "enter · esc" }));
    // Resolve before the removal, which blurs the field and would resolve null.
    const done = (url) => { resolve(url); form.remove(); };
    form.addEventListener("submit", (e) => { e.preventDefault(); done(input.value.trim() || null); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") done(null); });
    input.addEventListener("blur", () => done(null));
    toolbar.append(form);
    input.focus();
  });
}

export const shortcut = (key) => `${MOD}${key}`;
