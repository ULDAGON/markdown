# Markdown.

A two-pane markdown viewer in the ULDAGON style. Source left, preview right; edit either side.

```sh
npm install
npm run dev     # http://localhost:4410
npm test
```

Next.js (App Router), React and TypeScript. The tokens in `src/styles/uldagon.css` and the fonts in `src/fonts/` come from [ULDAGON/uldagon-design](https://github.com/ULDAGON/uldagon-design).

| file | what |
|---|---|
| `src/app/` | layout (fonts, theme script), page, global styles |
| `src/components/Editor.tsx` | state, file open and download, keys, scroll sync between the two cards |
| `src/components/Toolbar.tsx` | the one tool list both cards share, and the inline URL field |
| `src/components/Preview.tsx` | the rendered card |
| `src/lib/source-edits.ts` | markdown edits on the source as pure functions |
| `src/lib/stats.ts` | the status line: characters, size, reading time |
| `src/lib/markdown/` | markdown to HTML and back |
| `tests/` | `npm test` |
