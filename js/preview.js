/* global marked, DOMPurify, TurndownService, turndownPluginGfm */
// The rendered side. Markdown goes in through render(); rich edits come out through toMarkdown().

marked.use({ gfm: true });

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_", hr: "---" });
turndown.use(turndownPluginGfm.gfm);
// Rules added later win. GFM writes ~x~; the toolbar on the source writes ~~x~~.
turndown.addRule("strike", { filter: ["del", "s", "strike"], replacement: (c) => `~~${c}~~` });
turndown.addRule("task", {
  filter: (n) => n.nodeName === "INPUT" && n.type === "checkbox",
  replacement: (_, n) => (n.hasAttribute("checked") ? "[x] " : "[ ] "),
});
// Turndown pads list markers to four columns; write "- item" and "1. item" as people type them.
turndown.addRule("listItem", {
  filter: "li",
  replacement(content, node) {
    const parent = node.parentNode;
    const index = Array.prototype.indexOf.call(parent.children, node);
    const marker = parent.nodeName === "OL" ? `${Number(parent.getAttribute("start") ?? 1) + index}. ` : "- ";
    content = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/^(\[[ x]\]) +/, "$1 ").replace(/\n/gm, "\n" + " ".repeat(marker.length));
    return marker + content + (node.nextSibling && !content.endsWith("\n") ? "\n" : "");
  },
});
// formatBlock("pre") makes a <pre> without <code>; fence it like any other code block.
turndown.addRule("barePre", {
  filter: (n) => n.nodeName === "PRE" && n.firstChild?.nodeName !== "CODE",
  replacement: (_, n) => "\n\n```\n" + n.textContent.replace(/\n$/, "") + "\n```\n\n",
});

const TABLE = "<table><thead><tr><th>column</th><th>column</th></tr></thead><tbody><tr><td>cell</td><td>cell</td></tr></tbody></table><p><br></p>";
const BLOCKS = /^(P|H[1-6]|BLOCKQUOTE|PRE|LI|TD|TH)$/;
const escape = (s) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

export function createPreview(el) {
  let saved = null; // the selection while a toolbar control has the focus

  const inside = (node) => node && el.contains(node);
  const range = () => {
    const sel = getSelection();
    return sel.rangeCount && inside(sel.anchorNode) ? sel.getRangeAt(0) : null;
  };
  const closest = (tag) => {
    let n = range()?.startContainer;
    for (; n && n !== el; n = n.parentNode) if (n.nodeName === tag) return n;
    return null;
  };
  const block = () => {
    let n = range()?.startContainer;
    for (; n && n !== el; n = n.parentNode) if (BLOCKS.test(n.nodeName)) return n.nodeName;
    return "P";
  };

  // Focusing puts a fresh caret at the start, so check for a live selection before it.
  function restore() {
    const live = document.activeElement === el && range();
    el.focus();
    if (saved && !live) { getSelection().removeAllRanges(); getSelection().addRange(saved); }
  }

  function exec(cmd, arg) {
    restore();
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(cmd, false, arg);
  }

  function code() {
    const node = closest("CODE");
    if (node && node.parentNode.nodeName !== "PRE") {
      const r = document.createRange();
      r.selectNode(node);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return exec("insertText", node.textContent);
    }
    exec("insertHTML", `<code>${escape(String(range() ?? "") || "code")}</code>`);
  }

  const edits = {
    bold: () => exec("bold"),
    italic: () => exec("italic"),
    strike: () => exec("strikeThrough"),
    code,
    heading: (level) => exec("formatBlock", level ? `h${level}` : "p"),
    quote: () => (closest("BLOCKQUOTE") ? exec("outdent") : exec("formatBlock", "blockquote")),
    ul: () => exec("insertUnorderedList"),
    ol: () => exec("insertOrderedList"),
    task: () => exec("insertHTML", `<ul><li><input type="checkbox"> ${escape(String(range() ?? "")) || "task"}</li></ul>`),
    link(url) {
      restore();
      if (!url) return;
      if (range() && !range().collapsed) return exec("createLink", url);
      exec("insertHTML", `<a href="${escape(url)}">${escape(url)}</a>`);
    },
    codeblock: () => exec("formatBlock", "pre"),
    table: () => exec("insertHTML", TABLE),
    hr: () => exec("insertHorizontalRule"),
  };

  // A checkbox in an editable region does not toggle by itself.
  el.addEventListener("mousedown", (e) => {
    if (e.target.type !== "checkbox") return;
    e.preventDefault();
    e.target.toggleAttribute("checked");
    e.target.checked = e.target.hasAttribute("checked");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  el.addEventListener("click", (e) => { if (e.target.type === "checkbox") e.preventDefault(); });

  return {
    el,
    run: (id, arg) => edits[id](arg),
    remember() { saved = range()?.cloneRange() ?? saved; },
    render(md) {
      el.innerHTML = DOMPurify.sanitize(marked.parse(md));
      el.querySelectorAll("input[type=checkbox]").forEach((c) => c.removeAttribute("disabled"));
    },
    // Removed blocks leave empty paragraphs behind; keep at most one blank line outside code fences.
    toMarkdown: () => turndown.turndown(el).split(/(^```[\s\S]*?^```)/m).map((part, i) => (i % 2 ? part : part.replace(/\n{3,}/g, "\n\n"))).join(""),
    hasFocus: () => !!range(),
    state: () => ({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      strike: document.queryCommandState("strikeThrough"),
      code: !!closest("CODE"),
      quote: !!closest("BLOCKQUOTE"),
      ul: !!closest("UL"),
      ol: !!closest("OL"),
      heading: Number(block().match(/^H(\d)$/)?.[1] ?? 0),
    }),
  };
}
