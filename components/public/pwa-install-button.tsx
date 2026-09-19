"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { SiteLanguage } from "@/lib/types";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaInstallButton({ language }: { language: SiteLanguage }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const en = language === "en";

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is an enhancement; the website must keep working if registration fails.
      });
    }

    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) queueMicrotask(() => setInstalled(true));

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      setPromptEvent(null);
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
