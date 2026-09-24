import { DEFAULT_DATA } from "./defaults";
import { MAX_LOYALTY_PERCENT, MAX_LOYALTY_THRESHOLD } from "./loyalty";
import type { MenuData, OrderType } from "./types";

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * دمج البيانات القادمة من قاعدة البيانات مع بيانات البداية:
 * أي حقل جديد بيتضاف في الكود بيتعوّض تلقائياً، والمصفوفات (المنتجات والأقسام)
 * بتاخد قيمتها المخزّنة كما هي عشان الحذف والتعديل يفضلوا محفوظين.
 */
function mergeWithDefaults<T>(base: T, saved: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(saved)) {
    return (saved === undefined ? base : (saved as T)) as T;
  }
  const out: Plain = { ...base };
  for (const [key, baseValue] of Object.entries(base)) {
    if (!(key in saved)) continue;
    const savedValue = saved[key];
    if (isPlainObject(baseValue) && isPlainObject(savedValue)) {
      out[key] = mergeWithDefaults(baseValue, savedValue);
    } else if (savedValue !== undefined && savedValue !== null) {
      out[key] = savedValue;
    } else if (baseValue !== undefined && baseValue !== null && savedValue === null) {
      // null صريح (مثل oldPrice: null) بيتحفظ كما هو
      out[key] = savedValue;
    }
  }
  return out as T;
}

function clampFee(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(100000, Math.round(num * 100) / 100);
}

/** يضمن جدول أسبوعي كامل (7 أيام) بأوقات HH:MM صالحة */
function normalizeWeeklySchedule(raw: unknown): import("./types").WeekDaySchedule[] {
  const fallback = DEFAULT_DATA.contact.weeklySchedule;
  const source = Array.isArray(raw) ? raw : [];
  return fallback.map((day) => {
    const entry = source.find((slot) => slot && (slot as { day?: unknown }).day === day.day) as
      | { open?: unknown; close?: unknown; enabled?: unknown }
      | undefined;
    const valid = (value: unknown, fb: string) =>
      typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim()) ? value.trim() : fb;
    return {
      day: day.day,
      enabled: entry ? entry.enabled !== false : day.enabled,
      open: valid(entry?.open, day.open),
      close: valid(entry?.close, day.close),
    };
  });
}

