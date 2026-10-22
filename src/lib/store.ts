/** localStorage that never throws: it is missing or full in some browsers. set tells whether the value was kept. */
export const store = {
  get(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
};
