import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** The modifier key of the platform. The server and the first client render use ⌘, so hydration matches. */
export function useMod() {
  return useSyncExternalStore(
    subscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "ctrl+"),
    () => "⌘",
  );
}
