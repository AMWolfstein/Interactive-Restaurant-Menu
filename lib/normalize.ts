import { DEFAULT_DATA } from "./defaults";
import type { MenuData } from "./types";

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

/** تطبيع أي كتالوج قادم من الباك إند قبل ما يُعرض أو يُحفظ */
export function normalizeData(raw: unknown): MenuData {
  const merged = mergeWithDefaults<MenuData>(DEFAULT_DATA, raw);
  // الموقع عربي فقط حتى لو البيانات اتخزنت بالإنجليزية.
  merged.brand.language = "ar";
  merged.commerce.productLayout = merged.commerce.productLayout === "grid" ? "grid" : "list";

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
  merged.contact.mapUrl = sanitizeUrl(merged.contact.mapUrl);
  merged.contact.instagram = sanitizeUrl(merged.contact.instagram);
  merged.contact.facebook = sanitizeUrl(merged.contact.facebook);

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
      // النظام الحالي له اختياران فقط: عادي افتراضياً أو حار.
      spicy: item.spicy > 0 ? 1 : 0,
      salesCount: Math.max(0, Math.floor(item.salesCount ?? 0)),
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
