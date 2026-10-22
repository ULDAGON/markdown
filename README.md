# Markdown.

A two-pane markdown viewer in the ULDAGON style. Source left, preview right; edit either side.

```sh
python3 -m http.server 4410   # then open http://localhost:4410
```

No build step. `css/uldagon.css` and `assets/fonts/` come from [ULDAGON/uldagon-design](https://github.com/ULDAGON/uldagon-design); `vendor/` holds marked, DOMPurify and turndown (+ gfm plugin).

| file | what |
|---|---|
| `js/app.js` | wiring: sync, file import and download, status bar, keys, theme |
| `js/source.js` | markdown edits on the textarea, undoable with ⌘z |
| `js/preview.js` | render markdown, rich edits on the preview, preview back to markdown |
| `js/toolbar.js` | the one tool list both cards share |
