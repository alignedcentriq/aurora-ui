import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cleanUrlParams() {
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    let changed = false;
    const authParams = ["code", "state", "session_state", "error", "error_description", "client_info"];
    authParams.forEach((param) => {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    });
    if (changed) {
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }
}

