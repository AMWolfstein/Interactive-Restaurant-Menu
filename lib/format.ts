import type {
  CartLine,
  CommerceSettings,
  DeliveryZone,
  MenuItem,
  OrderStatus,
  OrderType,
  SiteLanguage,
} from "./types";

export const ORDER_TYPE_LABEL: Record<OrderType, { ar: string; en: string }> = {
  delivery: { ar: "توصيل", en: "Delivery" },
  pickup: { ar: "استلام من المحل", en: "Pickup" },
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, { ar: string; en: string }> = {
  new: { ar: "جديد", en: "New" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
};

/**
 * حالة الطلب مع التوافق مع الطلبات القديمة:
 * اللي ملهاش status (قبل ميزة الحالات) أو محفوظة بحالة قديمة
 * (confirmed/delivered اللي اتشالوا) بتتعامل كـ «new» — طالما الطلب
 * مش ملغي يبقى شغال، لأن أي طلب جه من الموقع هيتنفذ.
 */
export function orderStatusOf(order: { status?: string }): OrderStatus {
  return order.status === "cancelled" ? "cancelled" : "new";
}

/** يرجّع النص المناسب للغة الحالية مع رجوع للغة التانية لو فاضية */
export function pick(
  lang: SiteLanguage,
  ar: string | undefined,
  en: string | undefined,
): string {
  if (lang === "en") return (en?.trim() || ar || "").trim();
  return (ar?.trim() || en || "").trim();
}

export function formatPrice(value: number, lang: SiteLanguage, commerce: CommerceSettings) {
  const amount = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const num = amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const unit = lang === "en" ? commerce.currencyEn : commerce.currency;
  return lang === "en" ? `${unit} ${num}` : `${num} ${unit}`;
}

export interface CartTotals {
  subtotal: number;
  delivery: number;
  service: number;
  total: number;
  itemCount: number;
  freeDeliveryGap: number;
  /** خصم «كاشك» المطبّق على الطلب ده (٠ = مفيش) */
  discount: number;
}

/**
 * @param discount خصم «كاشك» لو العميل مستحق — بيتخصم من قيمة الأصناف قبل
 *                 حساب رسوم الخدمة، والتوصيل مش بيتأثر بيه.
 *                 ده للعرض في السلة بس؛ الفاتورة الحقيقية بتتحسب في الداتابيز.
 */
export function computeTotals(
  lines: { line: CartLine; item: MenuItem }[],
  commerce: CommerceSettings,
  orderType: OrderType,
  zone?: DeliveryZone | null,
  discount = 0,
): CartTotals {
  const subtotal = lines.reduce((sum, { line, item }) => sum + item.price * line.quantity, 0);
  const itemCount = lines.reduce((sum, { line }) => sum + line.quantity, 0);
  const isDelivery = orderType === "delivery";
  const qualifiesFree =
    isDelivery && commerce.freeDeliveryOver > 0 && subtotal >= commerce.freeDeliveryOver;
  // لو فيه منطقة توصيل مختارة، رسومها هي اللي بتتحسب بدل الرسوم العامة
  const baseDeliveryFee = zone ? Math.max(0, zone.fee) : Math.max(0, commerce.deliveryFee);
  const delivery = isDelivery && !qualifiesFree ? baseDeliveryFee : 0;
  const safeDiscount = Math.max(0, Math.min(subtotal, discount));
  const service =
    commerce.serviceChargePercent > 0
      ? Math.round(((subtotal - safeDiscount + delivery) * commerce.serviceChargePercent) / 100)
      : 0;
  return {
    subtotal,
    delivery,
    service,
    discount: safeDiscount,
    total: Math.max(0, subtotal - safeDiscount + delivery + service),
    itemCount,
    freeDeliveryGap:
      isDelivery && commerce.freeDeliveryOver > 0
        ? Math.max(0, commerce.freeDeliveryOver - subtotal)
        : 0,
  };
}

/** يحوّل رقم الموبايل المصري (أو أي دولة) لصيغة واتساب دولية */
export function toWhatsappNumber(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return `2${digits}`;
  if (digits.length === 10) return `2${digits}`;
  return digits;
}
