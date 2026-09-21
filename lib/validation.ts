/**
 * دوال تحقق مشتركة للأمان
 */

export function isSafeHttpUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  // السماح بالروابط النسبية للصور المحلية
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  // السماح بـ data:image للصور المرفوعة
  if (trimmed.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeText(input: string, maxLen = 500): string {
  if (!input || typeof input !== "string") return "";
  // إزالة control characters وحروف غير مرئية، مع السماح بـ tab/newline/CR.
  return [...input]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim()
    .slice(0, maxLen);
}

export function isValidOrderType(value: string): boolean {
  // المحل تيك-أواي: استلام من المحل أو توصيل بس — مفيش طلبات «من داخل المحل»
  return ["delivery", "pickup"].includes(value);
}

// تحقق من ملف JSON المستورد للأدمن
export function validateImportedMenu(data: unknown): { ok: true } | { ok: false; error: string } {
  if (!data || typeof data !== "object") return { ok: false, error: "الملف ليس JSON صحيح" };
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) return { ok: false, error: "الملف لازم يحتوي على items" };
  if (!Array.isArray(d.categories)) return { ok: false, error: "الملف لازم يحتوي على categories" };
  for (const item of d.items as Array<Record<string, unknown>>) {
    if (typeof item.name !== "string" || !item.name.trim()) return { ok: false, error: "كل منتج لازم له اسم" };
    if (typeof item.price !== "number" || item.price < 0 || item.price > 100000)
      return { ok: false, error: `سعر غير صالح للمنتج: ${item.name}` };
    if (item.image && typeof item.image === "string" && item.image.length > 500_000)
      return { ok: false, error: `صورة كبيرة جداً للمنتج: ${item.name}` };
    if (item.image && typeof item.image === "string" && item.image.trim() && !isSafeHttpUrl(item.image))
      return { ok: false, error: `رابط صورة غير آمن للمنتج: ${item.name}` };
  }
  const jsonSize = JSON.stringify(data).length;
  if (jsonSize > 4_000_000) return { ok: false, error: "حجم الملف كبير جداً (الحد 4MB)" };
  return { ok: true };
}
