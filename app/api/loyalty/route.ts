import { NextRequest, NextResponse } from "next/server";
import { getLoyaltyStatus, StoreError } from "@/lib/server-database";
import { getClientIp, rateLimit, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * رصيد «كاشك» لعميل بالموبايل — بتستخدمه السلة عشان تعرض للعميل موقفه
 * من المكافأة قبل ما يبعت الطلب.
 *
 * الرد بيحتوي على أرقام الرصيد بس (الرصيد / العتبة / الباقي) — من غير اسم
 * العميل أو عنوانه أو تاريخ طلباته، عشان معرفة رقم موبايل متبقاش وسيلة
 * للوصول لبيانات صاحبه. ومحمي بـ rate limit ضد تجريب أرقام بالجملة.
 *
 * ⚠️ الرد ده للعرض بس — الخصم الحقيقي بيتحسب في قاعدة البيانات وقت تسجيل
 * الطلب، فالتلاعب في القيم دي من المتصفح مش بيغيّر الفاتورة.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`loyalty:${ip}`, LIMITS.loyalty);
  if (!rl.success) {
    return NextResponse.json(
      { error: "طلبات كثيرة - حاول بعد دقيقة" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = (await request.json()) as { phone?: string };
    const status = await getLoyaltyStatus(String(body.phone ?? "").slice(0, 30));
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر قراءة الرصيد" },
      { status },
    );
  }
}
