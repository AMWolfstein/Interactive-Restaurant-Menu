import { effectiveStoreOpen } from "./schedule";
import type { CommerceSettings, ContactSettings, DeliveryZone, MenuData, OrderType } from "./types";

/**
 * قواعد قبول الطلب على السيرفر.
 *
 * ⚠️ مهم: كل القواعد دي كانت متفروضة في المتصفح بس (`components/public/cart-sheet.tsx`)،
 * يعني أي حد يبعت POST على `/api/orders` مباشرةً كان بيعدّيها كلها — يطلب والمحل
 * مقفول، أو بنوع طلب الأدمن قافله، أو تحت الحد الأدنى، أو والسلة متقفلة خالص.
 *
 * الملف ده هو المصدر الوحيد للقواعد على السيرفر، وبيتنادى من السائقين الاتنين
 * (Supabase وملف التطوير المحلي) عشان السلوك ما يختلفش بينهم. ونفس المنطق
 * متكرر في دالة `place_order` في `supabase/schema.sql` — وهي خط الدفاع الأخير
 * لأنها بتشتغل حتى لو حد نادى Supabase REST مباشرةً.
 *
 * الدوال هنا نقية (pure) عشان تبقى قابلة للاختبار من غير شبكة ولا قاعدة بيانات.
 */

export interface OrderRuleViolation {
  /** رسالة عربية جاهزة للعرض للعميل */
  message: string;
  /** كود HTTP المناسب: 409 للمحل المقفول، 400 لباقي أخطاء المدخلات */
  status: 400 | 409;
}

export interface OrderRuleInput {
  orderType: OrderType;
  customer: { name?: string; phone?: string; address?: string };
  /** قيمة الأصناف قبل التوصيل والخدمة — عليها بيتحسب الحد الأدنى */
  subtotal: number;
  /** منطقة التوصيل المختارة بعد التحقق من وجودها */
  zone?: DeliveryZone | null;
}

/** عدد أرقام الموبايل المطلوبة كحد أدنى (نفس تحقق السلة في المتصفح) */
const MIN_PHONE_DIGITS = 10;
/** أقل طول مقبول للاسم */
const MIN_NAME_LENGTH = 2;
/** أقل طول مقبول للعنوان التفصيلي */
const MIN_ADDRESS_LENGTH = 8;

/**
 * هل المحل مفتوح دلوقتي؟ بيغطي الحالتين:
 *   - `autoSchedule = true`  → الجدول الأسبوعي بتوقيت المحل
 *   - `autoSchedule = false` → مفتاح `isOpen` اليدوي من لوحة التحكم
 *
 * الحالة التانية دي كانت مش متحقق منها على السيرفر إطلاقاً.
 */
export function isStoreAcceptingOrders(contact: ContactSettings, now = new Date()): boolean {
  return effectiveStoreOpen(contact, now);
}

/**
 * بيرجّع أول قاعدة مكسورة، أو `null` لو الطلب مقبول.
 *
 * بنرجّع أول مخالفة بس (مش قائمة) عشان الرد يفضل بسيط ومتسق مع باقي الـ API،
 * والواجهة أصلاً بتمنع الحالات دي قبل ما توصل للسيرفر.
 */
export function checkOrderRules(
  menu: Pick<MenuData, "commerce" | "contact">,
  input: OrderRuleInput,
  now = new Date(),
): OrderRuleViolation | null {
  const { commerce, contact } = menu;

  // ١) السلة مقفولة خالص (وضع «معرض فقط») — مفيش طلبات أصلاً
  if (!commerce.enableCart) {
    return { message: "الطلب من الموقع مقفول حالياً", status: 409 };
  }

  // ٢) المحل مقفول (يدوي أو بالجدول الأوتوماتيكي)
  if (!isStoreAcceptingOrders(contact, now)) {
    return { message: "المحل مقفل حالياً — مش ممكن تسجيل طلبات دلوقتي", status: 409 };
  }

  // ٣) نوع الطلب لازم يكون مفعّل في إعدادات المحل
  const allowedTypes = commerce.orderTypes ?? [];
  if (allowedTypes.length > 0 && !allowedTypes.includes(input.orderType)) {
    return { message: "نوع الطلب ده مش متاح حالياً", status: 400 };
  }

  // ٤) بيانات العميل المطلوبة حسب إعدادات المحل
  if (commerce.requireName && (input.customer.name ?? "").trim().length < MIN_NAME_LENGTH) {
    return { message: "اكتب الاسم بالكامل", status: 400 };
  }
  if (commerce.requirePhone && (input.customer.phone ?? "").replace(/\D/g, "").length < MIN_PHONE_DIGITS) {
    return { message: "رقم الموبايل مش كامل", status: 400 };
  }
  if (
    input.orderType === "delivery" &&
    commerce.requireAddress &&
    (input.customer.address ?? "").trim().length < MIN_ADDRESS_LENGTH
  ) {
    return { message: "اكتب العنوان بالتفصيل (الشارع، رقم العقار، الدور، الشقة)", status: 400 };
  }

  // ٥) الحد الأدنى للطلب — على قيمة الأصناف قبل التوصيل والخدمة
  const subtotal = Math.max(0, Number(input.subtotal) || 0);
  if (commerce.minimumOrder > 0 && subtotal < commerce.minimumOrder) {
    return { message: `أقل طلب ${commerce.minimumOrder} ${commerce.currency}`, status: 400 };
  }

  // ٦) الحد الأدنى الخاص بمنطقة التوصيل
  const zone = input.zone;
  if (input.orderType === "delivery" && zone && zone.minimumOrder > 0 && subtotal < zone.minimumOrder) {
    return {
      message: `أقل طلب في ${zone.name} هو ${zone.minimumOrder} ${commerce.currency}`,
      status: 400,
    };
  }

  return null;
}

/**
 * منطقة التوصيل المطلوبة للطلب.
 *
 * بترجّع `{ required: true, zone: null }` لو المناطق مفعّلة وفيه مناطق لكن
 * العميل ما اختارش واحدة صالحة — وساعتها الطلب لازم يترفض.
 */
export function resolveDeliveryZone(
  commerce: CommerceSettings,
  orderType: OrderType,
  zoneId?: string,
): { required: boolean; zone: DeliveryZone | null } {
  const zones = commerce.deliveryZones ?? [];
  const active = orderType === "delivery" && commerce.enableZones && zones.length > 0;
  if (!active) return { required: false, zone: null };
  return { required: true, zone: zones.find((candidate) => candidate.id === zoneId) ?? null };
}
