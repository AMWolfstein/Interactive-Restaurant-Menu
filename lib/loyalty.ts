import type { LoyaltySettings, LoyaltySnapshot } from "./types";

/**
 * نظام «كاشك» — مكافأة الولاء المبنية على إجمالي مشتريات العميل.
 *
 * الفكرة: كل طلب بيزوّد رصيد العميل بقيمة الأصناف (subtotal) — من غير التوصيل
 * ورسوم الخدمة. أول ما الرصيد يوصل للحد (٥٠٠٠ ج افتراضياً) يستحق العميل خصم
 * (٥٪ افتراضياً) على **الطلب اللي بعده**، وساعتها بيتخصم الحد من رصيده
 * والزيادة بتترحّل للدورة الجديدة (مش بتضيع عليه).
 *
 * مثال: عميل رصيده ٥٦٠٠ ← الطلب الجاي ياخد ٥٪ ورصيده يرجع ٦٠٠ + قيمة الطلب ده.
 *
 * ⚠️ الحساب الحقيقي اللي الفاتورة بتتبني عليه بيحصل في قاعدة البيانات
 * (دالة place_order) — الدوال هنا للعرض في الواجهة ولمخزن الملف المحلي فقط.
 * أي حساب في المتصفح ممكن العميل يتلاعب فيه، فمينفعش يكون هو المصدر.
 */

/** الحد الأقصى المسموح بيه للنسبة — حماية من إدخال ١٠٠٪ بالغلط */
export const MAX_LOYALTY_PERCENT = 50;
/** الحد الأقصى لعتبة المكافأة */
export const MAX_LOYALTY_THRESHOLD = 1_000_000;

/**
 * توحيد صيغة رقم الموبايل — ده مفتاح العميل في نظام كاشك.
 *
 * من غير التوحيد ده هيبقى «+201012345678» و«0101 234 5678» و«01012345678»
 * تلات عملاء مختلفين، وكل واحد بيجمع رصيد لوحده والنظام كله يبوظ.
 *
 * القاعدة: نشيل أي حاجة مش رقم، ونحوّل الصيغة الدولية المصرية لصيغة محلية:
 *   +20 10 1234 5678 / 0020101… / 20101…  ←  01012345678
 */
export function normalizePhone(input: string): string {
  let digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  // 00 بادئة دولية ← شيلها
  if (digits.startsWith("00")) digits = digits.slice(2);
  // كود مصر 20 متبوع بـ 1 (موبايل) ← رجّعه لصيغة 01…
  if (digits.startsWith("20") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  // رقم موبايل من غير الصفر البادئ (1012345678) ← ضيف الصفر
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  return digits.slice(0, 20);
}

/** هل رقم الموبايل ده صالح كمفتاح عميل؟ (أرقام قصيرة جداً مش معتبرة) */
export function isUsablePhone(input: string): boolean {
  return normalizePhone(input).length >= 8;
}

export interface LoyaltyStatus {
  /** هل النظام شغّال أصلاً */
  enabled: boolean;
  /** رصيد العميل الحالي ناحية العتبة */
  balance: number;
  /** العتبة المطلوبة للمكافأة */
  threshold: number;
  /** نسبة الخصم */
  percent: number;
  /** هل العميل مستحق خصم على الطلب الحالي */
  eligible: boolean;
  /** فاضل كام جنيه على المكافأة الجاية (0 لو مستحق) */
  remaining: number;
  /** نسبة التقدّم 0–100 للعرض في شريط التقدّم */
  progress: number;
}

/** حالة العميل للعرض في الواجهة (السلة / صفحة العميل) */
export function loyaltyStatus(settings: LoyaltySettings, balance: number): LoyaltyStatus {
  const threshold = Math.max(1, settings.threshold);
  const safeBalance = Math.max(0, Number(balance) || 0);
  const eligible = settings.enabled && safeBalance >= threshold;
  return {
    enabled: settings.enabled,
    balance: safeBalance,
    threshold,
    percent: settings.percent,
    eligible,
    remaining: eligible ? 0 : Math.max(0, threshold - safeBalance),
    progress: Math.min(100, Math.round((safeBalance / threshold) * 100)),
  };
}

/**
 * حساب خصم كاشك لطلب واحد — نفس المنطق الموجود في دالة place_order بالظبط.
 * بيرجّع null لو النظام مقفول أو العميل مش مستحق.
 *
 * @param subtotal قيمة الأصناف قبل التوصيل والخدمة (الخصم بيتحسب عليها بس)
 * @param balance  رصيد العميل قبل الطلب ده
 */
export function computeLoyaltyDiscount(
  settings: LoyaltySettings,
  subtotal: number,
  balance: number,
): LoyaltySnapshot | null {
  if (!settings.enabled) return null;
  const threshold = Math.max(1, settings.threshold);
  const balanceBefore = Math.max(0, Number(balance) || 0);
  if (balanceBefore < threshold) return null;

  const base = Math.max(0, Number(subtotal) || 0);
  const discount = Math.round((base * settings.percent) / 100);
  // الزيادة فوق العتبة بتترحّل للدورة الجديدة — العميل مش بيخسرها
  const carried = balanceBefore - threshold;

  return {
    discount,
    percent: settings.percent,
    threshold,
    balanceBefore,
    // الرصيد بعد الطلب = المرحّل + قيمة الطلب ده
    balanceAfter: carried + base,
  };
}

/**
 * الرصيد الجديد بعد تسجيل طلب — للحالة العادية (من غير مكافأة).
 * الطلبات الملغية مش بتتحسب، فالإلغاء بيرجّع القيمة دي.
 */
export function nextBalance(balance: number, subtotal: number): number {
  return Math.max(0, (Number(balance) || 0) + Math.max(0, Number(subtotal) || 0));
}