/** تطبيع أي كتالوج قادم من الباك إند قبل ما يُعرض أو يُحفظ */
function firestoreDate(value: unknown): { day: number; month: number; year: number } | null {
  if (!isPlainObject(value) || typeof value.seconds !== "number") return null;
  const date = new Date(value.seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
}

/** هل الملف صادر من مشروع Menyu القديم (Firebase)؟ */
export function isLegacyMenyuBackup(raw: unknown): raw is Plain {
  if (!isPlainObject(raw) || !Array.isArray(raw.items) || !Array.isArray(raw.categories)) return false;
  // وجود restaurant أو حقول Firestore القديمة يميّز النسخة عن تصدير الكتالوج الحالي.
  return isPlainObject(raw.restaurant) || raw.items.some((item) =>
    isPlainObject(item) && ("imageUrl" in item || "supplierId" in item || "orderCount" in item),
  );
}

/** يحوّل Backup الموقع القديم (Firebase) إلى شكل المنيو الحالي تلقائياً. */
function migrateLegacyBackup(raw: unknown): unknown {
  if (!isLegacyMenyuBackup(raw)) return raw;
  const restaurant = isPlainObject(raw.restaurant) ? raw.restaurant : {};
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter(isPlainObject).map((c, index) => ({
        id: String(c.id ?? `category-${index}`),
        name: String(c.name ?? c.id ?? "قسم"),
        emoji: String(c.icon ?? ""),
        visible: true,
      }))
    : [];
  const suppliers = Array.isArray(raw.suppliers)
    ? raw.suppliers
      .filter(isPlainObject)
      .map((s, index) => ({ id: String(s.id ?? `supplier-${index}`), name: String(s.name ?? s.id ?? ""), visible: true }))
      .filter((supplier) => Boolean(supplier.name.trim()))
    : [];
  // الموقع القديم كان يخزّن supplierId داخل المنتج، بينما الواجهة الجديدة تعرض الاسم.
  // نحوله هنا كي تظهر أسماء الموردين ويعمل فلتر المورد فور الاستيراد.
  const supplierNameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

  const legacyItems = Array.isArray(raw.items) ? raw.items : [];
  const items = legacyItems.filter(isPlainObject).map((item, index) => {
    const variants = Array.isArray(item.variants)
      ? item.variants.filter(isPlainObject).map((variant, variantIndex) => {
          const end = firestoreDate(variant.discountEndsAt);
          const regular = Number(variant.price ?? item.price ?? 0);
          const sale = variant.discountPrice == null ? regular : Number(variant.discountPrice);
          return {
            id: String(variant.id ?? `${item.id ?? index}-variant-${variantIndex}`),
            label: String(variant.label ?? ""),
            price: Number.isFinite(sale) ? sale : 0,
            oldPrice: sale < regular ? regular : null,
            ...(end ? { offerEndDay: end.day, offerEndMonth: end.month, offerEndYear: end.year } : {}),
          };
        })
      : [];
    const end = firestoreDate(item.discountEndsAt);
    const created = firestoreDate(item.createdAt);
    const regular = Number(item.price ?? 0);
    const sale = item.discountPrice == null ? regular : Number(item.discountPrice);
    const legacySupplierId = String(item.supplierId ?? "");
    return {
      id: String(item.id ?? `item-${index}`),
      categoryId: String(item.categoryId ?? categories[0]?.id ?? ""),
      name: String(item.name ?? "منتج"),
      description: String(item.description ?? ""),
      supplier: supplierNameById.get(legacySupplierId) ?? legacySupplierId,
      ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : created ? { createdAt: new Date(created.year, created.month - 1, created.day).toISOString() } : {}),
      price: Number.isFinite(sale) ? sale : 0,
      oldPrice: sale < regular ? regular : null,
      image: typeof item.imageUrl === "string" ? item.imageUrl : "",
      available: item.available !== false,
      isNew: false,
      spicy: item.badge === "حار" ? 1 : 0,
      salesCount: Math.max(0, Math.floor(Number(item.orderCount ?? 0))),
      weight: variants.length === 1 ? variants[0].label : String(item.description ?? ""),
      ...(variants.length ? { variants } : {}),
      ...(end ? { offerEndDay: end.day, offerEndMonth: end.month, offerEndYear: end.year } : {}),
    };
  });

  const heroImages = Array.isArray(raw.heroImages)
    ? raw.heroImages.filter(isPlainObject).map((hero, index) => ({ id: String(hero.id ?? `hero-${index}`), image: String(hero.imageUrl ?? ""), order: Number(hero.order ?? index) }))
    : [];
  const brand = {
    storeName: String(restaurant.name ?? DEFAULT_DATA.brand.storeName),
    storeNameEn: String(restaurant.name ?? DEFAULT_DATA.brand.storeNameEn),
    tagline: String(restaurant.tagline ?? ""),
    taglineEn: String(restaurant.tagline ?? ""),
    logo: String(restaurant.imageUrl ?? ""),
    accent: String(restaurant.themeColor ?? DEFAULT_DATA.brand.accent),
    heroImage: String(restaurant.coverImageUrl ?? heroImages[0]?.image ?? DEFAULT_DATA.brand.heroImage),
    heroImages,
  };
  const contact = {
    ...DEFAULT_DATA.contact,
    phone: String(restaurant.phone ?? ""),
    whatsapp: String(restaurant.phone ?? "").replace(/\D/g, ""),
    instagram: String(restaurant.instagramUrl ?? ""),
    facebook: String(restaurant.facebookUrl ?? ""),
    tiktok: String(restaurant.tiktokUrl ?? ""),
    mapUrl: String(restaurant.googleMapsUrl ?? ""),
  };
  const commerce = { ...DEFAULT_DATA.commerce, currency: String(restaurant.currency ?? DEFAULT_DATA.commerce.currency) };
  return { ...DEFAULT_DATA, brand: { ...DEFAULT_DATA.brand, ...brand }, contact, commerce, categories, suppliers, items };
}

