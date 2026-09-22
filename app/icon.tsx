import { brandIconResponse } from "@/lib/brand-icon";

// الأيقونة بتتقري من إعدادات المحل مع كل طلب — مش صورة ثابتة في الريبو،
// فأي تغيير للوجو من لوحة التحكم بيظهر فوراً من غير نشر جديد.
export const dynamic = "force-dynamic";

export default function Icon() {
  return brandIconResponse(512);
}
