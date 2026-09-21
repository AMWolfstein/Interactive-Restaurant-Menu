"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CircleX,
  ClipboardList,
  Clock,
  Download,
  LoaderCircle,
  MapPin,
  Phone,
  Receipt,
  RotateCcw,
  Search,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { orderStatusOf, ORDER_STATUS_LABEL } from "@/lib/format";
import { subscribeRealtime } from "@/lib/realtime";
import { ORDERS_TABLE } from "@/lib/supabase";
import { authenticatedFetch } from "@/lib/supabase-auth-core";
import { cx } from "@/lib/cx";
import type { AdminOverview, OrderStatus, OrderType, SavedOrder } from "@/lib/types";
import { Badge, Button, Panel, Segmented, TextInput, Toast, useToast } from "@/components/ui";

/**
 * تبويب إدارة الطلبات: كل الطلبات المسجّلة مع فلاتر وبحث وحالات
 * وتصدير CSV — التحديث لحظي عن طريق Realtime مع فحص دوري احتياطي.
 */

const ORDER_TYPE_LABEL: Record<string, string> = {
  delivery: "🛵 توصيل",
  pickup: "🛍️ استلام",
  // طلبات قديمة اتسجلت بنوع «من داخل المحل» قبل ما النوع ده يتشال (المحل مفيهوش طاولات)
  instore: "🏪 من المحل (قديم)",
};

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: "bg-accent/15 text-accent",
  confirmed: "bg-sky-500/15 text-sky-400",
  delivered: "bg-emerald-500/15 text-emerald-400",
  cancelled: "bg-red-500/15 text-red-400",
};

