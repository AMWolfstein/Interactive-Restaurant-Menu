import { after, NextRequest, NextResponse } from "next/server";
import { getMenu, replaceMenu, StoreError } from "@/lib/server-database";
import { bearerToken, checkAdmin } from "@/lib/server-auth";
import { rateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";
import { notifyCatalogChanges } from "@/lib/push-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** قراءة الكتالوج متاحة لكل العملاء. */
export async function GET() {
  try {
    return NextResponse.json(await getMenu(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 500;
    const message = status >= 500 ? "تعذّر قراءة الكتالوج" : error instanceof Error ? error.message : "تعذّر قراءة الكتالوج";
    return NextResponse.json({ error: message }, { status });
  }
}

/** تعديل الكتالوج — للأدمن فقط بعد التحقق من Firebase ID token على السيرفر */
export async function PUT(request: NextRequest) {
  const token = bearerToken(request);
  const check = await checkAdmin(token);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  // Rate limiting للأدمن (20 حفظ / دقيقة لكل IP وحساب)
  const ip = getClientIp(request);
  const rl = await rateLimit(`menu-save:${ip}:${check.user.id}`, LIMITS.menuSave);
  if (!rl.success) {
    return NextResponse.json(
      { error: "محاولات حفظ كثيرة - حاول بعد دقيقة" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = await request.json();
    if (JSON.stringify(body).length > 4_000_000) {
      return NextResponse.json({ error: "البيانات كبيرة جداً (الحد 4MB)" }, { status: 413 });
    }
    // نقرأ اللقطة السابقة قبل الحفظ لاكتشاف منتج أو عرض جديد للإشعارات.
    const before = await getMenu();
    const menu = await replaceMenu(body, token);
    // after يبقي العمل ممتداً بعد الرد؛ لا نجعل مزود Push يبطّئ حفظ الأدمن.
    after(() => notifyCatalogChanges(before, menu));
    return NextResponse.json(menu, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 400;
    const message = status >= 500 ? "خطأ في الخادم" : error instanceof Error ? error.message : "بيانات الكتالوج غير صالحة";
    return NextResponse.json({ error: message }, { status });
  }
}
