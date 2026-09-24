import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { bearerToken, checkInvoiceStaff, type AdminUser } from "./server-auth";
import { getClientIp, rateLimit, LIMITS } from "./rate-limit";

/**
 * حارس صفحة الفواتير على السيرفر.
 *
 * كل endpoint تحت /api/invoices بيعدّي من هنا: لازم Supabase access token صالح
 * لحساب دوره `admin` أو `invoice_staff`. الدور بيتقرا من `app_metadata` عند
 * Supabase نفسه — مش من أي حاجة الواجهة بتبعتها، فتعديل الـURL أو الـlocalStorage
 * مش بيدّي أي صلاحية.
 *
 * ملاحظة مهمة: ده بيفتح الطلبات بس. أي endpoint إداري (المنتجات، الأسعار،
 * الإعدادات، النسخ الاحتياطية) لسه بيستخدم checkAdmin وبيرفض موظف الفواتير بـ403.
 */
export interface InvoiceGuardOk {
  ok: true;
  user: AdminUser;
  token: string;
}

export type InvoiceGuard = InvoiceGuardOk | { ok: false; response: NextResponse };

export async function guardInvoiceRequest(
  request: NextRequest,
  options: { rateKey: string; limit?: typeof LIMITS.menuSave } = { rateKey: "invoices" },
): Promise<InvoiceGuard> {
  const token = bearerToken(request);
  const check = await checkInvoiceStaff(token);
  if (!check.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: check.error }, { status: check.status }),
    };
  }

  const ip = getClientIp(request);
  const rl = await rateLimit(`${options.rateKey}:${ip}:${check.user.id}`, options.limit ?? LIMITS.menuSave);
  if (!rl.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "طلبات كثيرة - حاول بعد دقيقة" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      ),
    };
  }

  return { ok: true, user: check.user, token: token as string };
}
