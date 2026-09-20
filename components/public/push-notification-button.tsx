"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, LoaderCircle } from "lucide-react";
import type { SiteLanguage } from "@/lib/types";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function toApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function available() {
  return Boolean(VAPID_PUBLIC_KEY && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
}

export function PushNotificationButton({ language }: { language: SiteLanguage }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const en = language === "en";

  useEffect(() => {
    if (!available()) return;
    const timer = window.setTimeout(() => setSupported(true), 0);
    navigator.serviceWorker.register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(Boolean(subscription)))
      .catch(() => window.setTimeout(() => setSupported(false), 0));
    return () => window.clearTimeout(timer);
  }, []);

  const toggle = async () => {
    if (!available() || busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        const json = existing.toJSON();
        await fetch("/api/push-subscription", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json),
        });
        await existing.unsubscribe();
        setSubscribed(false);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(VAPID_PUBLIC_KEY),
      });
      const response = await fetch("/api/push-subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        // لا نترك اشتراكاً محلياً وهمياً لو الخادم لم يحفظه.
        await subscription.unsubscribe();
        throw new Error("لم يتم حفظ الاشتراك");
      }
      setSubscribed(true);
    } catch {
      window.alert(en ? "Notifications could not be enabled. Please try again later." : "تعذّر تفعيل الإشعارات حالياً. جرّب مرة أخرى لاحقاً.");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;
  const label = subscribed
    ? (en ? "Turn off offer notifications" : "إلغاء إشعارات العروض")
    : (en ? "Get offer notifications" : "تفعيل إشعارات العروض");

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition hover:border-accent/60 hover:text-accent disabled:opacity-55"
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : subscribed ? <Bell className="h-4 w-4 fill-current text-accent" /> : <BellOff className="h-4 w-4" />}
    </button>
  );
}
