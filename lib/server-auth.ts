import "server-only";

import type { NextRequest } from "next/server";
import { firebaseAdminAuth, firebaseProjectId } from "./firebase-admin";
import type { AppRole } from "./server-auth-types";

export type { AppRole } from "./server-auth-types";

export interface AdminUser {
  id: string;
  email: string;
  role: AppRole;
}

export type AdminCheck =
  | { ok: true; user: AdminUser }
  | { ok: false; status: 401 | 403 | 503; error: string };

const MISSING_SERVER_ENV = "إعدادات Firebase ناقصة على السيرفر";
const UNAUTHORIZED = "غير مصرّح — سجّل الدخول من لوحة التحكم";
const FORBIDDEN = "الحساب ده مالوش صلاحية على الجزء ده";

export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+([^\s]+)$/i.exec(header)?.[1];
  if (!token || token.length < 20 || token.length > 5000 || token.split(".").length !== 3) return null;
  return token;
}

export async function checkSession(token: string | null): Promise<AdminCheck> {
  if (!firebaseProjectId()) return { ok: false, status: 503, error: MISSING_SERVER_ENV };
  if (!token) return { ok: false, status: 401, error: UNAUTHORIZED };

  try {
    const claims = await firebaseAdminAuth().verifyIdToken(token, true);
    if (claims.email) {
      const role: AppRole = claims.role === "admin" || claims.role === "invoice_staff" ? claims.role : "unknown";
      return { ok: true, user: { id: claims.uid, email: claims.email, role } };
    }
  } catch {
    // Invalid, expired, revoked and disabled sessions fail closed.
  }
  return { ok: false, status: 401, error: UNAUTHORIZED };
}

export async function checkAdmin(token: string | null): Promise<AdminCheck> {
  const check = await checkSession(token);
  if (!check.ok) return check;
  if (check.user.role !== "admin") return { ok: false, status: 403, error: FORBIDDEN };
  return check;
}

export async function checkInvoiceStaff(token: string | null): Promise<AdminCheck> {
  const check = await checkSession(token);
  if (!check.ok) return check;
  if (check.user.role !== "admin" && check.user.role !== "invoice_staff") {
    return { ok: false, status: 403, error: FORBIDDEN };
  }
  return check;
}
