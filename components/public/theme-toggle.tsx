"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { SiteLanguage, ThemeMode } from "@/lib/types";

export const VISITOR_THEME_KEY = "store-catalog:visitor-theme";

function isTheme(value: string | null): value is ThemeMode {
  return value === "dark" || value === "light";
}

export function visitorTheme(fallback: ThemeMode): ThemeMode {
  try {
    const saved = window.localStorage.getItem(VISITOR_THEME_KEY);
    return isTheme(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

/** اختيار شخصي للزائر، محفوظ على جهازه فقط ولا يغيّر إعداد المحل. */
export function ThemeToggle({ fallback, language }: { fallback: ThemeMode; language: SiteLanguage }) {
  const [theme, setTheme] = useState<ThemeMode>(fallback);
  const en = language === "en";

  useEffect(() => {
    // Read after hydration so the server and first client render stay identical.
    let active = true;
    queueMicrotask(() => {
      if (active) setTheme(visitorTheme(fallback));
    });
    return () => {
      active = false;
    };
  }, [fallback]);

  const toggle = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(VISITOR_THEME_KEY, next);
    } catch {
      // Private browsing/storage restrictions should not stop theme switching.
    }
  };

  const nextLabel = theme === "dark"
    ? (en ? "Switch to white theme" : "التبديل للستايل الأبيض")
    : (en ? "Switch to black theme" : "التبديل للستايل الأسود");

  return (
    <button
      type="button"
      onClick={toggle}
      title={nextLabel}
      aria-label={nextLabel}
      aria-pressed={theme === "light"}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition hover:border-accent/60 hover:text-accent"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
