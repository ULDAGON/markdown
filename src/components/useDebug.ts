import { useLayoutEffect, useState } from "react";
import { applyDebug, toCss } from "@/lib/debug-controls";
import { store } from "@/lib/store";

const KEY = "md.debug";

function load(): Record<string, string> {
  try {
    return JSON.parse(store.get(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** The values of the debug panel: kept in localStorage, applied to <html>, and again when the theme changes. */
export function useDebug() {
  // Read at once on the client, so the first apply keeps what the head script set. Nothing renders from the
  // values while the panel is closed, so the server markup still matches.
  const [values, setValues] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : load()));
  const [theme, setTheme] = useState("dark");

  // A layout effect: the panel reads its defaults in an effect, after the page has the new values.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      setTheme(root.dataset.theme ?? "dark");
      applyDebug(values, root);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributeFilter: ["data-theme"] });
    store.set(KEY, JSON.stringify(values));
    return () => observer.disconnect();
  }, [values]);

  return {
    values,
    theme,
    /** Set a stored key, or reset it with undefined. */
    set(key: string, value: string | undefined) {
      setValues(({ [key]: _old, ...rest }) => (value === undefined ? rest : { ...rest, [key]: value }));
    },
    reset: () => setValues({}),
    css: () => toCss(values),
  };
}

export type Debug = ReturnType<typeof useDebug>;
