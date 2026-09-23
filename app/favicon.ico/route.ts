import { brandIconResponse } from "@/lib/brand-icon";

// المتصفحات بتطلب /favicon.ico تلقائياً — بنرد بلوجو البراند (المتصفحات
// الحديثة بتقبل PNG على المسار ده) بدل صورة ثابتة أو 404.
// زي app/icon.tsx — كاش قصير بدل استعلام مع كل طلب
export const revalidate = 120;

export async function GET(): Promise<Response> {
  return brandIconResponse(64);
}
