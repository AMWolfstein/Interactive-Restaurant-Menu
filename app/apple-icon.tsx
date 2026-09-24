import { brandIconResponse } from "@/lib/brand-icon";

// أيقونة الشاشة الرئيسية في iOS — نفس لوجو البراند بتاع الـ manifest.
// زي app/icon.tsx — كاش قصير بدل استعلام مع كل طلب
export const revalidate = 120;

export default function AppleIcon() {
  return brandIconResponse(180);
}
