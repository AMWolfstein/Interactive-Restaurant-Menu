import { brandIconResponse } from "@/lib/brand-icon";

// المتصفحات بتطلب /favicon.ico تلقائياً — بنرد بلوجو البراند (المتصفحات
// الحديثة بتقبل PNG على المسار ده) بدل صورة ثابتة أو 404.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return brandIconResponse(64);
}
