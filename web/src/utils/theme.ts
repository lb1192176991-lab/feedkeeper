export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "fk_theme";
const listeners = new Set<() => void>();

let theme: Theme = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
})();

/** Shared theme state so every theme control shows the same choice. */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTheme(): Theme {
  return theme;
}

export function setTheme(next: Theme) {
  theme = next;
  if (next === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", next);
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage may be unavailable (private browsing); theme just won't persist.
  }
  listeners.forEach((listener) => listener());
}
