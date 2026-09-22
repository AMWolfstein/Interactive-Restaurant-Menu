"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

function readRemembered(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    // Storage can be blocked; detection still works per session.
    return false;
  }
}

function rememberInstalled() {
  try {
    window.localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    // ignore
  }
}

function forgetInstalled() {
  try {
    window.localStorage.removeItem(INSTALLED_KEY);
  } catch {
    // ignore
  }
}

/**
 * مخزن خارجي لحالة «التطبيق متثبت؟» — المصادر: display-mode media queries،
 * حدث appinstalled، getInstalledRelatedApps (كروميوم)، وذاكرة localStorage.
 * بنستخدم useSyncExternalStore بدل setState جوه useEffect عشان نتفادى
 * الرندر المتتالي واختلاف SSR/CSR في نفس الوقت.
 */
const installedListeners = new Set<() => void>();
let relatedAppsInstalled = false;
let relatedAppsChecked = false;

function emitInstalledChange() {
  for (const listener of installedListeners) listener();
}

function markInstalled() {
  rememberInstalled();
  relatedAppsInstalled = true;
  emitInstalledChange();
}

function subscribeInstalled(onChange: () => void): () => void {
  installedListeners.add(onChange);

  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const onDisplayModeChange = (event: MediaQueryListEvent) => {
    if (event.matches) rememberInstalled();
    emitInstalledChange();
  };
  standaloneQuery.addEventListener("change", onDisplayModeChange);

  const onAppInstalled = () => markInstalled();
  window.addEventListener("appinstalled", onAppInstalled);

  // Chromium can tell us the app is already installed even inside a normal tab.
  if (!relatedAppsChecked) {
    relatedAppsChecked = true;
    const nav = navigator as NavigatorWithInstall;
    nav.getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps.length > 0) markInstalled();
      })
      .catch(() => {
        // Not supported / not allowed: fall back to the other signals.
      });
  }

  return () => {
    installedListeners.delete(onChange);
    standaloneQuery.removeEventListener("change", onDisplayModeChange);
    window.removeEventListener("appinstalled", onAppInstalled);
  };
}

function getInstalledSnapshot(): boolean {
  const nav = navigator as NavigatorWithInstall;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    nav.standalone === true;
  return isStandalone || relatedAppsInstalled || readRemembered();
}

// على السيرفر (وأثناء الـ hydration) بنعتبره متثبت — فالزرار مايظهرش فجأة لمستخدم مثبّت.
function getInstalledServerSnapshot(): boolean {
  return true;
}

export function PwaInstallButton({ language }: { language: SiteLanguage }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const installed = useSyncExternalStore(
    subscribeInstalled,
    getInstalledSnapshot,
    getInstalledServerSnapshot,
  );
  const en = language === "en";

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is an enhancement; the website must keep working if registration fails.
      });
    }

    // بنثبّت الذاكرة لو المستخدم فاتح فعلاً من التطبيق المثبت.
    if (getInstalledSnapshot()) rememberInstalled();

    const onPrompt = (event: Event) => {
      event.preventDefault();
      // The browser only fires this when the app is installable, i.e. not installed.
      forgetInstalled();
      relatedAppsInstalled = false;
      emitInstalledChange();
      setPromptEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed) return null;

  const install = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setPromptEvent(null);
      if (choice.outcome === "accepted") markInstalled();
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
