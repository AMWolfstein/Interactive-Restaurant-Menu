import type { MenuItem, MenuVariant } from "./types";

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
  const endsAt = new Date(year, month - 1, day, 23, 59, 59, 999);
  return !Number.isNaN(endsAt.getTime()) && endsAt.getTime() >= now.getTime();
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
