export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ktv-theme";

/** 與 tokens.css --duration-normal 同步，供 Toast 等 UI 動畫使用 */
export const THEME_TRANSITION_MS = 300;

export function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";

  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add("disable-transitions");
  root.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  // 強制重排後立即恢復，確保主題瞬間切換、不播放過渡
  void root.offsetHeight;
  root.classList.remove("disable-transitions");
}

export function getActiveTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}
