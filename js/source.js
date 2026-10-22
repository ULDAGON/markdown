// Edits on the markdown source. Each one goes through insertText, so ⌘z undoes it like typing.

const LIST = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;
const PREFIX = {
  quote: { test: /^> ?/, make: () => "> ", keep: true },
  ul: { test: /^\s*[-*+] (?!\[[ xX]\] )/, make: () => "- " },
  ol: { test: /^\s*\d+[.)] /, make: (i) => `${i + 1}. ` },
  task: { test: /^\s*[-*+] \[[ xX]\] /, make: () => "- [ ] " },
};
const TABLE = "| column | column |\n| --- | --- |\n| cell | cell |";

export function createSource(el) {
  // Replace start..end with text, then select from..to inside the new text.
  function replace(start, end, text, from = text.length, to = from) {
    el.focus();
    el.setSelectionRange(start, end);
    const ok = text ? document.execCommand("insertText", false, text) : document.execCommand("delete");
    if (!ok) {
      el.setRangeText(text, start, end);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.setSelectionRange(start + from, start + to);
  }

  function wrap(marker, placeholder) {
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const m = marker.length;
    const sel = v.slice(s, e);
    if (v.slice(s - m, s) === marker && v.slice(e, e + m) === marker) return replace(s - m, e + m, sel, 0, sel.length);
    if (sel.length > 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
      const inner = sel.slice(m, -m);
      return replace(s, e, inner, 0, inner.length);
    }
    const inner = sel || placeholder;
    replace(s, e, marker + inner + marker, m, m + inner.length);
  }

  // Apply fn to every line the selection touches.
  function lines(fn) {
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const start = v.lastIndexOf("\n", s - 1) + 1;
    const end = v.indexOf("\n", e) === -1 ? v.length : v.indexOf("\n", e);
    const text = fn(v.slice(start, end).split("\n")).join("\n");
    replace(start, end, text, s === e ? text.length : 0);
  }

  function prefix(kind) {
    const { test, make, keep } = PREFIX[kind];
    lines((ls) => {
      const all = ls.every((l) => test.test(l));
      return ls.map((l, i) => (all ? l.replace(test, "") : make(i) + (keep ? l : l.replace(LIST, "$1"))));
    });
  }

  // A block on lines of its own, with a blank line around it where markdown needs one.
  function block(make) {
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const { text, from, to } = make(v.slice(s, e));
    const before = s === 0 || v.slice(s - 2, s) === "\n\n" ? "" : v[s - 1] === "\n" ? "\n" : "\n\n";
    const after = e === v.length ? "\n" : v.slice(e, e + 2) === "\n\n" ? "" : v[e] === "\n" ? "\n" : "\n\n";
    replace(s, e, before + text + after, before.length + from, before.length + to);
  }

  function link() {
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const sel = v.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) return replace(s, e, `[text](${sel})`, 1, 5);
    const text = sel || "text";
    replace(s, e, `[${text}](https://)`, text.length + 3, text.length + 11);
  }

  const edits = {
    bold: () => wrap("**", "bold"),
    italic: () => wrap("_", "italic"),
    strike: () => wrap("~~", "strike"),
    code: () => wrap("`", "code"),
    heading: (level) => lines((ls) => ls.map((l) => (level ? "#".repeat(level) + " " : "") + l.replace(/^#{1,6}\s+/, ""))),
    quote: () => prefix("quote"),
    ul: () => prefix("ul"),
    ol: () => prefix("ol"),
    task: () => prefix("task"),
    link,
    codeblock: () => block((sel) => ({ text: "```\n" + (sel || "code") + "\n```", from: 4, to: 4 + (sel || "code").length })),
    table: () => block(() => ({ text: TABLE, from: 2, to: 8 })),
    hr: () => block(() => ({ text: "---", from: 3, to: 3 })),
  };

  // Enter inside a list starts the next item; enter on an empty item ends the list.
  function continueList(e) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || el.selectionStart !== el.selectionEnd) return;
    const v = el.value, s = el.selectionStart;
    const start = v.lastIndexOf("\n", s - 1) + 1;
    const line = v.slice(start, s);
    const m = line.match(/^(\s*)(> |[-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/);
    if (!m) return;
    e.preventDefault();
    if (line.length === m[0].length) return replace(start, s, "");
    const next = m[3] ? `${m[1]}${Number(m[3]) + 1}${m[4]} ` : m[1] + m[2].replace(/\[[xX]\]/, "[ ]");
    replace(s, s, "\n" + next);
  }
  el.addEventListener("keydown", continueList);

  return {
    el,
    run: (id, arg) => edits[id](arg),
    get value() { return el.value; },
    // Programmatic sets skip the input event, so the preview does not render back over itself.
    set value(text) { el.value = text; },
    replaceAll: (text) => replace(0, el.value.length, text, 0, 0),
    headingLevel() {
      const v = el.value, s = el.selectionStart;
      return (v.slice(v.lastIndexOf("\n", s - 1) + 1).match(/^(#{1,6})\s/)?.[1].length) ?? 0;
    },
  };
}
