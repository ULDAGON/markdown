import { createSource } from "./source.js";
import { createPreview } from "./preview.js";
import { renderToolbar, askUrl, shortcut } from "./toolbar.js";

const SAMPLE = `# Hello

world. type on the left, read on the right. edit either side; the other follows.

## what works

- **bold**, _italic_, ~~strike~~ and \`code\`
- [links](https://uldagon.com)
- [x] task lists
- [ ] tables

> weniger, aber besser.

| key | does |
| --- | --- |
| ${shortcut("b")} | bold |
| ${shortcut("i")} | italic |
| ${shortcut("s")} | download |

\`\`\`js
const answer = 42;
\`\`\`
`;

const $ = (id) => document.getElementById(id);
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

const source = createSource($("source"));
const preview = createPreview($("preview"));
const name = $("name");

const sourceTools = renderToolbar($("source-tools"), "markdown", (id, arg) => {
  if (id === "heading") source.el.focus();
  source.run(id, arg);
});
const previewTools = renderToolbar($("preview-tools"), "preview", async (id, arg) => {
  if (id === "link") {
    preview.remember();
    arg = await askUrl($("preview-tools"));
  }
  preview.run(id, arg);
});
// The heading picker and the link field take the focus; keep the preview selection for them.
$("preview-tools").addEventListener("pointerdown", () => preview.remember());

// ------------------------------------------------------------------ sync
function changed() {
  store.set("md.text", source.value);
  stats();
}

source.el.addEventListener("input", () => {
  preview.render(source.value);
  changed();
});

let pending = 0;
preview.el.addEventListener("input", () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    source.value = preview.toMarkdown() + "\n";
    changed();
  }, 120);
});

document.addEventListener("selectionchange", () => {
  if (document.activeElement === source.el) sourceTools.heading(source.headingLevel());
  if (!preview.hasFocus()) return;
  const state = preview.state();
  previewTools.heading(state.heading);
  for (const id of ["bold", "italic", "strike", "code", "quote", "ul", "ol"]) previewTools.pressed(id, state[id]);
});

// Scroll the other side to the same share of its height.
let leader = null;
function follow(from, to) {
  from.addEventListener("scroll", () => {
    if (leader && leader !== from) return;
    leader = from;
    const share = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = share * (to.scrollHeight - to.clientHeight);
    clearTimeout(follow.t);
    follow.t = setTimeout(() => (leader = null), 80);
  });
}
follow(source.el, preview.el);
follow(preview.el, source.el);

// ------------------------------------------------------------------ status
const count = new Intl.NumberFormat("en-US");
function size(bytes) {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`;
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`;
}
function stats() {
  const text = source.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const minutes = Math.ceil(words / 200);
  $("stats").textContent = [
    `${count.format(text.length)} characters`,
    size(new Blob([text]).size),
    words ? `${minutes} min read` : "— read",
  ].join(" · ");
}

const KEYS = `<kbd>${shortcut("b")}</kbd> bold · <kbd>${shortcut("i")}</kbd> italic · <kbd>${shortcut("k")}</kbd> link · <kbd>${shortcut("s")}</kbd> download`;
let noteTimer = 0;
function note(text) {
  $("note").textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => ($("note").innerHTML = KEYS), 4000);
}
$("note").innerHTML = KEYS;

// ------------------------------------------------------------------ file
function fileName() {
  const raw = name.value.trim().replace(/[\\/:*?"<>|]/g, "-") || "untitled.md";
  return /\.[a-z0-9]+$/i.test(raw) ? raw : `${raw}.md`;
}

function download() {
  const url = URL.createObjectURL(new Blob([source.value], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName() });
  a.click();
  URL.revokeObjectURL(url);
  note(`saved ${fileName()}.`);
}

async function open(file) {
  if (!file) return;
  source.replaceAll(await file.text());
  name.value = file.name;
  store.set("md.name", file.name);
  note(`opened ${file.name}. ${shortcut("z")} to undo.`);
}

$("import").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => { open(e.target.files[0]); e.target.value = ""; });
$("download").addEventListener("click", download);
$("clear").addEventListener("click", () => {
  source.replaceAll("");
  note(`cleared. ${shortcut("z")} in the source to undo.`);
});
name.addEventListener("input", () => store.set("md.name", name.value));

// Drop a file on either card.
for (const card of document.querySelectorAll(".card")) {
  card.addEventListener("dragover", (e) => { e.preventDefault(); card.dataset.drop = ""; });
  card.addEventListener("dragleave", () => delete card.dataset.drop);
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    delete card.dataset.drop;
    open(e.dataTransfer.files[0]);
  });
}

// ------------------------------------------------------------------ keys
const KEYMAP = { b: "bold", i: "italic", k: "link" };
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "s") { e.preventDefault(); return download(); }
  const id = KEYMAP[key];
  if (!id) return;
  if (document.activeElement === source.el) { e.preventDefault(); source.run(id); }
  else if (preview.hasFocus()) { e.preventDefault(); $("preview-tools").querySelector(`[aria-label="${id}"]`).click(); }
});

// ------------------------------------------------------------------ theme
const theme = $("theme");
const isDark = () => document.documentElement.dataset.theme !== "light";
theme.setAttribute("aria-checked", String(isDark()));
theme.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  theme.setAttribute("aria-checked", String(next === "dark"));
  store.set("theme", next);
});

// ------------------------------------------------------------------ start
source.value = store.get("md.text") ?? SAMPLE;
name.value = store.get("md.name") ?? "untitled.md";
preview.render(source.value);
stats();
