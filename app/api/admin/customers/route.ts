import { NextRequest, NextResponse } from "next/server";
import { getCustomerOrders, listCustomers, StoreError } from "@/lib/server-database";
import { bearerToken, checkAdmin } from "@/lib/server-auth";
import { getClientIp, rateLimit, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * عملاء نظام «كاشك» — للأدمن فقط.
 *
 *   GET /api/admin/customers?q=0101          ← بحث في العملاء (على السيرفر)
 *   GET /api/admin/customers?phone=0101…     ← كل طلبات عميل واحد + ملفه
 *
 * البحث هنا بيتم في قاعدة البيانات مش في المتصفح، فمش مقيّد بآخر ٥٠٠ طلب
 * زي البحث القديم في جدول الطلبات.
 */
export async function GET(request: NextRequest) {
  const token = bearerToken(request);
  const check = await checkAdmin(token);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const ip = getClientIp(request);
  const rl = await rateLimit(`customers:${ip}`, LIMITS.menuSave);
  if (!rl.success) {
    return NextResponse.json(
      { error: "طلبات كثيرة - حاول بعد دقيقة" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const params = request.nextUrl.searchParams;
  const phone = (params.get("phone") ?? "").slice(0, 30);

  try {
    // ملف عميل واحد + تاريخ مشترياته الكامل
    if (phone) {
      const [orders, matches] = await Promise.all([
        getCustomerOrders(phone, token),
        listCustomers(phone, token, 1),
      ]);
      return NextResponse.json(
        { customer: matches[0] ?? null, orders },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const customers = await listCustomers(params.get("q") ?? "", token);
    return NextResponse.json({ customers }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر قراءة بيانات العملاء" },
      { status },
    );
  }
}
