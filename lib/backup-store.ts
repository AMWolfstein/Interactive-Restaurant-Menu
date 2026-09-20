import "server-only";

import { rest } from "./supabase-store";
import type { MenuData } from "./types";

const BACKUPS_TABLE = "catalog_backups";
const RETENTION_COUNT = 30;
export type BackupReason = "scheduled" | "manual";

export interface CatalogBackupSummary {
  id: string;
  createdAt: string;
  reason: BackupReason;
  itemCount: number;
  categoryCount: number;
}

interface BackupRow {
  id: string;
  created_at: string;
  reason: BackupReason;
  data: MenuData;
}

function serviceRoleKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}

function configured(): boolean {
  return Boolean(serviceRoleKey());
}

function serviceOptions() {
  const key = serviceRoleKey();
  return { apiKey: key, token: key };
}

function summarize(row: BackupRow): CatalogBackupSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    reason: row.reason,
    itemCount: Array.isArray(row.data?.items) ? row.data.items.length : 0,
    categoryCount: Array.isArray(row.data?.categories) ? row.data.categories.length : 0,
  };
}

export async function createCatalogBackup(menu: MenuData, reason: BackupReason): Promise<CatalogBackupSummary> {
  if (!configured()) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط — لا يمكن حفظ النسخ التلقائية بأمان");
  const result = await rest<BackupRow[]>(BACKUPS_TABLE, {
    method: "POST",
    body: { reason, data: menu },
    prefer: "return=representation",
    ...serviceOptions(),
  });
  if (!result.ok || !result.data?.[0]) throw new Error(result.message || "تعذّر حفظ النسخة الاحتياطية");
  await pruneCatalogBackups();
  return summarize(result.data[0]);
}

export async function listCatalogBackups(limit = 15): Promise<CatalogBackupSummary[]> {
  if (!configured()) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
  const safeLimit = Math.min(Math.max(1, limit), RETENTION_COUNT);
  const result = await rest<BackupRow[]>(`${BACKUPS_TABLE}?select=id,created_at,reason,data&order=created_at.desc&limit=${safeLimit}`, serviceOptions());
  if (!result.ok) throw new Error(result.message || "تعذّر قراءة النسخ الاحتياطية");
  return (result.data ?? []).map(summarize);
}

export async function getCatalogBackup(id: string): Promise<MenuData | null> {
  if (!configured()) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const result = await rest<BackupRow[]>(`${BACKUPS_TABLE}?id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`, serviceOptions());
  if (!result.ok) throw new Error(result.message || "تعذّر قراءة النسخة الاحتياطية");
  return result.data?.[0]?.data ?? null;
}

async function pruneCatalogBackups() {
  const result = await rest<Array<{ id: string }>>(`${BACKUPS_TABLE}?select=id&order=created_at.desc&limit=100`, serviceOptions());
  if (!result.ok || !result.data || result.data.length <= RETENTION_COUNT) return;
  const stale = result.data.slice(RETENTION_COUNT).map((row) => row.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!stale.length) return;
  // UUID values are validated before being interpolated into the PostgREST filter.
  await rest<null>(`${BACKUPS_TABLE}?id=in.(${stale.join(",")})`, { method: "DELETE", ...serviceOptions() });
}
