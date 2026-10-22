import type { Metadata } from "next";
import localFont from "next/font/local";
import "katex/dist/katex.min.css";
import "./globals.css";

// The className of a font sets font-family to a name that does not exist; it is on <html> only to load the faces.
// body reads the real family from --mono.
// Two faces of one family, each with its own range, as the font was cut: the browser takes the glyphs from the matching file.
const latin = localFont({
  src: "../fonts/JetBrainsMono-latin.woff2",
  weight: "100 800",
  display: "block",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "JetBrains Mono" }, { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
const latinExt = localFont({
  src: "../fonts/JetBrainsMono-latin-ext.woff2",
  weight: "100 800",
  display: "block",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "JetBrains Mono" }, { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

// Runs before first paint: the stored theme, else the system's.
const themeScript = `(function(){try{var t=localStorage.getItem("md.theme");document.documentElement.dataset.theme=t||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")}catch(e){}})();`;

export const metadata: Metadata = { title: "Markdown." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${latin.className} ${latinExt.className}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
