import { NextRequest, NextResponse } from "next/server";
import { createCatalogBackup, getCatalogBackup, listCatalogBackups } from "@/lib/backup-store";
import { bearerToken, checkAdmin } from "@/lib/server-auth";
import { getMenu } from "@/lib/server-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const check = await checkAdmin(bearerToken(request));
  return check.ok ? null : NextResponse.json({ error: check.error }, { status: check.status });
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const data = await getCatalogBackup(id);
      if (!data) return NextResponse.json({ error: "النسخة غير موجودة" }, { status: 404 });
      return NextResponse.json({ data }, { headers: { "cache-control": "no-store" } });
    }
    const backups = await listCatalogBackups();
    return NextResponse.json({ backups }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "تعذّر قراءة النسخ الاحتياطية" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const backup = await createCatalogBackup(await getMenu(bearerToken(request)), "manual");
    return NextResponse.json({ backup }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "تعذّر إنشاء النسخة الاحتياطية" }, { status: 503 });
  }
}
