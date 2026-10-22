import { useEffect, type RefObject } from "react";

/** Scroll the other side to the same share of its height. */
export function useScrollSync(a: RefObject<HTMLElement | null>, b: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const [first, second] = [a.current, b.current];
    if (!first || !second) return;
    // The scroll that one side causes in the other must not echo back.
    let leader: HTMLElement | null = null;
    let release = 0;
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      if (leader && leader !== from) return;
      leader = from;
      const share = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
      to.scrollTop = share * (to.scrollHeight - to.clientHeight);
      clearTimeout(release);
      release = window.setTimeout(() => (leader = null), 80);
    };
    const onFirst = follow(first, second);
    const onSecond = follow(second, first);
    first.addEventListener("scroll", onFirst);
    second.addEventListener("scroll", onSecond);
    return () => {
      first.removeEventListener("scroll", onFirst);
      second.removeEventListener("scroll", onSecond);
      clearTimeout(release);
    };
  }, [a, b]);
}
