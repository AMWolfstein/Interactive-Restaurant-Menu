import { brandIconResponse } from "@/lib/brand-icon";

// أيقونة الشاشة الرئيسية في iOS — نفس لوجو البراند بتاع الـ manifest.
export const dynamic = "force-dynamic";

export default function AppleIcon() {
  return brandIconResponse(180);
}
