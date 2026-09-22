"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  ChartColumn,
  CircleCheck,
  Clock,
  Database,
  FolderTree,
  Package,
  Plus,
  Receipt,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { orderStatusOf, ORDER_STATUS_LABEL } from "@/lib/format";
import { effectiveStoreOpen } from "@/lib/schedule";
import { Badge, Button, Panel } from "@/components/ui";
import { cx } from "@/lib/cx";
import { subscribeRealtime } from "@/lib/realtime";
import { ORDERS_TABLE } from "@/lib/supabase";
import { authenticatedFetch } from "@/lib/supabase-auth-core";
import type { AdminOverview, SavedOrder } from "@/lib/types";

interface OverviewState {
  orders: SavedOrder[];
  storage: { driver: "supabase" | "file"; persistent: boolean };
}

const EMPTY_OVERVIEW: OverviewState = {
  orders: [],
  storage: { driver: "file", persistent: false },
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  delivery: "دليفري",
  pickup: "استلام",
  // طلبات قديمة اتسجلت بنوع «من داخل المحل» قبل ما يتشال (المحل مفيهوش طاولات)
  instore: "من المحل (قديم)",
};

const DAY = 86_400_000;

export function DashboardPanel({ onJump }: { onJump: (tab: string, payload?: string) => void }) {
  const { data, isCustomized, storageKb } = useMenu();
  const { items, categories, brand, contact, commerce } = data;
  const supabaseAuth = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [overview, setOverview] = useState<OverviewState>(EMPTY_OVERVIEW);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setOverviewError(payload?.error ?? "تعذّر قراءة بيانات اللوحة");
        return;
      }
      const result = (await response.json()) as AdminOverview;
      setOverview({
        orders: result.orders ?? [],
        storage: result.storage ?? EMPTY_OVERVIEW.storage,
      });
      setOverviewError(null);
    } catch {
      setOverviewError("تعذّر الاتصال بالباك إند");
    }
  }, []);

  useEffect(() => {
    // متابعة لحظية فورية عبر Supabase Realtime:
    // أي طلب جديد يظهر في اللوحة في نفس اللحظة (WebSocket)
    const unsubscribe = subscribeRealtime(
      "realtime:admin-overview",
      [{ table: ORDERS_TABLE, event: "INSERT" }],
      () => void loadOverview(),
    );
    // شبكة أمان: فحص دوري كل 30 ثانية لو الـ Realtime انقطع
    const timer = window.setInterval(() => void loadOverview(), 30_000);
    const kick = window.setTimeout(() => void loadOverview(), 0);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.clearTimeout(kick);
    };
  }, [loadOverview]);

  const stats = useMemo(() => {
    const soldOut = items.filter((item) => !item.available).length;
    const offers = items.filter((item) => item.oldPrice && item.oldPrice > item.price).length;
    const noImage = items.filter((item) => !item.image?.trim()).length;
    const avg = items.length ? Math.round(items.reduce((sum, item) => sum + item.price, 0) / items.length) : 0;
    return { soldOut, offers, noImage, avg };
  }, [items]);

  /** تحليلات من الطلبات الفعلية — الملغي مستثنى من الإيرادات */
  const analytics = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const active = overview.orders.filter((order) => orderStatusOf(order) !== "cancelled");
    const revenueSince = (since: number) =>
      active
        .filter((order) => new Date(order.createdAt).getTime() >= since)
        .reduce((sum, order) => sum + order.total, 0);
    const ordersSince = (since: number) =>
      active.filter((order) => new Date(order.createdAt).getTime() >= since).length;

    const revenueToday = revenueSince(todayStart);
    const revenueWeek = revenueSince(now.getTime() - 7 * DAY);
    const revenueMonth = revenueSince(now.getTime() - 30 * DAY);
    const ordersMonth = ordersSince(now.getTime() - 30 * DAY);
    const avgOrderValue = ordersMonth > 0 ? Math.round(revenueMonth / ordersMonth) : 0;
    const newCount = overview.orders.filter((order) => orderStatusOf(order) === "new").length;

    // أعلى المنتجات بالإيراد خلال آخر 30 يوم
    const monthStart = now.getTime() - 30 * DAY;
    const productRevenue = new Map<string, { revenue: number; quantity: number }>();
    for (const order of active) {
      if (new Date(order.createdAt).getTime() < monthStart) continue;
      for (const line of order.lines ?? []) {
        const entry = productRevenue.get(line.name) ?? { revenue: 0, quantity: 0 };
        entry.revenue += line.unitPrice * line.quantity;
        entry.quantity += line.quantity;
        productRevenue.set(line.name, entry);
      }
    }
    const topProducts = [...productRevenue.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // إيراد آخر 14 يوم (رسم بياني بسيط)
    const daily = Array.from({ length: 14 }, (_, index) => {
      const dayStart = todayStart - (13 - index) * DAY;
      const dayEnd = dayStart + DAY;
      const revenue = active
        .filter((order) => {
          const at = new Date(order.createdAt).getTime();
          return at >= dayStart && at < dayEnd;
        })
        .reduce((sum, order) => sum + order.total, 0);
      return { dayStart, revenue };
    });

    return { revenueToday, revenueWeek, revenueMonth, ordersMonth, avgOrderValue, newCount, topProducts, daily };
  }, [overview.orders]);

  const checks = [
    {
      ok: /^\d{9,15}$/.test(contact.whatsapp.replace(/\D/g, "")),
      label: "رقم الواتساب",
      fix: "حدد رقم الواتساب في تبويب الطلبات",
      tab: "ordering",
    },
    {
      ok: !!brand.storeName.trim(),
      label: "اسم المحل",
      fix: "اسم المحل فاضي",
      tab: "brand",
    },
    { ok: stats.noImage === 0, label: "صور المنتجات", fix: `${stats.noImage} منتج بدون صورة`, tab: "items" },
    { ok: items.length > 0, label: "المنتجات", fix: "أضف أول منتج للكتالوج", tab: "items" },
    {
      ok: categories.some((category) => category.visible),
      label: "الأقسام الظاهرة",
      fix: "كل الأقسام مقفولة من الظهور",
      tab: "categories",
    },
    {
      ok: items.every((item) => categories.some((category) => category.id === item.categoryId)),
      label: "تصنيف المنتجات",
      fix: "في منتجات قسمها اتحذف",
      tab: "items",
    },
    {
      ok: effectiveStoreOpen(contact),
      label: "حالة المحل",
      fix: contact.autoSchedule
        ? "مقفل حالياً حسب جدول المواعيد الأوتوماتيكي"
        : contact.closedMessage || "المحل مقفل حالياً",
      tab: "ordering",
    },
    {
      ok: supabaseAuth,
      label: "مصادقة الأدمن",
      fix: "أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY",
      tab: "data",
    },
    {
      ok: overview.storage.persistent,
      label: "قاعدة البيانات",
      fix: "التخزين الحالي مؤقت — نفّذ supabase/schema.sql في Supabase",
      tab: "data",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Package className="h-4 w-4" />} label="المنتجات" value={String(items.length)} hint={`${stats.soldOut} خلصت`} />
        <Stat icon={<FolderTree className="h-4 w-4" />} label="الأقسام" value={String(categories.length)} hint={`${categories.filter((c) => c.visible).length} ظاهر`} />
        <Stat icon={<Receipt className="h-4 w-4" />} label="إيراد اليوم" value={`${analytics.revenueToday} ${commerce.currency}`} hint={`${overview.orders.length} طلب مسجّل إجمالاً`} />
        <Stat icon={<Wallet className="h-4 w-4" />} label="متوسط قيمة الطلب" value={`${analytics.avgOrderValue} ${commerce.currency}`} hint="آخر ٣٠ يوم (بدون الملغي)" />
      </div>

      <Panel
        title="تحليلات المبيعات"
        description="من الطلبات الفعلية المسجّلة — الطلبات الملغية مستثناة من الإيرادات"
        icon={<ChartColumn className="h-4 w-4" />}
        actions={
          <Button size="sm" variant="outline" onClick={() => onJump("orders")}>
            كل الطلبات <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<Banknote className="h-4 w-4" />} label="إيراد النهارده" value={`${analytics.revenueToday} ${commerce.currency}`} />
          <Stat icon={<Banknote className="h-4 w-4" />} label="إيراد آخر ٧ أيام" value={`${analytics.revenueWeek} ${commerce.currency}`} />
          <Stat icon={<Banknote className="h-4 w-4" />} label="إيراد آخر ٣٠ يوم" value={`${analytics.revenueMonth} ${commerce.currency}`} hint={`${analytics.ordersMonth} طلب`} />
          <Stat icon={<Clock className="h-4 w-4" />} label="طلبات جديدة بتستناك" value={String(analytics.newCount)} hint="حدّث حالتها من تبويب الطلبات" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* إيراد آخر 14 يوم */}
          <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
            <p className="mb-3 text-xs font-black">إيراد آخر ١٤ يوم</p>
            <div dir="ltr" className="flex h-32 items-end gap-1">
              {analytics.daily.map((day) => {
                const max = Math.max(...analytics.daily.map((d) => d.revenue), 1);
                return (
                  <div key={day.dayStart} className="group relative flex-1">
                    <div
                      className={cx(
                        "w-full rounded-t transition-all",
                        day.revenue > 0 ? "bg-accent/70 group-hover:bg-accent" : "bg-surface-2",
                      )}
                      style={{ height: `${Math.max(4, Math.round((day.revenue / max) * 100))}%` }}
                    />
                    <span className="pointer-events-none absolute -top-6 start-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-bg group-hover:block">
                      {day.revenue} {commerce.currency}
                    </span>
                  </div>
                );
              })}
            </div>
            <div dir="rtl" className="mt-1.5 flex justify-between text-[10px] text-muted">
              <span>قبل ١٤ يوم</span>
              <span>النهارده</span>
            </div>
          </div>

          {/* أعلى المنتجات بالإيراد */}
          <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
            <p className="mb-3 text-xs font-black">أعلى المنتجات بالإيراد — آخر ٣٠ يوم</p>
            {analytics.topProducts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-[11px] text-muted">
                لسه مفيش بيانات كفاية — هتظهر هنا مع أول الطلبات المسجّلة
              </p>
            ) : (
              <ul className="space-y-2">
                {analytics.topProducts.map((product, index) => {
                  const max = analytics.topProducts[0].revenue || 1;
                  return (
                    <li key={product.name}>
                      <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                        <span className="truncate">
                          <span className="text-muted">{index + 1}.</span> {product.name}
                          <span className="ms-1 text-muted/70">({product.quantity} قطعة)</span>
                        </span>
                        <span className="shrink-0 text-accent">{product.revenue} {commerce.currency}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.round((product.revenue / max) * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      {!overview.storage.persistent ? (
        <div className="rounded-card border border-red-500/30 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-300">
          <p className="font-black">قاعدة البيانات الحالية تخزين مؤقت</p>
          <p className="mt-1">
            البيانات بتتحفظ في ملف مؤقت على السيرفر وهتضيع مع كل إعادة تشغيل. عشان الحفظ يبقى دائم على Vercel
            نفّذ محتوى <span dir="ltr" className="font-mono">supabase/schema.sql</span> مرة واحدة في Supabase → SQL Editor،
            وبعدها الكتالوج والطلبات هيتحفظوا في Postgres.
          </p>
        </div>
      ) : null}

      {overviewError ? (
        <div className="rounded-card border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-bold text-amber-300">
          {overviewError}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="صحة المتجر" description="كل النقاط دي لازم تبقى خضراء قبل ما تفتح للعملاء" icon={<CircleCheck className="h-4 w-4" />}>
          <ul className="space-y-2">
            {checks.map((check) => (
              <li
                key={check.label}
                className={cx(
                  "flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5",
                  check.ok ? "border-line bg-surface-2/50" : "border-amber-500/30 bg-amber-500/8",
                )}
              >
                <span className="flex items-start gap-2 text-xs font-bold">
                  {check.ok ? (
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="flex flex-col">
                    {check.label}
                    {!check.ok ? <span className="mt-0.5 text-[11px] font-medium text-muted">{check.fix}</span> : null}
                  </span>
                </span>
                {!check.ok ? (
                  <button onClick={() => onJump(check.tab)} className="shrink-0 text-[11px] font-black text-accent hover:underline">
                    عدّل <ArrowUpRight className="inline h-3 w-3" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="آخر الطلبات"
            description="مسجّلة في الباك إند قبل فتح رسالة واتساب"
            icon={<Receipt className="h-4 w-4" />}
            actions={
              overview.orders.length > 0 ? (
                <Button size="sm" variant="soft" onClick={() => onJump("orders")}>
                  إدارة الطلبات <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              ) : undefined
            }
          >
            {overview.orders.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface-2/40 p-3 text-[11px] text-muted">
                لسه مفيش طلبات — أول طلب من الموقع هيتسجّل هنا فوراً.
              </p>
            ) : (
              <ul className="space-y-2">
                {overview.orders.slice(0, 5).map((order) => (
                  <li key={order.id} className="rounded-xl border border-line bg-surface-2/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-mono text-[11px] font-black text-accent">
                          {order.id}
                        </span>
                        <Badge tone={orderStatusOf(order) === "cancelled" ? "danger" : "accent"}>
                          {ORDER_STATUS_LABEL[orderStatusOf(order)].ar}
                        </Badge>
                      </div>
                      <span className="text-[11px] font-black">
                        {order.total} {commerce.currency}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {order.customer?.name || "عميل"} · {ORDER_TYPE_LABEL[order.orderType] ?? order.orderType} ·{" "}
                      {new Date(order.createdAt).toLocaleString("ar-EG")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {order.lines?.map((line) => `${line.name} ×${line.quantity}`).join("، ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="حفظ سحابي" description="أي تعديل بيتخزن أوتوماتيك في الباك إند" icon={<Database className="h-4 w-4" />}>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
                <span className="text-muted">حجم بيانات الكتالوج</span>
                <span className="font-black">{storageKb} KB</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (storageKb / 5000) * 100)}%` }} />
              </div>
              <p className="text-[11px] leading-relaxed text-muted">
                {isCustomized
                  ? "التعديلات محفوظة في قاعدة بيانات الموقع ومتاحة فوراً لكل العملاء والأجهزة."
                  : "جاري تجهيز قاعدة بيانات الموقع."}
              </p>
              <Badge tone={isCustomized ? "success" : "neutral"}>
                {isCustomized ? "متصل بالباك إند" : "جاري الاتصال"}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onJump("data")}>
                <Database className="h-3.5 w-3.5" /> تصدير / استيراد
              </Button>
              <a
                href="/"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent/60 hover:text-accent"
              >
                فتح الموقع <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </Panel>

          <Panel title="إجراءات سريعة" icon={<Plus className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction label="منتج جديد" hint="أضف منتج للكتالوج" onClick={() => onJump("items", "new")} />
              <QuickAction label="قسم جديد" hint="صنّف منتجاتك أحسن" onClick={() => onJump("categories", "new")} />
              <QuickAction label="مورد جديد" hint="أضف مورد للمنتجات" onClick={() => onJump("suppliers")} />
              <QuickAction label="غيّر اللون" hint="لون الموقع كله" onClick={() => onJump("look")} />
              <QuickAction label="إعلان علوي" hint="عرض أو خصم" onClick={() => onJump("brand")} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3.5">
      <span className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-muted">
        <span className="text-accent">{icon}</span>
        {label}
      </span>
      <p className="text-xl font-black leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted/80">{hint}</p> : null}
    </div>
  );
}

function QuickAction({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl border border-line bg-surface-2/50 p-3 text-start transition hover:border-accent/50">
      <p className="text-xs font-black">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
    </button>
  );
}
