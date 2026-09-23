import { STORE_TIMEZONE } from "./schedule";
import type { MenuItem, MenuVariant } from "./types";

/**
 * نهاية اليوم المحدّد بتوقيت المحل، كـ timestamp مطلق.
 *
 * `new Date(y, m, d, 23, 59, 59)` بتتفسّر بتوقيت الجهاز — يعني السيرفر (UTC)
 * والزائر (القاهرة) كانوا بيحسبوا لحظتين مختلفتين، فالعرض يبان منتهي في
 * الصفحة المولّدة على السيرفر وشغّال على الموبايل (أو العكس) لمدة ساعات.
 * بنثبّت الحساب على توقيت المحل زي باقي التطبيق.
 */
function endOfDayInStoreTz(year: number, month: number, day: number): number {
  // نبدأ بتقدير بتوقيت UTC، وبعدين نصحّح بفرق المنطقة الزمنية في اليوم ده
  const guess = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const offsetMinutes = tzOffsetMinutes(new Date(guess), STORE_TIMEZONE);
  return guess - offsetMinutes * 60_000;
}

/** فرق المنطقة الزمنية بالدقايق عند لحظة معيّنة (بيراعي التوقيت الصيفي) */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * العرض صالح فقط لو سعره القديم أعلى من الجديد ولم يمر تاريخ الانتهاء.
 * بنستخدمها في الواجهة والسيرفر عشان العروض المعروضة والإشعارات يفضلوا متطابقين.
 */
export function isDiscountActive(
  price: number,
  oldPrice?: number | null,
  end?: { day?: number | null; month?: number | null; year?: number | null },
  now = new Date(),
): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(oldPrice) || !oldPrice || oldPrice <= price) return false;
  const { day, month, year } = end ?? {};
  // عدم إدخال تاريخ = عرض مستمر إلى أن يوقفه صاحب المتجر.
  if (!day || !month || !year) return true;
  const endsAt = endOfDayInStoreTz(year, month, day);
  return Number.isFinite(endsAt) && endsAt >= now.getTime();
}

export function isVariantOnOffer(variant: MenuVariant, now?: Date): boolean {
  return isDiscountActive(variant.price, variant.oldPrice, {
    day: variant.offerEndDay,
    month: variant.offerEndMonth,
    year: variant.offerEndYear,
  }, now);
}

export function isItemOnOffer(item: MenuItem, now?: Date): boolean {
  return isDiscountActive(item.price, item.oldPrice, {
    day: item.offerEndDay,
    month: item.offerEndMonth,
    year: item.offerEndYear,
  }, now) || Boolean(item.variants?.some((variant) => isVariantOnOffer(variant, now)));
}

export function offerPercent(price: number, oldPrice?: number | null): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}
