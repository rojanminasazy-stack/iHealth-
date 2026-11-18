import { useEffect } from "react";

/** Website: reopen the page the person asked for after GitHub Pages bounced them through 404.html. */
export function useWebDeepLink(go: (path: string) => void): void {
  useEffect(() => {
    let path: string | null = null;
    try {
      path = sessionStorage.getItem("ihealthe.spa");
      sessionStorage.removeItem("ihealthe.spa");
    } catch {
      /* storage blocked */
    }
    if (path && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(path) && path !== "/") go(path);
  }, [go]);
}
