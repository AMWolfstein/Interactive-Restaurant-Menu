import { NextRequest, NextResponse } from "next/server";
import { guardInvoiceRequest } from "@/lib/invoice-access";
import { getOrdersForInvoices, setOrderStatus, StoreError } from "@/lib/server-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * طلبات صفحة الفواتير — نفس جدول orders اللي بيستخدمه الأدمن، من غير أي
 * تكرار للبيانات. الرد بيحتوي على الطلبات فقط (مفيش أي إعدادات أو بيانات إدارية).
 */
export async function GET(request: NextRequest) {
  const guard = await guardInvoiceRequest(request, { rateKey: "invoices-orders" });
  if (!guard.ok) return guard.response;

  try {
    const orders = await getOrdersForInvoices(guard.token);
    return NextResponse.json({ orders }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر قراءة الطلبات" },
      { status },
    );
  }
}

/**
 * تغيير حالة الطلب — نفس دالة update_order_status الموجودة أصلاً ونفس
 * الحالات (new / cancelled). مفيش نظام حالات جديد: الطلب من الموقع هيتنفذ،
 * والإجراء الوحيد هو الإلغاء.
 */
export async function PATCH(request: NextRequest) {
  const guard = await guardInvoiceRequest(request, { rateKey: "invoices-status" });
  if (!guard.ok) return guard.response;

  try {
    const body = (await request.json()) as { orderId?: string; status?: string };
    const order = await setOrderStatus(body.orderId ?? "", body.status ?? "", guard.token);
    return NextResponse.json({ order });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تحديث الطلب" },
      { status },
    );
  }
}
