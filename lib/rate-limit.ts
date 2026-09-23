/**
 * Rate limiting بسيط في الذاكرة.
 *
 * ⚠️ حدود المنهج ده: الذاكرة مش مشتركة بين انستانسات السيرفرلس، فكل انستانس
 * بيعدّ لوحده. يعني الحد الفعلي = الحد × عدد الانستانسات النشطة. ده مقبول
 * كطبقة أولى ضد الإغراق، لكنه مش بديل عن WAF أو مخزن مشترك (Redis /
 * Upstash) لو الموقع بقى تحت ضغط حقيقي.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * سقف لعدد المفاتيح المخزّنة. من غيره أي مهاجم بيغيّر الـ IP (أو الهيدر)
 * كل طلب يقدر يكبّر الـ Map لحد ما الذاكرة تخلص — يعني أداة الحماية نفسها
 * تبقى هي الثغرة.
 */
const MAX_BUCKETS = 10_000;

/**
 * تنظيف المفاتيح المنتهية.
 *
 * بيتنادى مع الطلبات بدل `setInterval` على مستوى الموديول: التايمر الدوري
 * كان بيفضل شغال طول عمر الانستانس ومش بيتلغي أبداً، وفي بيئة سيرفرلس
 * بيمنع التجميد أحياناً — ومفيش منه فايدة لأن الانستانس أصلاً بيموت.
 */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
  // لو لسه فوق السقف بعد التنظيف، امسح الأقدم انتهاءً
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of sorted.slice(0, buckets.size - MAX_BUCKETS)) buckets.delete(key);
  }
}

export interface RateLimitConfig {
  /** العدد المسموح */
  limit: number;
  /** المدة بالمللي ثانية */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    // التنظيف بيحصل بس لما الـ Map تكبر — مش على كل طلب
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    const resetAt = now + config.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { success: true, remaining: config.limit - 1, resetAt };
  }

  if (bucket.count >= config.limit) {
    return { success: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count++;
  return { success: true, remaining: config.limit - bucket.count, resetAt: bucket.resetAt };
}

/** للاختبارات فقط — بيفضّي العدّادات كلها */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * IP العميل من هيدرات البروكسي.
 *
 * ملحوظة أمنية: الهيدرات دي العميل يقدر يزوّرها، وإحنا بناخد أول قيمة في
 * `x-forwarded-for` (اللي المفروض تكون العميل الأصلي). ده آمن بس لو التطبيق
 * شغال ورا بروكسي بيكتب الهيدر ده بنفسه — زي Vercel. لو اتنشر من غير بروكسي
 * موثوق، أي حد يقدر يتخطى الحد بتزوير الهيدر.
 */
export function getClientIp(request: Request): string {
  // Vercel بيحط الهيدر ده وما بيسمحش للعميل يزوّره
  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  if (vercelIp) return vercelIp.split(",")[0]!.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

// إعدادات جاهزة
export const LIMITS = {
  /** 5 طلبات / دقيقة لكل IP */
  orders: { limit: 5, windowMs: 60_000 },
  /** 10 محاولات دخول / 15 دقيقة */
  auth: { limit: 10, windowMs: 15 * 60_000 },
  /** 20 تعديل كتالوج / دقيقة للأدمن */
  menuSave: { limit: 20, windowMs: 60_000 },
  /** 15 استعلام رصيد كاشك / دقيقة — يمنع استخدام النقطة دي لتخمين الأرقام */
  loyalty: { limit: 15, windowMs: 60_000 },
} as const;
