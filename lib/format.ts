import type {
  CartLine,
  CommerceSettings,
  ContactSettings,
  DeliveryZone,
  MenuItem,
  OrderStatus,
  OrderType,
  SiteLanguage,
} from "./types";

export const ORDER_TYPE_LABEL: Record<OrderType, { ar: string; en: string }> = {
  delivery: { ar: "توصيل", en: "Delivery" },
  pickup: { ar: "استلام من المحل", en: "Pickup" },
  instore: { ar: "من داخل المحل", en: "In-store" },
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, { ar: string; en: string }> = {
  new: { ar: "جديد", en: "New" },
  confirmed: { ar: "مؤكد", en: "Confirmed" },
  delivered: { ar: "تم التسليم", en: "Delivered" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
};

/** حالة الطلب مع التوافق مع الطلبات القديمة اللي ملهاش status */
export function orderStatusOf(order: { status?: OrderStatus }): OrderStatus {
  return order.status ?? "new";
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
}

export function computeTotals(
  lines: { line: CartLine; item: MenuItem }[],
  commerce: CommerceSettings,
  orderType: OrderType,
  zone?: DeliveryZone | null,
): CartTotals {
  const subtotal = lines.reduce((sum, { line, item }) => sum + item.price * line.quantity, 0);
  const itemCount = lines.reduce((sum, { line }) => sum + line.quantity, 0);
  const isDelivery = orderType === "delivery";
  const qualifiesFree =
    isDelivery && commerce.freeDeliveryOver > 0 && subtotal >= commerce.freeDeliveryOver;
  // لو فيه منطقة توصيل مختارة، رسومها هي اللي بتتحسب بدل الرسوم العامة
  const baseDeliveryFee = zone ? Math.max(0, zone.fee) : Math.max(0, commerce.deliveryFee);
  const delivery = isDelivery && !qualifiesFree ? baseDeliveryFee : 0;
  const service =
    commerce.serviceChargePercent > 0
      ? Math.round(((subtotal + delivery) * commerce.serviceChargePercent) / 100)
      : 0;
  return {
    subtotal,
    delivery,
    service,
    total: subtotal + delivery + service,
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

export interface OrderPayload {
  name: string;
  phone: string;
  address: string;
  notes: string;
  orderType: OrderType;
  lines: { line: CartLine; item: MenuItem }[];
  totals: CartTotals;
  /** اسم منطقة التوصيل المختارة (لو مفعّل) */
  zoneName?: string;
  /** طريقة الدفع المختارة (لو مفعّلة) */
  paymentMethod?: string;
}

/**
 * يبني رسالة واتساب من القالب اللي الأدمين كاتبه — يدعم البلايسهولدرز دي:
 * {storeName} {name} {phone} {orderType} {addressLine} {items} {zone} {payment}
 * {notes} {total} {subtotal} {delivery} {service} {currency} {count} {date}
 */
export function buildOrderMessage(
  payload: OrderPayload,
  opts: {
    lang: SiteLanguage;
    brand: { storeName: string; storeNameEn: string };
    contact: ContactSettings;
    commerce: CommerceSettings;
  },
): string {
  const { lang, commerce } = opts;
  const en = lang === "en";
  const storeName = en ? opts.brand.storeNameEn || opts.brand.storeName : opts.brand.storeName;
  const typeLabel = ORDER_TYPE_LABEL[payload.orderType][en ? "en" : "ar"];
  const unit = en ? commerce.currencyEn : commerce.currency;

  const itemsText = payload.lines
    .map(({ line, item }) => {
      const name = pick(lang, item.name, item.nameEn);
      const price = formatPrice(item.price, lang, commerce);
      const lineTotal = formatPrice(item.price * line.quantity, lang, commerce);
      const details = [item.weight, item.supplier ? `${en ? "Supplier" : "المورد"}: ${item.supplier}` : ""]
        .filter(Boolean)
        .join(" — ");
      return en
        ? `- ${line.quantity}x ${name}${details ? ` (${details})` : ""} — ${lineTotal}`
        : `- ${line.quantity}x ${name}${details ? ` (${details})` : ""} — ${price} × ${line.quantity} = ${lineTotal}`;
    })
    .join("\n");

  const zoneName = payload.zoneName?.trim() ?? "";
  const paymentMethod = payload.paymentMethod?.trim() ?? "";

  const addressLine =
    payload.orderType === "delivery" && payload.address
      ? en
        ? `📍 *Address:* ${payload.address}`
        : `📍 *العنوان:* ${payload.address}`
      : "";

  const notesValue = payload.notes.trim();
  const fallbackNotes = en ? "None" : "لا يوجد";

  const map: Record<string, string> = {
    storeName,
    name: payload.name || (en ? "Guest" : "عميل"),
    phone: payload.phone || (en ? "-" : "—"),
    orderType: typeLabel,
    addressLine,
    items: itemsText,
    zone: zoneName,
    payment: paymentMethod,
    notes: notesValue || fallbackNotes,
    total: `${formatPrice(payload.totals.total, lang, commerce)}`,
    subtotal: `${formatPrice(payload.totals.subtotal, lang, commerce)}`,
    delivery: payload.totals.delivery ? `${formatPrice(payload.totals.delivery, lang, commerce)}` : "0",
    service: payload.totals.service ? `${formatPrice(payload.totals.service, lang, commerce)}` : "0",
    currency: unit,
    count: String(payload.totals.itemCount),
    date: new Date().toLocaleString(en ? "en-GB" : "ar-EG", {
      dateStyle: "short",
      timeStyle: "short",
    }),
  };

  const template = (commerce.orderTemplate || "").trim() || defaultMessage(lang);
  let rendered = template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in map ? map[key] : match,
  );

  // لو القالب مش فيه {zone} أو {payment}، بنضيفهم في آخر الرسالة تلقائياً
  // عشان المعلومات توصل واتساب من غير ما الأدمين يعدّل القالب بنفسه
  const extras: string[] = [];
  if (zoneName && !template.includes("{zone}")) {
    extras.push(en ? `🗺️ *Zone:* ${zoneName}` : `🗺️ *المنطقة:* ${zoneName}`);
  }
  if (paymentMethod && !template.includes("{payment}")) {
    extras.push(en ? `💳 *Payment:* ${paymentMethod}` : `💳 *الدفع:* ${paymentMethod}`);
  }
  if (extras.length) rendered = `${rendered}\n${extras.join("\n")}`;

  // تنظيف السطور الفاضلة اللي بتنتج عن {addressLine} فاضي
  return rendered
    .split("\n")
    .reduce<string[]>((acc, line) => {
      if (!line.trim() && acc.length && !acc[acc.length - 1].trim()) return acc;
      acc.push(line);
      return acc;
    }, [])
    .join("\n")
    .trim();
}

function defaultMessage(lang: SiteLanguage): string {
  return lang === "en"
    ? `*New order — {storeName}*\n\n👤 *Customer:* {name}\n📞 *Phone:* {phone}\n🧾 *Type:* {orderType}\n{addressLine}\n\n*Order:*\n{items}\n\n📝 *Notes:* {notes}\n💰 *Total:* {total}`
    : `*طلب جديد — {storeName}*\n\n👤 *العميل:* {name}\n📞 *الموبايل:* {phone}\n🧾 *نوع الطلب:* {orderType}\n{addressLine}\n\n*تفاصيل الطلب:*\n{items}\n\n📝 *ملاحظات:* {notes}\n💰 *الإجمالي:* {total}`;
}

export const TEMPLATE_TOKENS = [
  "{storeName}",
  "{name}",
  "{phone}",
  "{orderType}",
  "{addressLine}",
  "{zone}",
  "{payment}",
  "{items}",
  "{notes}",
  "{count}",
  "{subtotal}",
  "{delivery}",
  "{service}",
  "{total}",
  "{currency}",
  "{date}",
] as const;
