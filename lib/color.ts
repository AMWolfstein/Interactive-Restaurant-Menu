/**
 * أدوات لون مشتركة بين السيرفر والمتصفح — عشان لون البراند يتحسب
 * بنفس الطريقة أثناء الرندر على السيرفر وبعد الهيدريشن.
 */

const HEX = /^#?([0-9a-f]{6})$/i;

/** لون النص المناسب فوق لون الأكسنت (أسود أو أبيض حسب الإضاءة) */
export function readableOn(hex: string): "#0b0b0d" | "#ffffff" {
  const match = HEX.exec(hex.trim());
  if (!match) return "#0b0b0d";
  const int = parseInt(match[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#0b0b0d" : "#ffffff";
}

/** لون أكسنت صالح للاستخدام في CSS — بيرجع الافتراضي لو القيمة غلط */
export function safeAccent(value: string | undefined, fallback = "#f59e0b"): string {
  const trimmed = (value ?? "").trim();
  if (!HEX.test(trimmed)) return fallback;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
