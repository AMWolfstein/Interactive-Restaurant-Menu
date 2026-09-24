import { brandIconResponse } from "@/lib/brand-icon";

// الأيقونة بتتقري من إعدادات المحل مش من صورة ثابتة في الريبو، فأي تغيير
// للوجو بيظهر من غير نشر جديد. الكاش القصير بيمنع استعلام قاعدة بيانات
// مع كل طلب أيقونة (وهي بتتطلب كتير جداً من المتصفحات).
export const revalidate = 120;

export default function Icon() {
  return brandIconResponse(512);
}
