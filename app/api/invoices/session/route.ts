import { NextRequest, NextResponse } from "next/server";
import { guardInvoiceRequest } from "@/lib/invoice-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * التحقق من جلسة موظف الفواتير على السيرفر.
 * الواجهة بتعتمد على الرد ده — مش على أي حاجة محفوظة في المتصفح.
 */
export async function GET(request: NextRequest) {
  const guard = await guardInvoiceRequest(request, { rateKey: "invoices-session" });
  if (!guard.ok) return guard.response;

  return NextResponse.json(
    { authenticated: true, email: guard.user.email, userId: guard.user.id, role: guard.user.role },
    { headers: { "cache-control": "no-store" } },
  );
}
