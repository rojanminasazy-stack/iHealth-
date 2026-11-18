/**
 * Website: sign-in tokens live in sessionStorage, which belongs to this one browser tab and is wiped
 * when the tab closes. Nothing is written to long-lived storage on shared or public computers.
 */
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export const secureStore = {
  get: async (k: string) => store()?.getItem(k) ?? null,
  set: async (k: string, v: string) => store()?.setItem(k, v),
  remove: async (k: string) => store()?.removeItem(k),
};
