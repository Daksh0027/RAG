"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "omnidocs-theme";

export type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Manages the light/dark theme for the app. Persists the user's choice to
 * localStorage and falls back to the OS-level preference on first visit.
 * Pairs with the inline blocking script in `app/layout.tsx` that applies
 * the stored/system theme before hydration to avoid a flash of the wrong
 * theme on page load.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    setTheme(stored ?? getSystemTheme());
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  };

  return { theme, toggleTheme };
}
