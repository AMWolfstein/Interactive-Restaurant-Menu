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
import { refreshMenu } from "./menu-store-core";

/**
 * جلسة الأدمن — دخول حصري عن طريق Supabase Auth (إيميل + باسورد)
 * من الحساب الموجود في Supabase → Authentication → Users.
 *
 * بنسأل السيرفر كمان عن صلاحية الحساب: لو الحساب دوره invoice_staff
 * السيرفر بيرد 403 وكل الـAPI الإدارية بترفضه — فاللوحة بتوجّهه لـ/invoices
 * بدل ما تفتحله شاشة فاضية. الحماية الحقيقية على السيرفر و RLS.
 */
export function useAdminSession() {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => AUTH_SERVER_STATE);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const authed = Boolean(auth.userId);

  useEffect(() => {
    if (!auth.checked) return;

    let cancelled = false;
    const run = async () => {
      if (!authed) {
        setAllowed(null);
        return;
      }
      try {
        const response = await authenticatedFetch("/api/admin/session", { cache: "no-store" });
        if (!cancelled) setAllowed(response.ok);
      } catch {
        if (!cancelled) setAllowed(null);
      }
    };
    const kick = setTimeout(() => void run(), 0);

    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, [auth.checked, authed, auth.userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const ok = await signInWithPassword(email, password);
    if (ok) await refreshMenu();
    return ok;
  }, []);

  const logout = useCallback(async () => {
    await signOutFromCloud();
    window.location.reload();
  }, []);

  return {
    configured: auth.configured,
    authed,
    /** السيرفر رفض الحساب ده كأدمن (غالباً موظف فواتير) */
    forbidden: authed && allowed === false,
    checked: auth.checked,
    signIn,
    logout,
    email: auth.email,
    busy: auth.busy,
    authError: auth.error,
    clearAuthError,
  };
}
