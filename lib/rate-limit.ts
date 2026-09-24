/**
 * Rate limiting بمخزن مشترك (Upstash Redis) مع رجوع تلقائي للذاكرة.
 *
 * ليه المخزن المشترك؟ على Vercel كل انستانس سيرفرلس عنده ذاكرته لوحده، يعني
 * الحد الفعلي كان = الحد × عدد الانستانسات النشطة. مهاجم بيوزّع الطلبات
 * كان بياخد أضعاف الحد المفروض.
 *
 * الإعداد: حط `UPSTASH_REDIS_REST_URL` و`UPSTASH_REDIS_REST_TOKEN` في
 * متغيرات البيئة. من غيرهم النظام بيشتغل بالذاكرة زي الأول (مناسب للتطوير
 * المحلي وللنشر على سيرفر واحد).
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * سقف لعدد المفاتيح المخزّنة في الذاكرة. من غيره أي مهاجم بيغيّر الـ IP
 * كل طلب يقدر يكبّر الـ Map لحد ما الذاكرة تخلص — يعني أداة الحماية نفسها
 * تبقى هي الثغرة.
 */
const MAX_BUCKETS = 10_000;

/** بادئة مفاتيح Redis عشان ما تتلخبطش مع أي بيانات تانية في نفس القاعدة */
const REDIS_PREFIX = "rl:";

/** مهلة نداء Redis — أي تأخير أطول من كده بيرجّعنا للذاكرة بدل ما نعطّل الطلب */
const REDIS_TIMEOUT_MS = 1000;

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
  /** المخزن اللي اتأخد منه القرار — مفيد للتشخيص */
  store: "redis" | "memory";
}

function redisConfig(): { url: string; token: string } | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  return url && token ? { url, token } : null;
}

/** هل المخزن المشترك مفعّل؟ (بيتعرض في /api/admin/session للتشخيص) */
export function isSharedRateLimitEnabled(): boolean {
  return redisConfig() !== null;
}

/**
 * تنظيف المفاتيح المنتهية من ذاكرة الانستانس.
 *
 * بيتنادى مع الطلبات بدل `setInterval` على مستوى الموديول: التايمر الدوري
 * كان بيفضل شغال طول عمر الانستانس ومش بيتلغي أبداً، وفي بيئة سيرفرلس
 * مفيش منه فايدة لأن الانستانس أصلاً بيموت.
 */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of sorted.slice(0, buckets.size - MAX_BUCKETS)) buckets.delete(key);
  }
}

/** العدّاد في ذاكرة الانستانس — الأساس محلياً والاحتياطي لو Redis وقع */
function memoryLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    const resetAt = now + config.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { success: true, remaining: config.limit - 1, resetAt, store: "memory" };
  }

  if (bucket.count >= config.limit) {
    return { success: false, remaining: 0, resetAt: bucket.resetAt, store: "memory" };
  }

  bucket.count++;
  return {
    success: true,
    remaining: config.limit - bucket.count,
    resetAt: bucket.resetAt,
    store: "memory",
  };
}

/**
 * نافذة ثابتة على Redis عبر الـ REST API.
 *
 * ثلاث أوامر في نداء واحد:
 *   SET key 0 PX windowMs NX  ← يبدأ النافذة لو مش موجودة
 *   INCR key                  ← يزوّد العدّاد ويرجّع القيمة الجديدة
 *   PTTL key                  ← الباقي على انتهاء النافذة
 */
async function redisLimit(
  key: string,
  config: RateLimitConfig,
  redis: { url: string; token: string },
): Promise<RateLimitResult | null> {
  const redisKey = `${REDIS_PREFIX}${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);

  try {
    const response = await fetch(`${redis.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${redis.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["SET", redisKey, "0", "PX", String(config.windowMs), "NX"],
        ["INCR", redisKey],
        ["PTTL", redisKey],
      ]),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const parsed = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(parsed) || parsed.length < 3) return null;
    if (parsed.some((entry) => entry?.error)) return null;

    const count = Number(parsed[1]?.result);
    let ttl = Number(parsed[2]?.result);
    if (!Number.isFinite(count)) return null;

    // -1 = المفتاح من غير انتهاء (سباق نادر بين SET وINCR) — نصلّحها
    if (!Number.isFinite(ttl) || ttl < 0) ttl = config.windowMs;

    const resetAt = Date.now() + ttl;
    if (count > config.limit) {
      return { success: false, remaining: 0, resetAt, store: "redis" };
    }
    return {
      success: true,
      remaining: Math.max(0, config.limit - count),
      resetAt,
      store: "redis",
    };
  } catch {
    // شبكة/مهلة — نرجّع null والمنادي هيستخدم الذاكرة
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * تطبيق الحد على مفتاح.
 *
 * بيستخدم Redis لو متظبط، وبيرجع للذاكرة لو مش متظبط أو لو النداء فشل.
 * الرجوع للذاكرة (fail-open جزئي) مقصود: إن Redis يقع مش سبب كافي إن
 * الموقع كله يقف — والذاكرة بتفضل تحمي من الإغراق من نفس الانستانس.
 */
export async function rateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const redis = redisConfig();
  if (redis) {
    const result = await redisLimit(key, config, redis);
    if (result) return result;
    console.warn("[rate-limit] Redis غير متاح — الرجوع لعدّاد الذاكرة");
  }
  return memoryLimit(key, config);
}

/** للاختبارات فقط — بيفضّي عدّادات الذاكرة */
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
