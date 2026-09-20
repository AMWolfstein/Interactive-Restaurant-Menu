import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { removePushSubscription, savePushSubscription } from "@/lib/push-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionBody = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

function validSubscription(body: SubscriptionBody | null): body is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!body || typeof body.endpoint !== "string" || typeof body.keys?.p256dh !== "string" || typeof body.keys.auth !== "string") return false;
  if (body.endpoint.length < 20 || body.endpoint.length > 2_000 || body.keys.p256dh.length < 20 || body.keys.p256dh.length > 400 || body.keys.auth.length < 8 || body.keys.auth.length > 200) return false;
  try {
    return new URL(body.endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const allowed = rateLimit(`push-subscribe:${ip}`, { limit: 8, windowMs: 60 * 60_000 });
  if (!allowed.success) return NextResponse.json({ error: "محاولات كثيرة — حاول لاحقًا" }, { status: 429 });

  const body = await request.json().catch(() => null) as SubscriptionBody | null;
  if (!validSubscription(body)) return NextResponse.json({ error: "بيانات اشتراك الإشعارات غير صالحة" }, { status: 400 });
  try {
    await savePushSubscription(body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[push] subscribe failed", error);
    return NextResponse.json({ error: "خدمة الإشعارات غير مضبوطة حالياً" }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request);
  const allowed = rateLimit(`push-unsubscribe:${ip}`, { limit: 12, windowMs: 60 * 60_000 });
  if (!allowed.success) return NextResponse.json({ error: "محاولات كثيرة — حاول لاحقًا" }, { status: 429 });

  const body = await request.json().catch(() => null) as SubscriptionBody | null;
  if (!validSubscription(body)) return NextResponse.json({ error: "بيانات اشتراك الإشعارات غير صالحة" }, { status: 400 });
  try {
    await removePushSubscription(body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[push] unsubscribe failed", error);
    return NextResponse.json({ error: "تعذّر إلغاء اشتراك الإشعارات" }, { status: 503 });
  }
}