const NEXT_ACTIONS: Record<OrderStatus, { status: OrderStatus; label: string; icon: typeof CircleCheck; tone: string }[]> = {
  new: [
    { status: "confirmed", label: "تأكيد", icon: CircleCheck, tone: "border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20" },
    { status: "delivered", label: "تم التسليم", icon: CircleCheck, tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" },
    { status: "cancelled", label: "إلغاء", icon: CircleX, tone: "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20" },
  ],
  confirmed: [
    { status: "delivered", label: "تم التسليم", icon: CircleCheck, tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" },
    { status: "cancelled", label: "إلغاء", icon: CircleX, tone: "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20" },
  ],
  delivered: [
    { status: "new", label: "إرجاع كجديد", icon: RotateCcw, tone: "border-line bg-surface-2 text-muted hover:text-ink" },
  ],
  cancelled: [
    { status: "new", label: "إرجاع كجديد", icon: RotateCcw, tone: "border-line bg-surface-2 text-muted hover:text-ink" },
  ],
};

type PeriodFilter = "all" | "today" | "week" | "month";

export function OrdersPanel() {
  const { data } = useMenu();
  const { commerce } = data;
  const { toast, show } = useToast();

  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | OrderType>("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "تعذّر قراءة الطلبات");
        return;
      }
      const result = (await response.json()) as AdminOverview;
      setOrders(result.orders ?? []);
      setError(null);
    } catch {
      setError("تعذّر الاتصال بالباك إند");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // تحديث لحظي: طلب جديد أو تغيير حالة من جهاز تاني بيظهر فوراً
    const unsubscribe = subscribeRealtime(
      "realtime:admin-orders-panel",
      [
        { table: ORDERS_TABLE, event: "INSERT" },
        { table: ORDERS_TABLE, event: "UPDATE" },
      ],
      () => void loadOrders(),
    );
    const timer = window.setInterval(() => void loadOrders(), 30_000);
    const kick = window.setTimeout(() => void loadOrders(), 0);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.clearTimeout(kick);
    };
  }, [loadOrders]);

  const changeStatus = async (order: SavedOrder, status: OrderStatus) => {
    if (updatingId) return;
    setUpdatingId(order.id);
    try {
      const response = await authenticatedFetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "تعذّر تحديث الحالة");
      }
      const result = (await response.json()) as { order: SavedOrder };
      setOrders((prev) => prev.map((candidate) => (candidate.id === order.id ? result.order : candidate)));
      show(`تم تحديث ${order.id} → ${ORDER_STATUS_LABEL[status].ar}`);
    } catch (err) {
      show(err instanceof Error ? err.message : "تعذّر تحديث الحالة", "error");
      void loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = useMemo(() => {
    const now = new Date().getTime();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const search = query.trim().toLowerCase();
    return orders.filter((order) => {
      const status = orderStatusOf(order);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (typeFilter !== "all" && order.orderType !== typeFilter) return false;
      const created = new Date(order.createdAt).getTime();
      if (period === "today" && created < dayStart.getTime()) return false;
      if (period === "week" && created < now - 7 * 86_400_000) return false;
      if (period === "month" && created < now - 30 * 86_400_000) return false;
      if (search) {
        const haystack = [
          order.id,
          order.customer?.name,
          order.customer?.phone,
          order.zoneName,
          order.paymentMethod,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, typeFilter, period, query]);

  const counts = useMemo(() => {
    const base = { new: 0, confirmed: 0, delivered: 0, cancelled: 0 };
    for (const order of orders) base[orderStatusOf(order)] += 1;
    return base;
  }, [orders]);

  const exportCsv = () => {
    const rows = [
      ["رقم الطلب", "التاريخ", "الاسم", "الموبايل", "نوع الطلب", "المنطقة", "طريقة الدفع", "الحالة", "عدد القطع", `الإجمالي (${commerce.currency})`, "المنتجات"],
      ...filtered.map((order) => [
        order.id,
        new Date(order.createdAt).toLocaleString("ar-EG"),
        order.customer?.name ?? "",
        order.customer?.phone ?? "",
        ORDER_TYPE_LABEL[order.orderType] ?? order.orderType,
        order.zoneName ?? "",
        order.paymentMethod ?? "",
        ORDER_STATUS_LABEL[orderStatusOf(order)].ar,
        String(order.lines?.reduce((sum, line) => sum + line.quantity, 0) ?? 0),
        String(order.total),
        order.lines?.map((line) => `${line.name} ×${line.quantity}`).join(" | ") ?? "",
      ]),
    ];
    // BOM عشان الإكسل يقرا العربي صح
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    show(`تم تصدير ${filtered.length} طلب`);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="إدارة الطلبات"
        description="كل طلب بيتسجّل هنا لحظة تأكيده من الموقع — حدّث الحالة وتابع التنفيذ"
        icon={<ClipboardList className="h-4 w-4" />}
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5" /> تصدير CSV ({filtered.length})
          </Button>
        }
      >
        {/* الفلاتر */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: `الكل (${orders.length})` },
                { value: "new", label: `جديد (${counts.new})` },
                { value: "confirmed", label: `مؤكد (${counts.confirmed})` },
                { value: "delivered", label: `تم التسليم (${counts.delivered})` },
                { value: "cancelled", label: `ملغي (${counts.cancelled})` },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "all", label: "كل الفترات" },
                { value: "today", label: "النهارده" },
                { value: "week", label: "آخر ٧ أيام" },
                { value: "month", label: "آخر ٣٠ يوم" },
              ]}
            />
            <Segmented
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all", label: "كل الأنواع" },
                { value: "delivery", label: "🛵 توصيل" },
                { value: "pickup", label: "🛍️ استلام" },
              ]}
            />
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-3.5 w-3.5 text-muted" />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="بحث برقم الطلب / الاسم / الموبايل…"
                className="ps-9"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute inset-y-0 end-2 my-auto grid h-6 w-6 place-items-center text-muted hover:text-ink"
                  aria-label="مسح البحث"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-bold text-amber-300">
            {error}
          </p>
        ) : null}

        {/* القائمة */}
        <div className="mt-4 space-y-2.5">
          {loading ? (
            <p className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2/40 p-8 text-xs font-bold text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> جاري تحميل الطلبات…
            </p>
          ) : filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-xs text-muted">
              {orders.length === 0
                ? "لسه مفيش طلبات مسجّلة — أول طلب من الموقع هيظهر هنا فوراً 🔔"
                : "مفيش طلبات مطابقة للفلاتر الحالية"}
            </p>
          ) : (
            filtered.map((order) => {
              const status = orderStatusOf(order);
              const actions = NEXT_ACTIONS[status];
              const busy = updatingId === order.id;
              return (
                <article
                  key={order.id}
                  className={cx(
                    "rounded-xl2 border border-line bg-surface-2/40 p-3.5 transition",
                    status === "new" && "border-accent/30 bg-accent/5",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="ltr" className="font-mono text-xs font-black text-accent">{order.id}</span>
                      <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-black", STATUS_STYLE[status])}>
                        {ORDER_STATUS_LABEL[status].ar}
                      </span>
                      <span className="text-[11px] text-muted">{ORDER_TYPE_LABEL[order.orderType] ?? order.orderType}</span>
                      {order.zoneName ? (
                        <Badge tone="neutral"><MapPin className="h-3 w-3" /> {order.zoneName}</Badge>
                      ) : null}
                      {order.paymentMethod ? (
                        <Badge tone="neutral"><Wallet className="h-3 w-3" /> {order.paymentMethod}</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted">
                        <Clock className="me-1 inline h-3 w-3" />
                        {new Date(order.createdAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <span className="text-sm font-black">{order.total} {commerce.currency}</span>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span className="font-bold text-ink">{order.customer?.name || "عميل"}</span>
                    {order.customer?.phone ? (
                      <a href={`tel:${order.customer.phone.replace(/\D/g, "")}`} className="inline-flex items-center gap-1 font-bold transition hover:text-accent" dir="ltr">
                        <Phone className="h-3 w-3" /> {order.customer.phone}
                      </a>
                    ) : null}
                    {order.customer?.address ? <span className="max-w-full truncate">📍 {order.customer.address}</span> : null}
                  </div>

                  <p className="mt-2 rounded-xl border border-line bg-surface p-2.5 text-[11px] leading-relaxed text-muted">
                    <Receipt className="me-1 inline h-3 w-3 text-accent" />
                    {order.lines?.map((line) => `${line.name} ×${line.quantity}`).join("، ")}
                    {order.customer?.notes ? <span className="block pt-1 text-muted/80">📝 {order.customer.notes}</span> : null}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {actions.map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        disabled={busy}
                        onClick={() => void changeStatus(order, action.status)}
                        className={cx(
                          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-black transition disabled:opacity-40",
                          action.tone,
                        )}
                      >
                        {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <action.icon className="h-3 w-3" />}
                        {action.label}
                      </button>
                    ))}
                    {order.orderType === "delivery" ? (
                      <span className="ms-auto text-[10px] text-muted/70">
                        <Truck className="me-1 inline h-3 w-3" /> توصيل
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <p className="mt-3 text-[11px] text-muted/70">
          بتتعرض آخر 500 طلب كحد أقصى — استخدم التصدير CSV لأرشفة كاملة أو للمحاسبة.
        </p>
      </Panel>

      {toast ? <Toast message={toast.text} tone={toast.tone} /> : null}
    </div>
  );
}
