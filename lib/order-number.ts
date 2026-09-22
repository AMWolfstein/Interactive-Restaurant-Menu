/**
 * رقم الطلب القصير — مثال: BF-7K4P2
 *
 * نفس المنطق الموجود في قاعدة البيانات (`generate_order_number` في
 * supabase/schema.sql) متكرر هنا عشان سائق الملف المحلي بتاع التطوير بس،
 * فالطلب بياخد نفس شكل الرقم في الحالتين.
 *
 * الأبجدية من غير 0/O/1/I عشان الموظف يقدر يقراه ويمليه على التليفون من غير لبس،
 * والرقم عشوائي مش تسلسلي فما ينفعش حد يخمّن أرقام طلبات غيره.
 */

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;

/** يستنتج بادئة الرقم من إعدادات المحل: orderPrefix، وإلا أوائل حروف الاسم الإنجليزي */
export function orderPrefixFrom(options: {
  orderPrefix?: string;
  storeNameEn?: string;
  storeName?: string;
}): string {
  const configured = cleanPrefix(options.orderPrefix ?? "");
  if (configured) return configured;

  const name = (options.storeNameEn || "").trim();
  if (name) {
    const initials = name
      .split(/\s+/)
      .filter((word) => /^[A-Za-z]/.test(word))
      .map((word) => word[0]!.toUpperCase())
      .join("");
    if (initials.length >= 2) return initials.slice(0, 4);
    const letters = cleanPrefix(name);
    if (letters) return letters.slice(0, 3);
  }
  return "ORD";
}

function cleanPrefix(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
}

function randomCode(length = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/**
 * يولّد رقم طلب فريد. `exists` بتتنادى للتأكد إن الرقم مش مستخدم
 * (الاصطدام نادر جداً: 32^5 ≈ 33 مليون احتمال).
 */
export function generateOrderNumber(prefix: string, exists: (id: string) => boolean = () => false): string {
  const safePrefix = cleanPrefix(prefix) || "ORD";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${safePrefix}-${randomCode()}`;
    if (!exists(candidate)) return candidate;
  }
  return `${safePrefix}-${randomCode(CODE_LENGTH + 1)}`;
}
