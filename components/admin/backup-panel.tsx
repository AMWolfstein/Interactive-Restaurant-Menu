"use client";

import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, Clock3, Download, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { authenticatedFetch } from "@/lib/supabase-auth-core";
import { useMenu } from "@/lib/use-menu";
import { Button, Panel } from "@/components/ui";

type Backup = {
  id: string;
  createdAt: string;
  reason: "scheduled" | "manual";
  itemCount: number;
  categoryCount: number;
};

export function BackupPanel() {
  const { importJson } = useMenu();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/admin/backups", { cache: "no-store" });
      const payload = await response.json() as { backups?: Backup[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "تعذّر قراءة النسخ الاحتياطية");
      setBackups(payload.backups ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر قراءة النسخ الاحتياطية");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/admin/backups", { method: "POST" });
      const payload = await response.json() as { backup?: Backup; error?: string };
      if (!response.ok || !payload.backup) throw new Error(payload.error || "تعذّر إنشاء النسخة");
      setBackups((current) => [payload.backup!, ...current].slice(0, 15));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر إنشاء النسخة");
    } finally {
      setCreating(false);
    }
  };

  const restore = async (id: string) => {
    setRestoring(id);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/admin/backups?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json() as { data?: unknown; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "تعذّر فتح النسخة");
      const result = importJson(JSON.stringify(payload.data));
      if (!result.ok) throw new Error(result.error || "ملف النسخة غير صالح");
      setConfirmId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر استرجاع النسخة");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Panel
      title="نسخ احتياطي تلقائي"
      description="نسخة يومية الساعة ٢:١٥ صباحًا UTC، مع الاحتفاظ بآخر ٣٠ نسخة. تقدر تعمل نسخة يدوية أو تسترجع نسخة سابقة."
      icon={<ShieldCheck className="h-4 w-4" />}
      actions={<Button size="sm" onClick={create} disabled={creating}>{creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} نسخة الآن</Button>}
    >
      {error ? <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-300">{error}</p> : null}
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> جاري تحميل سجل النسخ…</p>
      ) : backups.length ? (
        <ul className="space-y-2">
          {backups.map((backup) => (
            <li key={backup.id} className="rounded-xl border border-line bg-surface-2/45 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-bold"><Clock3 className="h-3.5 w-3.5 text-accent" /> {new Date(backup.createdAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{backup.reason === "scheduled" ? "تلقائية" : "يدوية"} · {backup.categoryCount} قسم · {backup.itemCount} منتج</p>
                </div>
                {confirmId === backup.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-red-400">استرجاع؟</span>
                    <Button size="sm" variant="danger" disabled={restoring === backup.id} onClick={() => restore(backup.id)}>{restoring === backup.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <ArchiveRestore className="h-3 w-3" />} نعم</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>إلغاء</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmId(backup.id)}><ArchiveRestore className="h-3.5 w-3.5" /> استرجاع</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs leading-relaxed text-muted">لا توجد نسخ مسجلة بعد. اضغط «نسخة الآن» للتجربة؛ النسخة التلقائية تبدأ بعد إعداد Vercel Cron.</p>}
      <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-muted transition hover:text-accent"><RefreshCw className="h-3 w-3" /> تحديث السجل</button>
    </Panel>
  );
}
