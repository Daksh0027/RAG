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

// Module-level store so every useTheme() consumer on a page shares one value.
// Without this, each component held independent state and the header toggle
// could disagree with the rest of the page.
let currentTheme: Theme | null = null;
const listeners = new Set<(theme: Theme) => void>();

function setGlobalTheme(theme: Theme) {
  currentTheme = theme;
  applyTheme(theme);
  listeners.forEach((listener) => listener(theme));
}

function readInitialTheme(): Theme {
  if (currentTheme) return currentTheme;
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  currentTheme = stored ?? getSystemTheme();
  return currentTheme;
}

/**
 * Manages the light/dark theme for the app. Persists the user's choice to
 * localStorage and falls back to the OS-level preference on first visit.
 * Pairs with the inline blocking script in `app/layout.tsx` that applies
 * the stored/system theme before hydration to avoid a flash of the wrong
 * theme on page load.
 */
export function useTheme() {
  // Starts as "light" to match the server render, then syncs on mount.
  // Reading localStorage during render would cause a hydration mismatch.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const resolved = readInitialTheme();
    // Apply as well as read: the pre-hydration script covers the initial
    // paint, but a client-side navigation into a fresh consumer needs the
    // class re-asserted.
    applyTheme(resolved);
    setTheme(resolved);

    listeners.add(setTheme);
    return () => {
      listeners.delete(setTheme);
    };
  }, []);

  // Follow the OS preference until the user makes an explicit choice.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
      setGlobalTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggleTheme = () => {
    const next: Theme = (currentTheme ?? theme) === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, next);
    setGlobalTheme(next);
  };

  return { theme, toggleTheme };
}