export function normalizeData(raw: unknown): MenuData {
  const migrated = migrateLegacyBackup(raw);
  // أي مدخل مش كائن (null، مصفوفة، رقم، نص) بيتعامل كأنه مفيش بيانات محفوظة.
  // من غير الحارس ده ملف استيراد تالف كان بيرمي TypeError جوه الأدمن بدل
  // ما يرجّع رسالة خطأ مفهومة.
  const safe = isPlainObject(migrated) ? migrated : {};
  const merged = mergeWithDefaults<MenuData>(DEFAULT_DATA, safe);
  // الموقع عربي فقط حتى لو البيانات اتخزنت بالإنجليزية.
  merged.brand.language = "ar";
  merged.commerce.productLayout = merged.commerce.productLayout === "grid" ? "grid" : "list";
  // أعمدة شبكة الموبايل: عمودين أو ٣ أعمدة بس (٢ ← ١٦ منتج في الصفحة، ٣ ← ١٥ منتج)
  const mobileGridColumns = Number(merged.commerce.mobileGridColumns);
  merged.commerce.mobileGridColumns = mobileGridColumns === 2 ? 2 : 3;

  // أنواع الطلب: استلام من المحل أو توصيل بس — المحل مفيهوش طاولات، فنوع «من داخل المحل»
  // (القعدة جوه) اتشال نهائياً وبيتنضف من أي بيانات محفوظة قديمة، مع ضمان نوع واحد على الأقل
  merged.commerce.orderTypes = (merged.commerce.orderTypes ?? [])
    .filter((type): type is OrderType => type === "delivery" || type === "pickup")
    .filter((type, index, list) => list.indexOf(type) === index);
  if (!merged.commerce.orderTypes.length) merged.commerce.orderTypes = [...DEFAULT_DATA.commerce.orderTypes];

  // تعقيم الروابط الخارجية (مكافحة javascript: و open redirect)
  const isSafeHttpUrl = (url: string) => {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
    if (trimmed.startsWith("data:image/")) return true;
    try {
      const u = new URL(trimmed);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch { return false; }
  };
  const sanitizeUrl = (url: string) => (isSafeHttpUrl(url) ? url.trim() : "");
  merged.brand.heroImage = sanitizeUrl(merged.brand.heroImage) || "/images/catalog/hero.jpg";
  merged.brand.logo = merged.brand.logo ? sanitizeUrl(merged.brand.logo) : "";
  merged.brand.heroImages = (merged.brand.heroImages ?? [])
    .filter((hero) => hero && typeof hero.image === "string")
    .map((hero, index) => ({ ...hero, id: hero.id || `hero-${index}`, image: sanitizeUrl(hero.image), order: Number.isFinite(hero.order) ? hero.order : index }))
    .filter((hero) => Boolean(hero.image))
    .sort((a, b) => a.order - b.order);
  merged.suppliers = (merged.suppliers ?? [])
    .filter((supplier) => supplier?.id && typeof supplier.name === "string" && supplier.name.trim())
    .map((supplier) => ({
      ...supplier,
      id: String(supplier.id),
      name: supplier.name.trim().slice(0, 120),
      visible: supplier.visible !== false,
    }))
    .filter((supplier, index, list) => list.findIndex((row) => row.name.toLocaleLowerCase() === supplier.name.toLocaleLowerCase()) === index);
  merged.categories = merged.categories.map((category) => ({ ...category, visible: category.visible !== false }));
  merged.contact.mapUrl = sanitizeUrl(merged.contact.mapUrl);
  merged.contact.instagram = sanitizeUrl(merged.contact.instagram);
  merged.contact.facebook = sanitizeUrl(merged.contact.facebook);
  merged.contact.tiktok = sanitizeUrl(merged.contact.tiktok);

  // جدول الفتح/القفل الأوتوماتيكي: 7 أيام بأوقات صالحة دايماً
  merged.contact.autoSchedule = merged.contact.autoSchedule === true;
  merged.contact.weeklySchedule = normalizeWeeklySchedule(merged.contact.weeklySchedule);

  // مناطق التوصيل: أسماء وأرقام منطقية بس
  merged.commerce.enableZones = merged.commerce.enableZones === true;
  merged.commerce.deliveryZones = (merged.commerce.deliveryZones ?? [])
    .filter((zone) => zone && typeof zone.name === "string" && zone.name.trim())
    .slice(0, 30)
    .map((zone, index) => ({
      id: String(zone.id ?? `zone-${index}`),
      name: String(zone.name).trim().slice(0, 60),
      fee: clampFee(zone.fee),
      minimumOrder: clampFee(zone.minimumOrder),
    }));

  // طرق الدفع: نصوص قصيرة نظيفة من غير تكرار
  merged.commerce.paymentMethods = (merged.commerce.paymentMethods ?? [])
    .filter((method): method is string => typeof method === "string")
    .map((method) => method.trim().slice(0, 40))
    .filter(Boolean)
    .filter((method, index, list) => list.indexOf(method) === index)
    .slice(0, 10);

  // نظام «كاشك»: قيم منطقية بس — عتبة موجبة ونسبة خصم معقولة (مكافحة 100٪ بالغلط)
  {
    const fallback = DEFAULT_DATA.commerce.loyalty;
    const raw = merged.commerce.loyalty ?? fallback;
    const threshold = Math.round(Number(raw.threshold));
    const percent = Number(raw.percent);
    merged.commerce.loyalty = {
      enabled: raw.enabled === true,
      label: String(raw.label ?? fallback.label).trim().slice(0, 30) || fallback.label,
      threshold:
        Number.isFinite(threshold) && threshold > 0
          ? Math.min(MAX_LOYALTY_THRESHOLD, threshold)
          : fallback.threshold,
      percent:
        Number.isFinite(percent) && percent > 0
          ? Math.min(MAX_LOYALTY_PERCENT, Math.round(percent * 100) / 100)
          : fallback.percent,
    };
  }

  // بادئة رقم الطلب: حروف وأرقام إنجليزية بس، 4 خانات كحد أقصى (BF-7K4P2)
  merged.commerce.orderPrefix = String(merged.commerce.orderPrefix ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4);

  // ضمان أسعار وحدود منطقية (مكافحة حقن أسعار سالبة أو كبيرة)
  for (const item of merged.items) {
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0) item.price = 0;
    if (item.price > 100000) item.price = 100000;
    if (item.oldPrice != null) {
      if (typeof item.oldPrice !== "number" || !Number.isFinite(item.oldPrice) || item.oldPrice < 0) item.oldPrice = null;
      if (item.oldPrice != null && item.oldPrice > 200000) item.oldPrice = 200000;
    }
    if (item.image && item.image.length > 500000) item.image = ""; // منع dataURL عملاق
    if (item.image && !isSafeHttpUrl(item.image)) item.image = "";
  }

  const knownCats = new Set(merged.categories.map((c) => c.id));
  return {
    ...merged,
    items: merged.items.map((item) => ({
      ...item,
      supplier: typeof item.supplier === "string" ? item.supplier.trim().slice(0, 120) : "",
      // 0 = عادي، 1 = حار، 2 = نباتي. القيم القديمة الأكبر من 2 تتراجع لعادي.
      spicy: item.spicy === 2 ? 2 : item.spicy > 0 ? 1 : 0,
      salesCount: Math.max(0, Math.floor(item.salesCount ?? 0)),
      createdAt: typeof item.createdAt === "string" && !Number.isNaN(new Date(item.createdAt).getTime()) ? item.createdAt : undefined,
      offerEndDay: item.offerEndDay ?? null,
      offerEndMonth: item.offerEndMonth ?? null,
      offerEndYear: item.offerEndYear ?? null,
      // أي منتج قسمه اتحذف ينزل في أول قسم بدل ما يختفي
      categoryId: knownCats.has(item.categoryId)
        ? item.categoryId
        : (merged.categories[0]?.id ?? ""),
    })),
  };
}
