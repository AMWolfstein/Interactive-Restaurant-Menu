import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createCatalogBackup } from "@/lib/backup-store";
import { getMenu } from "@/lib/server-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameSecret(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** يستدعيه Vercel Cron يومياً. لا يرد على أي طلب ليس معه CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !sameSecret(token, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const backup = await createCatalogBackup(await getMenu(), "scheduled");
    return NextResponse.json({ ok: true, backup });
  } catch (error) {
    console.error("[backup] scheduled backup failed", error);
    return NextResponse.json({ error: "Backup failed" }, { status: 503 });
  }
}
