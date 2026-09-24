import { NextRequest, NextResponse } from "next/server";
import { setOrderStatus, StoreError } from "@/lib/server-database";
import { bearerToken, checkAdmin } from "@/lib/server-auth";
import { getClientIp, rateLimit, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * تحديث حالة طلب (جديد / ملغي) — للأدمن فقط.
 * أي طلب جه من الموقع هيتنفذ، فالإجراء الوحيد هو الإلغاء (أو الإرجاع جديد).
 * محمي بـ Supabase access token + Rate limiting.
 */
export async function PATCH(request: NextRequest) {
  const token = bearerToken(request);
  const check = await checkAdmin(token);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const ip = getClientIp(request);
  const rl = await rateLimit(`orders-status:${ip}`, LIMITS.menuSave);
  if (!rl.success) {
    return NextResponse.json(
      { error: "طلبات كثيرة - حاول بعد دقيقة" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as { orderId?: string; status?: string };
    const order = await setOrderStatus(body.orderId ?? "", body.status ?? "", token);
    return NextResponse.json({ order });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تحديث الطلب" },
      { status },
    );
  }
}
