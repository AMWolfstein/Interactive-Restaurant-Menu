import { NextRequest, NextResponse } from "next/server";
import { getAdminOverview, StoreError } from "@/lib/server-database";
import { bearerToken, checkAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** الطلبات المسجلة + حالة التخزين — للأدمن فقط */
export async function GET(request: NextRequest) {
  const token = bearerToken(request);
  const check = await checkAdmin(token);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    return NextResponse.json(await getAdminOverview(token), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر قراءة البيانات" },
      { status },
    );
  }
}
