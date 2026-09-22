"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CircleX,
  Clock,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  Wallet,
  X,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { useStaffSession } from "@/lib/use-staff-session";
import { authenticatedFetch } from "@/lib/supabase-auth-core";
import { formatPrice, ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, orderStatusOf } from "@/lib/format";
import { subscribeRealtime } from "@/lib/realtime";
import { ORDERS_TABLE } from "@/lib/supabase";
import { flashTitle, playOrderChime, primeAlertAudio, stopTitleFlash } from "@/lib/alerts";
import { cx } from "@/lib/cx";
import type { OrderStatus, SavedOrder } from "@/lib/types";
import { Button, Field, TextInput, Toast, useToast } from "@/components/ui";
import { InvoicePreview } from "./invoice-preview";

/**
 * شاشة الفواتير للموظف — بسيطة ومخصصة للموبايل:
 *   دخول → الطلبات الجديدة → فتح الطلب → توليد فاتورة → مشاركة.
 *
 * كل البيانات بتيجي من /api/invoices/orders اللي بيقرا نفس جدول orders
 * اللي بتقرا منه لوحة الأدمن — مفيش أي جدول أو نسخة تانية من الطلبات.
 */

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: "bg-accent/15 text-accent",
  cancelled: "bg-red-500/15 text-red-400",
};

// نفس منطق لوحة الأدمن: الطلب من الموقع هيتنفذ (توصيل أو استلام)، فالإجراء
// الوحيد هو الإلغاء — والموظف مش بياخد صلاحيات زيادة (مفيش إرجاع للملغي).
const NEXT_ACTIONS: Record<OrderStatus, { status: OrderStatus; label: string; tone: string }[]> = {
  new: [
    { status: "cancelled", label: "إلغاء", tone: "border-red-500/40 bg-red-500/10 text-red-400" },
  ],
  cancelled: [],
};

export function InvoicesApp() {
  const { data } = useMenu();
  const session = useStaffSession();

  const storeName = data.brand.storeName || data.brand.storeNameEn || "الفواتير";

  if (!session.checked) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-muted" dir="rtl">
        <span className="flex items-center gap-2 text-sm font-bold">
          <LoaderCircle className="h-4 w-4 animate-spin" /> جاري التحقق من الجلسة…
        </span>
      </div>
    );
  }

  if (!session.authed || (session.authed && !session.role)) {
    return <StaffLogin session={session} storeName={storeName} logo={data.brand.logo} />;
  }

  return <InvoicesWorkspace session={session} storeName={storeName} />;
}

/* --------------------------------------------------------------- الدخول */

function StaffLogin({
  session,
  storeName,
  logo,
}: {
  session: ReturnType<typeof useStaffSession>;
  storeName: string;
  logo: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shake, setShake] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await session.signIn(email, password);
    if (!ok) {
      setShake(true);
      setPassword("");
      window.setTimeout(() => setShake(false), 700);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4" dir="rtl">
      <form
        onSubmit={submit}
        className={cx(
          "w-full max-w-sm rounded-xl2 border border-line bg-surface p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,.8)] transition",
          shake && "animate-[shake_.4s_ease-in-out] border-red-500/50",
        )}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="mb-4 h-12 w-12 rounded-2xl border border-line object-cover" />
        ) : (
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-accent-contrast">
            <Receipt className="h-5 w-5" />
          </span>
        )}

        <h1 className="text-lg font-black">{storeName}</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          شاشة الطلبات والفواتير للموظفين — سجّل دخولك بحساب المحل.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="الإيميل">
            <div className="relative">
              <Mail className="pointer-events-none absolute inset-y-0 start-3 my-auto h-3.5 w-3.5 text-muted" />
              <TextInput
                autoFocus
                type="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="staff@store.com"
                className="ps-9 text-start"
                required
              />
            </div>
          </Field>
          <Field label="الباسورد">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute inset-y-0 start-3 my-auto h-3.5 w-3.5 text-muted" />
              <TextInput
                type="password"
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="ps-9 text-start"
                required
              />
            </div>
          </Field>
        </div>

        {shake || session.authError || session.serverError ? (
          <p className="mt-2 text-[11px] font-bold text-red-400">
            {session.authError || session.serverError || "بيانات الدخول غير صحيحة"}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="mt-4 w-full" disabled={session.busy || !session.configured}>
          {session.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} دخول
        </Button>

        {!session.configured ? (
          <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/8 p-2.5 text-[11px] leading-relaxed text-red-300">
            متغيرات Supabase غير موجودة في البيئة دي.
          </p>
        ) : null}
      </form>
      <style>{`@keyframes shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}`}</style>
    </div>
  );
}

