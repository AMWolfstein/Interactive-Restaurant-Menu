"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Clock,
  LoaderCircle,
  Phone,
  Receipt,
  Search,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { orderStatusOf } from "@/lib/format";
import { loyaltyStatus } from "@/lib/loyalty";
import { authenticatedFetch } from "@/lib/supabase-auth-core";
import { cx } from "@/lib/cx";
import type { CustomerRecord, SavedOrder } from "@/lib/types";
import { Badge, Panel, TextInput, useToast } from "@/components/ui";

/**
 * تبويب العملاء — نظام «كاشك».
 *
 * البحث هنا بيتم على السيرفر (جدول customers)، فمش مقيّد بآخر ٥٠٠ طلب زي
 * البحث اللي في تبويب الطلبات. تدوّر برقم موبايل أو اسم وتوصل لكل مشتريات
 * العميل ورصيده الحالي ناحية المكافأة.
 */
export function CustomersPanel() {
  const { data } = useMenu();
  const { commerce } = data;
  const loyalty = commerce.loyalty;
  const { toast, show } = useToast();

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<CustomerRecord | null>(null);
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const money = (value: number) => `${Math.round(value).toLocaleString("en-US")} ${commerce.currency}`;

  // بحث على السيرفر مع تأخير بسيط عشان ميتبعتش نداء مع كل حرف
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFetching(true);
      try {
        const response = await authenticatedFetch(
          `/api/admin/customers?q=${encodeURIComponent(query.trim())}`,
        );
        const result = (await response.json()) as { customers?: CustomerRecord[]; error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(result.error || "تعذّر قراءة العملاء");
        setCustomers(result.customers ?? []);
      } catch (error) {
        if (!cancelled) show(error instanceof Error ? error.message : "تعذّر قراءة العملاء", "error");
      } finally {
        if (!cancelled) {
          setFetching(false);
          setLoaded(true);
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, show]);

  const openCustomer = useCallback(
    async (customer: CustomerRecord) => {
      setSelected(customer);
      setOrdersLoading(true);
      setOrders([]);
      try {
        const response = await authenticatedFetch(
          `/api/admin/customers?phone=${encodeURIComponent(customer.phone)}`,
        );
        const result = (await response.json()) as {
          orders?: SavedOrder[];
          customer?: CustomerRecord | null;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "تعذّر قراءة الطلبات");
        setOrders(result.orders ?? []);
        if (result.customer) setSelected(result.customer);
      } catch (error) {
        show(error instanceof Error ? error.message : "تعذّر قراءة الطلبات", "error");
      } finally {
        setOrdersLoading(false);
      }
    },
    [show],
  );

  const totals = useMemo(() => {
    const eligible = customers.filter((row) => row.spent >= loyalty.threshold).length;
    return {
      count: customers.length,
      eligible,
      lifetime: customers.reduce((sum, row) => sum + row.lifetime, 0),
      given: customers.reduce((sum, row) => sum + row.discountTotal, 0),
    };
  }, [customers, loyalty.threshold]);

  /* ── شاشة عميل واحد ───────────────────────────────────────────────── */
  if (selected) {
    const status = loyaltyStatus(loyalty, selected.spent);
    return (
      <>
        <Panel
          title={selected.name || "عميل"}
          icon={<Users className="h-4 w-4" />}
          actions={
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] font-bold text-muted transition hover:text-ink"
            >
              <ArrowRight className="h-3.5 w-3.5" /> رجوع للقائمة
            </button>
          }
        >
          <a
            href={`tel:${selected.phone}`}
            dir="ltr"
            className="inline-flex items-center gap-1.5 text-sm font-black text-accent"
          >
            <Phone className="h-3.5 w-3.5" /> {selected.phone}
          </a>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="إجمالي المشتريات" value={money(selected.lifetime)} />
            <Stat label="عدد الطلبات" value={String(selected.ordersCount)} />
            <Stat label="مرات المكافأة" value={String(selected.rewardsUsed)} />
            <Stat label="إجمالي الخصومات" value={money(selected.discountTotal)} />
          </div>

          {/* رصيد كاشك */}
          <div
            className={cx(
              "mt-3 rounded-xl2 border p-3.5",
              status.eligible
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-line bg-surface-2/40",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-black">
                <Sparkles className={cx("h-4 w-4", status.eligible ? "text-emerald-400" : "text-accent")} />
                رصيد {loyalty.label}
              </p>
              <span className="text-sm font-black">
                {money(selected.spent)} / {money(loyalty.threshold)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
              <div
                className={cx(
                  "h-full rounded-full transition-all",
                  status.eligible ? "bg-emerald-500" : "bg-accent",
                )}
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] font-bold text-muted">
              {!loyalty.enabled
                ? "نظام كاشك مقفول حالياً — الرصيد بيتسجّل بس مفيش خصم بيتطبّق"
                : status.eligible
                  ? `مستحق خصم ${loyalty.percent}٪ على طلبه الجاي 🎉`
                  : `فاضل ${money(status.remaining)} عشان يستحق خصم ${loyalty.percent}٪`}
            </p>
          </div>
        </Panel>

        <Panel title={`طلبات العميل (${orders.length})`} icon={<Receipt className="h-4 w-4" />}>
          {ordersLoading ? (
            <p className="flex items-center justify-center gap-2 p-8 text-xs font-bold text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> جاري التحميل…
            </p>
          ) : orders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-xs text-muted">
              مفيش طلبات مسجّلة للعميل ده
            </p>
          ) : (
            <div className="space-y-2.5">
              {orders.map((order) => {
                const cancelled = orderStatusOf(order) === "cancelled";
                return (
                  <article
                    key={order.id}
                    className={cx(
                      "rounded-xl2 border border-line bg-surface-2/40 p-3",
                      cancelled && "opacity-60",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span dir="ltr" className="font-mono text-xs font-black text-accent">
                          {order.id}
                        </span>
                        {cancelled ? <Badge tone="danger">ملغي</Badge> : null}
                        {order.loyalty ? (
                          <Badge tone="success">
                            <Sparkles className="h-3 w-3" /> خصم {order.loyalty.percent}٪
                          </Badge>
                        ) : null}
                        {order.paymentMethod ? (
                          <Badge tone="neutral">
                            <Wallet className="h-3 w-3" /> {order.paymentMethod}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted">
                          <Clock className="me-1 inline h-3 w-3" />
                          {new Date(order.createdAt).toLocaleString("ar-EG", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                        <span className="text-sm font-black">
                          {order.total} {commerce.currency}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">
                      {order.lines?.map((line) => `${line.name} ×${line.quantity}`).join("، ")}
                    </p>
                    {order.loyalty ? (
                      <p className="mt-1.5 text-[11px] font-bold text-emerald-400">
                        اتخصم {money(order.loyalty.discount)} من الفاتورة دي ({loyalty.label})
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </Panel>
        {toast}
      </>
    );
  }

  /* ── قائمة العملاء ────────────────────────────────────────────────── */
  return (
    <>
      <Panel title="العملاء" icon={<Users className="h-4 w-4" />}>
        {!loyalty.enabled ? (
          <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-bold text-amber-300">
            نظام كاشك مقفول حالياً — أرصدة العملاء بتتسجّل عادي بس مفيش خصم بيتطبّق.
            تقدر تفعّله من تبويب «الطلب والأسعار».
          </p>
        ) : null}

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="عدد العملاء" value={String(totals.count)} />
          <Stat label="مستحقين خصم" value={String(totals.eligible)} accent />
          <Stat label="إجمالي مشترياتهم" value={money(totals.lifetime)} />
          <Stat label="خصومات اتصرفت" value={money(totals.given)} />
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-3.5 w-3.5 text-muted" />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="بحث برقم الموبايل أو الاسم…"
            className="ps-9"
            inputMode="search"
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
        <p className="mt-1.5 text-[11px] text-muted">
          البحث بيتم على السيرفر — بيلاقي العميل حتى لو طلبه قديم ومش في آخر ٥٠٠ طلب.
          الأرقام بتتوحّد تلقائياً، يعني ‎+20‎ و‎0‎ نفس العميل.
        </p>

        <div className="mt-4 space-y-2">
          {!loaded || fetching ? (
            <p className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2/40 p-8 text-xs font-bold text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> جاري التحميل…
            </p>
          ) : customers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-xs text-muted">
              {query
                ? "مفيش عميل بالبيانات دي"
                : "لسه مفيش عملاء مسجّلين — أول طلب برقم موبايل هيظهر هنا"}
            </p>
          ) : (
            customers.map((customer) => {
              const status = loyaltyStatus(loyalty, customer.spent);
              return (
                <button
                  key={customer.phone}
                  type="button"
                  onClick={() => void openCustomer(customer)}
                  className={cx(
                    "w-full rounded-xl2 border p-3 text-start transition hover:border-accent/40",
                    status.eligible ? "border-emerald-500/40 bg-emerald-500/5" : "border-line bg-surface-2/40",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black">{customer.name || "عميل"}</p>
                      <p dir="ltr" className="text-[11px] font-bold text-muted">
                        {customer.phone}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-sm font-black">{money(customer.lifetime)}</p>
                      <p className="text-[11px] text-muted">{customer.ordersCount} طلب</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className={cx(
                        "h-full rounded-full",
                        status.eligible ? "bg-emerald-500" : "bg-accent",
                      )}
                      style={{ width: `${status.progress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-muted">
                    {status.eligible ? (
                      <span className="text-emerald-400">
                        مستحق خصم {loyalty.percent}٪ 🎉 (رصيد {money(customer.spent)})
                      </span>
                    ) : (
                      `فاضل ${money(status.remaining)} على المكافأة`
                    )}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </Panel>
      {toast}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-xl border p-3",
        accent ? "border-emerald-500/30 bg-emerald-500/10" : "border-line bg-surface-2/40",
      )}
    >
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cx("mt-0.5 text-sm font-black", accent && "text-emerald-400")}>{value}</p>
    </div>
  );
}
