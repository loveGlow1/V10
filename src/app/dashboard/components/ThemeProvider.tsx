"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  applyTheme,
  isThemeChoice,
  resolveTheme,
  THEME_KEY,
  type ThemeChoice,
} from "../../theme";

type ThemeValue = {
  choice: ThemeChoice;
  /** What the choice currently comes out as — "system" is not an answer to draw with. */
  resolved: "light" | "dark";
  setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /* Starts on the default rather than on what is stored, so the server and the
     first client render agree. The stored choice is read in the effect below —
     by which point the inline boot script has already painted the right one, so
     nothing flashes. */
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // Private mode and blocked site data both throw. The default stands.
    }
    const initial = isThemeChoice(stored) ? stored : "system";
    setChoiceState(initial);
    setResolved(resolveTheme(initial));
    applyTheme(initial);
  }, []);

  /* On "system", keep following the OS: someone whose phone darkens at sunset
     asked for this to darken with it, not for a snapshot of what it was when
     they chose. */
  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      applyTheme("system");
      setResolved(query.matches ? "light" : "dark");
    };
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    setResolved(resolveTheme(next));
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The theme still changes for this page; it just will not survive a reload.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ choice, resolved, setChoice }}>
      {children}
    </ThemeContext.Provider>
  );
}