/* ------------------------------------------------------- شاشة العمل */

function InvoicesWorkspace({
  session,
  storeName,
}: {
  session: ReturnType<typeof useStaffSession>;
  storeName: string;
}) {
  const { data } = useMenu();
  const { toast, show } = useToast();

  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const firstLoad = useRef(true);
  const knownIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/invoices/orders", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "تعذّر قراءة الطلبات");
        return;
      }
      const payload = (await response.json()) as { orders?: SavedOrder[] };
      const next = payload.orders ?? [];

      // تنبيه الموظف بأي طلب جديد وصل وهو فاتح الشاشة
      if (!firstLoad.current) {
        const fresh = next.filter((order) => !knownIds.current.has(order.id));
        if (fresh.length > 0) {
          playOrderChime();
          flashTitle("🔔 طلب جديد!");
        }
      }
      knownIds.current = new Set(next.map((order) => order.id));
      firstLoad.current = false;

      setOrders(next);
      setError(null);
    } catch {
      setError("تعذّر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Realtime الموجود أصلاً في المشروع — من غير polling عدواني.
    // فيه فحص احتياطي كل دقيقتين بس لو الـWebSocket اتقطع.
    const unsubscribe = subscribeRealtime(
      "realtime:invoices-orders",
      [
        { table: ORDERS_TABLE, event: "INSERT" },
        { table: ORDERS_TABLE, event: "UPDATE" },
      ],
      () => void load(),
    );
    const prime = () => primeAlertAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    const timer = window.setInterval(() => void load(), 120_000);
    // نفس أسلوب لوحة الأدمن: أول تحميل بعد الرندر عشان ما نعملش setState
    // متزامن جوه الـeffect.
    const kick = window.setTimeout(() => void load(), 0);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.clearTimeout(kick);
      window.removeEventListener("pointerdown", prime);
      stopTitleFlash();
    };
  }, [load]);

  const changeStatus = async (order: SavedOrder, status: OrderStatus) => {
    if (updatingId) return;
    setUpdatingId(order.id);
    try {
      const response = await authenticatedFetch("/api/invoices/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "تعذّر تحديث الحالة");
      }
      const result = (await response.json()) as { order: SavedOrder };
      setOrders((prev) => prev.map((item) => (item.id === order.id ? result.order : item)));
      show(`${order.id} → ${ORDER_STATUS_LABEL[status].ar}`);
    } catch (err) {
      show(err instanceof Error ? err.message : "تعذّر تحديث الحالة", "error");
      void load();
    } finally {
      setUpdatingId(null);
    }
  };

  const counts = useMemo(() => {
    const base = { new: 0, cancelled: 0 };
    for (const order of orders) base[orderStatusOf(order)] += 1;
    return base;
  }, [orders]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return orders
      .filter((order) => {
        if (statusFilter !== "all" && orderStatusOf(order) !== statusFilter) return false;
        if (!search) return true;
        const haystack = [order.id, order.customer?.name, order.customer?.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
      // الجديد الأول، وبعدين الأحدث زمنياً
      .sort((a, b) => {
        const aNew = orderStatusOf(a) === "new" ? 0 : 1;
        const bNew = orderStatusOf(b) === "new" ? 0 : 1;
        if (aNew !== bNew) return aNew - bNew;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [orders, query, statusFilter]);

  const openOrder = openId ? orders.find((order) => order.id === openId) ?? null : null;
  const invoiceOrder = invoiceId ? orders.find((order) => order.id === invoiceId) ?? null : null;

  return (
    <div className="min-h-screen bg-bg text-ink" dir="rtl">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-black">{storeName}</p>
            <p className="truncate text-[11px] text-muted">
              {session.email}
              {session.role === "admin" ? " • أدمن" : " • موظف فواتير"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="تحديث"
              className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-accent"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void session.logout()}
              aria-label="خروج"
              className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-3xl space-y-2 px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted" />
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="بحث برقم الطلب أو الاسم أو الموبايل…"
              className="ps-10"
              inputMode="search"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
                className="absolute inset-y-0 end-2 my-auto grid h-7 w-7 place-items-center text-muted"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {(
              [
                { value: "all", label: `الكل (${orders.length})` },
                { value: "new", label: `جديد (${counts.new})` },
                { value: "cancelled", label: `ملغي (${counts.cancelled})` },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                className={cx(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition",
                  statusFilter === option.value ? "bg-accent text-accent-contrast" : "bg-surface text-muted",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-2.5 px-4 py-4 pb-24">
        {error ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-bold text-amber-300">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2/40 p-10 text-xs font-bold text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" /> جاري تحميل الطلبات…
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-10 text-center text-xs text-muted">
            {orders.length === 0 ? "مفيش طلبات لسه — أول طلب هيظهر هنا فوراً 🔔" : "مفيش طلبات مطابقة"}
          </p>
        ) : (
          filtered.map((order) => {
            const status = orderStatusOf(order);
            return (
              <article
                key={order.id}
                className={cx(
                  "rounded-xl2 border border-line bg-surface p-3.5",
                  status === "new" && "border-accent/40 bg-accent/5",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="font-mono text-sm font-black text-accent">
                      #{order.id}
                    </span>
                    <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-black", STATUS_STYLE[status])}>
                      {ORDER_STATUS_LABEL[status].ar}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted">
                    <Clock className="me-1 inline h-3 w-3" />
                    {new Date(order.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                  <span className="font-bold text-ink">{order.customer?.name || "عميل"}</span>
                  <span>{ORDER_TYPE_LABEL[order.orderType]?.ar ?? order.orderType}</span>
                  <span className="ms-auto text-sm font-black text-ink">
                    {formatPrice(order.total, "ar", data.commerce)}
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpenId(order.id)}>
                    <ArrowRight className="h-3.5 w-3.5" /> عرض
                  </Button>
                  <Button size="sm" onClick={() => setInvoiceId(order.id)}>
                    <Receipt className="h-3.5 w-3.5" /> فاتورة
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </main>

      {openOrder ? (
        <OrderDetails
          order={openOrder}
          busy={updatingId === openOrder.id}
          onClose={() => setOpenId(null)}
          onInvoice={() => setInvoiceId(openOrder.id)}
          onStatus={(status) => void changeStatus(openOrder, status)}
        />
      ) : null}

      {invoiceOrder ? (
        <InvoicePreview key={invoiceOrder.id} order={invoiceOrder} onClose={() => setInvoiceId(null)} />
      ) : null}

      {toast ? <Toast message={toast.text} tone={toast.tone} /> : null}
    </div>
  );
}

/* --------------------------------------------------- تفاصيل الطلب */

function OrderDetails({
  order,
  busy,
  onClose,
  onInvoice,
  onStatus,
}: {
  order: SavedOrder;
  busy: boolean;
  onClose: () => void;
  onInvoice: () => void;
  onStatus: (status: OrderStatus) => void;
}) {
  const { data } = useMenu();
  const { commerce } = data;
  const status = orderStatusOf(order);

  // كل الأرقام من لقطة الطلب نفسه — مفيش إعادة حساب من أسعار المنتجات الحالية
  const linesTotal = (order.lines ?? []).reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const subtotal = typeof order.subtotal === "number" ? order.subtotal : linesTotal;
  const delivery = typeof order.deliveryFee === "number" ? order.deliveryFee : 0;
  const service = typeof order.serviceFee === "number" ? order.serviceFee : 0;
  const discount = Math.max(0, Math.round((subtotal + delivery + service - order.total) * 100) / 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/75 backdrop-blur-sm" dir="rtl">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 cursor-default" />

      <div className="relative mt-auto flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl2 border-t border-line bg-bg sm:m-auto sm:max-w-lg sm:rounded-xl2 sm:border">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p dir="ltr" className="font-mono text-sm font-black text-accent">#{order.id}</p>
            <p className="text-[11px] text-muted">
              {new Date(order.createdAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={cx("rounded-full px-2 py-0.5 font-black", STATUS_STYLE[status])}>
              {ORDER_STATUS_LABEL[status].ar}
            </span>
            <span className="text-muted">{ORDER_TYPE_LABEL[order.orderType]?.ar ?? order.orderType}</span>
            {order.zoneName ? (
              <span className="text-muted"><MapPin className="me-1 inline h-3 w-3" />{order.zoneName}</span>
            ) : null}
            {order.paymentMethod ? (
              <span className="text-muted"><Wallet className="me-1 inline h-3 w-3" />{order.paymentMethod}</span>
            ) : null}
          </div>

          {order.customer?.name || order.customer?.phone || order.customer?.address ? (
            <div className="rounded-xl border border-line bg-surface p-3 text-[12px]">
              {order.customer?.name ? <p className="font-bold">{order.customer.name}</p> : null}
              {order.customer?.phone ? (
                <a
                  href={`tel:${order.customer.phone.replace(/\D/g, "")}`}
                  dir="ltr"
                  className="mt-1 inline-flex items-center gap-1 font-bold text-accent"
                >
                  <Phone className="h-3 w-3" /> {order.customer.phone}
                </a>
              ) : null}
              {order.customer?.address ? (
                <p className="mt-1 leading-relaxed text-muted">📍 {order.customer.address}</p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl border border-line bg-surface">
            {(order.lines ?? []).map((line, index) => (
              <div
                key={`${line.itemId}-${index}`}
                className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{line.name}</span>
                <span className="shrink-0 text-muted">×{line.quantity}</span>
                <span className="shrink-0 font-black">
                  {formatPrice(line.unitPrice * line.quantity, "ar", commerce)}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 rounded-xl border border-line bg-surface p-3 text-[13px]">
            <Row label="المجموع" value={formatPrice(subtotal, "ar", commerce)} />
            {delivery > 0 ? <Row label="التوصيل" value={formatPrice(delivery, "ar", commerce)} /> : null}
            {service > 0 ? <Row label="الخدمة" value={formatPrice(service, "ar", commerce)} /> : null}
            {discount > 0 ? (
              <Row
                label={order.loyalty ? `خصم ${commerce.loyalty.label} ${order.loyalty.percent}٪` : "الخصم"}
                value={`- ${formatPrice(discount, "ar", commerce)}`}
                tone="text-emerald-400"
              />
            ) : null}
            <div className="flex items-center justify-between border-t border-line pt-2 text-base font-black">
              <span>الإجمالي</span>
              <span className="text-accent">{formatPrice(order.total, "ar", commerce)}</span>
            </div>
          </div>

          {order.customer?.notes ? (
            <p className="rounded-xl border border-line bg-surface p-3 text-[12px] leading-relaxed text-muted">
              📝 {order.customer.notes}
            </p>
          ) : null}

          {NEXT_ACTIONS[status].length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {NEXT_ACTIONS[status].map((action) => (
                <button
                  key={action.status}
                  type="button"
                  disabled={busy}
                  onClick={() => onStatus(action.status)}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-black transition disabled:opacity-40",
                    action.tone,
                  )}
                >
                  {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <CircleX className="h-3 w-3" />}
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted/70">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
            الأسعار المعروضة هي أسعار وقت تسجيل الطلب — أي تعديل في المنتجات بعد كده مش بيغيّر الفاتورة دي.
          </p>
        </div>

        <footer className="border-t border-line p-3">
          <Button size="lg" className="w-full" onClick={onInvoice}>
            <Receipt className="h-4 w-4" /> توليد فاتورة
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={cx("font-bold", tone)}>{value}</span>
    </div>
  );
}
