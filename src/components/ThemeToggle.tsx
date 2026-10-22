"use client";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.dataset.theme !== "light"), []);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
    setDark(!dark);
  }

  return <button className="switch" role="switch" aria-checked={dark} aria-label="dark mode" onClick={toggle} />;
}
