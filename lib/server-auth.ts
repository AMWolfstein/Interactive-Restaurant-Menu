import "server-only";

import type { NextRequest } from "next/server";

/**
 * مصادقة الأدمن على السيرفر.
 *
 * الطريقة الوحيدة المقبولة: Supabase Auth access token بيتبعت في هيدر
 * `Authorization: Bearer <token>` والسيرفر بيتحقق منه مباشرةً عند Supabase.
 * مفيش كوكيز جلسة محلية، مفيش رقم سري، ومفيش أي fallback —
 * أي طلب من غير توكن صالح بيرجع 401.
 */

const supabaseUrl = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const supabaseKey = () => (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseKey());
}

/**
 * أدوار المستخدمين:
 *   admin         → كل صلاحيات لوحة التحكم /admin
 *   invoice_staff → صفحة الفواتير /invoices فقط (قراءة الطلبات + تغيير حالتها)
 *
 * الدور مصدره الوحيد هو `app_metadata.role` في Supabase Auth — دي بيانات
 * السيرفر اللي المستخدم ما يقدرش يعدّلها من المتصفح (على عكس user_metadata).
 * أي حساب قديم من غير الحقل ده بيتعامل كـ admin عشان ما نكسرش الموجود.
 */
export type { AppRole } from "./server-auth-types";
import type { AppRole } from "./server-auth-types";

export interface AdminUser {
  id: string;
  email: string;
  role: AppRole;
}

/** نتيجة التحقق: يوزر صالح، أو null، أو سبب الرفض */
export type AdminCheck =
  | { ok: true; user: AdminUser }
  | { ok: false; status: 401 | 403 | 503; error: string };

export const MISSING_SERVER_ENV = "إعدادات Supabase ناقصة على السيرفر";
export const UNAUTHORIZED = "غير مصرّح — سجّل الدخول من لوحة التحكم";
export const FORBIDDEN = "الحساب ده مالوش صلاحية على الجزء ده";

/** كاش قصير للتحقق عشان منضربش Supabase مع كل طلب - 15 ثانية فقط لتقليل نافذة التوكن الملغي */
const TOKEN_CACHE_TTL = 15_000;
const NEGATIVE_CACHE_TTL = 5_000;
const MAX_CACHE_SIZE = 200;
const tokenCache = new Map<string, { user: AdminUser | null; expiresAt: number }>();

export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  // تحقق أساسي: JWT له 3 أجزاء مفصولة بنقطة وطول معقول
  if (token.length < 20 || token.length > 5000) return null;
  if (token.split(".").length !== 3) return null;
  return token;
}

async function verifyToken(token: string): Promise<AdminUser | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  let user: AdminUser | null = null;
  try {
    const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: supabaseKey() },
      cache: "no-store",
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        id?: string;
        email?: string;
        app_metadata?: { role?: string } | null;
      };
      if (payload.id && payload.email) {
        user = { id: payload.id, email: payload.email, role: roleOf(payload.app_metadata?.role) };
      }
    }
  } catch {
    // فشل الشبكة = رفض الطلب (fail closed)
    user = null;
  }

  // حماية من تضخم الذاكرة - LRU بسيط
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(token, { user, expiresAt: Date.now() + (user ? TOKEN_CACHE_TTL : NEGATIVE_CACHE_TTL) });
  return user;
}

/**
 * تحويل `app_metadata.role` لدور معروف.
 *
 *  - مفيش دور متسجّل خالص (null/undefined/"") → admin.
 *    ده توافق مع الحسابات القديمة اللي اتعملت قبل نظام الأدوار.
 *  - قيمة متسجّلة ومعروفة → الدور بتاعها.
 *  - قيمة متسجّلة بس **مش** معروفة ("invoicestaff"، "Invoice_Staff"، "kitchen") →
 *    `unknown`، ومحدش بياخد صلاحيات بيها. قبل كده كانت بترجع admin، يعني
 *    غلطة إملائية واحدة في لوحة Supabase كانت بتدّي موظف الفواتير أدمن كامل.
 */
function roleOf(value: unknown): AppRole {
  if (value === null || value === undefined || value === "") return "admin";
  if (value === "admin" || value === "invoice_staff") return value;
  return "unknown";
}

/** تحقق من التوكن من غير أي شرط على الدور */
export async function checkSession(token: string | null): Promise<AdminCheck> {
  if (!isSupabaseAuthConfigured()) return { ok: false, status: 503, error: MISSING_SERVER_ENV };
  if (!token) return { ok: false, status: 401, error: UNAUTHORIZED };
  const user = await verifyToken(token);
  if (!user) return { ok: false, status: 401, error: UNAUTHORIZED };
  return { ok: true, user };
}

/** التحقق الكامل من توكن الأدمن — موظف الفواتير بيترفض بـ403 */
export async function checkAdmin(token: string | null): Promise<AdminCheck> {
  const check = await checkSession(token);
  if (!check.ok) return check;
  if (check.user.role !== "admin") return { ok: false, status: 403, error: FORBIDDEN };
  return check;
}

/** الأدوار المسموح لها بفتح شاشة الفواتير */
const INVOICE_ROLES: readonly AppRole[] = ["admin", "invoice_staff"];

/**
 * صلاحية شاشة الفواتير: الأدمن أو موظف الفواتير.
 * بتُستخدم في /api/invoices/* بس — مش بتفتح أي وظيفة إدارية.
 *
 * الفحص على الدور صريح هنا عن قصد: `roleOf` حالياً بيرجّع `admin` لأي قيمة
 * غير معروفة، فلو اتضاف دور جديد بعدين (مطبخ، كاشير…) ما يدخلش الشاشة دي
 * تلقائياً من غير ما حد ياخد باله.
 */
export async function checkInvoiceStaff(token: string | null): Promise<AdminCheck> {
  const check = await checkSession(token);
  if (!check.ok) return check;
  if (!INVOICE_ROLES.includes(check.user.role)) {
    return { ok: false, status: 403, error: FORBIDDEN };
  }
  return check;
}
