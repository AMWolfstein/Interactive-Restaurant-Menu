"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  AUTH_SERVER_STATE,
  authenticatedFetch,
  clearAuthError,
  getAuthSnapshot,
  signInWithPassword,
  signOutFromCloud,
  subscribeAuth,
} from "./supabase-auth-core";
import type { AppRole } from "./server-auth-types";

/**
 * جلسة الموظف — نفس Supabase Auth بتاع اللوحة بالظبط (مفيش نظام دخول تاني).
 * الفرق الوحيد إننا بنسأل السيرفر عن دور الحساب بعد الدخول، لأن الدور
 * مصدره `app_metadata` عند Supabase والسيرفر هو اللي بيحسمه.
 *
 * الواجهة بتستخدم الدور للتوجيه وإخفاء الأزرار بس — الحماية الحقيقية على
 * السيرفر و RLS (أي endpoint إداري بيرفض invoice_staff بـ403).
 */
export interface StaffSession {
  configured: boolean;
  /** خلصنا قراءة الجلسة المحلية + التحقق من السيرفر */
  checked: boolean;
  authed: boolean;
  email: string | null;
  role: AppRole | null;
  busy: boolean;
  authError: string | null;
  /** السيرفر رفض الجلسة (توكن منتهي مثلاً) */
  serverError: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
}

export function useStaffSession(): StaffSession {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => AUTH_SERVER_STATE);
  const [role, setRole] = useState<AppRole | null>(null);
  const [verified, setVerified] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const authed = Boolean(auth.userId);

  useEffect(() => {
    if (!auth.checked) return;

    let cancelled = false;
    const run = async () => {
      if (!authed) {
        setRole(null);
        setServerError(null);
        setVerified(true);
        return;
      }
      setVerified(false);
      try {
        const response = await authenticatedFetch("/api/invoices/session", { cache: "no-store" });
        if (cancelled) return;
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setRole(null);
          setServerError(payload?.error ?? "الجلسة غير صالحة");
        } else {
          const payload = (await response.json()) as { role?: AppRole };
          setRole(payload.role === "invoice_staff" ? "invoice_staff" : "admin");
          setServerError(null);
        }
      } catch {
        if (!cancelled) setServerError("تعذّر الاتصال بالسيرفر");
      } finally {
        if (!cancelled) setVerified(true);
      }
    };

    // التحقق بيتم بعد الرندر — من غير setState متزامن جوه الـeffect
    const kick = setTimeout(() => void run(), 0);

    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, [auth.checked, authed, auth.userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    return signInWithPassword(email, password);
  }, []);

  const logout = useCallback(async () => {
    await signOutFromCloud();
    setRole(null);
  }, []);

  return {
    configured: auth.configured,
    checked: auth.checked && verified,
    authed,
    email: auth.email,
    role,
    busy: auth.busy,
    authError: auth.error,
    serverError,
    signIn,
    logout,
    clearAuthError,
  };
}
