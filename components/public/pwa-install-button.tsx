"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { SiteLanguage } from "@/lib/types";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithInstall extends Navigator {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<Array<{ id?: string; platform?: string; url?: string }>>;
}

const INSTALLED_KEY = "pwa-installed";

export function PwaInstallButton({ language }: { language: SiteLanguage }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  // `null` = still checking, so we never flash the button for installed users.
  const [installed, setInstalled] = useState<boolean | null>(null);
  const en = language === "en";

  useEffect(() => {
    let active = true;
    const nav = navigator as NavigatorWithInstall;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is an enhancement; the website must keep working if registration fails.
      });
    }

    const markInstalled = () => {
      try {
        window.localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        // Storage can be blocked; detection still works per session.
      }
      if (!active) return;
      setInstalled(true);
      setPromptEvent(null);
    };

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const isStandalone =
      standaloneQuery.matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      nav.standalone === true;

    let remembered = false;
    try {
      remembered = window.localStorage.getItem(INSTALLED_KEY) === "1";
    } catch {
      remembered = false;
    }

    if (isStandalone) {
      markInstalled();
    } else {
      setInstalled(remembered);
    }

    // Chromium can tell us the app is already installed even inside a normal tab.
    nav.getInstalledRelatedApps?.()
      .then((apps) => {
        if (active && apps.length > 0) markInstalled();
      })
      .catch(() => {
        // Not supported / not allowed: fall back to the other signals.
      });

    const onDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches) markInstalled();
    };
    standaloneQuery.addEventListener("change", onDisplayModeChange);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (!active) return;
      // The browser only fires this when the app is installable, i.e. not installed.
      try {
        window.localStorage.removeItem(INSTALLED_KEY);
      } catch {
        // ignore
      }
      setInstalled(false);
      setPromptEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", markInstalled);

    return () => {
      active = false;
      standaloneQuery.removeEventListener("change", onDisplayModeChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  if (installed !== false) return null;

  const install = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setPromptEvent(null);
      if (choice.outcome === "accepted") {
        try {
          window.localStorage.setItem(INSTALLED_KEY, "1");
        } catch {
          // ignore
        }
        setInstalled(true);
      }
      return;
    }

    window.alert(
      en
        ? "To install the app, open your browser menu and choose ‘Add to Home Screen’ or ‘Install app’."
        : "لتثبيت التطبيق، افتح قائمة المتصفح واختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».",
    );
  };

  return (
    <button
      type="button"
      onClick={install}
      title={en ? "Install app" : "تثبيت التطبيق"}
      aria-label={en ? "Install app" : "تثبيت التطبيق"}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11px] font-bold text-muted transition hover:border-accent/60 hover:text-accent"
    >
      <Download className="h-4 w-4" />
      <span className="hidden md:inline">{en ? "Install" : "تثبيت"}</span>
    </button>
  );
}
