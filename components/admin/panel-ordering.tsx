"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  CircleDollarSign,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Receipt,
  Save,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { buildOrderMessage, computeTotals, TEMPLATE_TOKENS } from "@/lib/format";
import { orderPrefixFrom } from "@/lib/order-number";
import { describeNextOpening, isStoreOpenBySchedule, WEEK_DAYS_AR } from "@/lib/schedule";
import type { ContactSettings, MenuItem, OrderType } from "@/lib/types";
import type { DetailedLine } from "@/lib/use-cart";
import { cx } from "@/lib/cx";
import {
  Badge,
  Button,
  CheckboxPill,
  Field,
  NumberInput,
  Panel,
  TextArea,
  TextInput,
  Toast,
  Toggle,
  useToast,
} from "@/components/ui";

const TYPE_LABELS: Record<OrderType, string> = {
  delivery: "🛵 توصيل",
  pickup: "🛍️ استلام من المحل",
};

export function OrderingPanel() {
  const { data, patchContact, patchCommerce } = useMenu();
  const { contact, commerce, brand } = data;
  const [sample, setSample] = useState(true);
  const { toast, show } = useToast();

  const demoItem = (id: string, name: string, price: number): MenuItem => ({
    id,
    categoryId: data.categories[0]?.id ?? "",
    name,
    price,
    available: true,
    isNew: false,
    spicy: 0,
  });

  const demoLines: DetailedLine[] = [
    { line: { itemId: "demo1", quantity: 2 }, item: demoItem("demo1", data.items[0]?.name ?? "أرز مصري فاخر — 1 كجم", data.items[0]?.price ?? 55) },
    { line: { itemId: "demo2", quantity: 1 }, item: demoItem("demo2", "شاي العروسة — 250 جم", 60) },
  ];
  const demoZone = commerce.deliveryZones[0] ?? null;
  const demoTotals = computeTotals(demoLines, commerce, "delivery", demoZone);

  const preview = buildOrderMessage(
    {
      name: "أحمد محمود",
      phone: "0101 234 5678",
      address: "التجمع الخامس، شارع التسعين، كمبوند النخيل، عمارة ٤ شقة ١٢",
      notes: "التسليم بعد المغرب لو سمحت",
      orderType: "delivery",
      lines: demoLines,
      totals: demoTotals,
      zoneName: commerce.enableZones ? demoZone?.name : undefined,
      paymentMethod: commerce.paymentMethods[0],
    },
    { lang: brand.language, brand, contact, commerce },
  );

  const orderPrefixPreview = useMemo(
    () =>
      orderPrefixFrom({
        orderPrefix: commerce.orderPrefix,
        storeNameEn: brand.storeNameEn,
        storeName: brand.storeName,
      }),
    [commerce.orderPrefix, brand.storeNameEn, brand.storeName],
  );

  const scheduleOpen = useMemo(
    () => isStoreOpenBySchedule(contact.weeklySchedule ?? []),
    // إعادة الحساب عند أي تعديل في الجدول
    [contact.weeklySchedule],
  );

  const patchSchedule = (day: number, patch: Partial<ContactSettings["weeklySchedule"][number]>) => {
    const next = (contact.weeklySchedule ?? []).map((slot) =>
      slot.day === day ? { ...slot, ...patch } : slot,
    );
    patchContact({ weeklySchedule: next });
  };

  return (
    <div className="space-y-4">
      <Panel title="بيانات التواصل والاستلام" description="الرقم ده اللي الطلبات هتروحه على واتساب" icon={<MessageCircle className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="رقم واتساب المحل" hint="بصيغة دولية من غير + أو صفر في الأول (مثال: 2010xxxxxxxx)">
            <TextInput
              value={contact.whatsapp}
              onChange={(event) => patchContact({ whatsapp: event.target.value })}
              placeholder="201000000000"
              inputMode="tel"
            />
          </Field>
          <Field label="رقم التليفون (للاتصال)">
            <TextInput value={contact.phone} onChange={(event) => patchContact({ phone: event.target.value })} placeholder="0100 000 0000" />
          </Field>
          <Field label="العنوان">
            <TextInput value={contact.address} onChange={(event) => patchContact({ address: event.target.value })} />
          </Field>
          <Field label="رابط الخريطة">
            <TextInput value={contact.mapUrl} onChange={(event) => patchContact({ mapUrl: event.target.value })} placeholder="https://maps.google.com/?q=…" />
          </Field>
          <Field label="مواعيد العمل" hint="نص توضيحي للعملاء — الجدول الفعلي تحت">
            <TextInput value={contact.openingHours} onChange={(event) => patchContact({ openingHours: event.target.value })} />
          </Field>
          <Field label="رسالة القفل" hint="بتظهر فوق الكتالوج وفي السلة لما المحل مقفول">
            <TextInput value={contact.closedMessage} onChange={(event) => patchContact({ closedMessage: event.target.value })} />
          </Field>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Toggle
            label="المحل مفتوح الآن (يدوي)"
            description={contact.autoSchedule ? "متجاهل — الجدول الأوتوماتيكي هو المتحكم حالياً" : "لما تقفله الموقع يفضل يعرض المنتجات بس يقفل زر الإرسال"}
            checked={contact.isOpen}
            onChange={(checked) => patchContact({ isOpen: checked })}
          />
          <Toggle
            label="فتح وقفل أوتوماتيك بالجدول"
            description="المحل يفتح ويقفل لوحده حسب المواعيد الأسبوعية تحت"
            checked={contact.autoSchedule}
            onChange={(checked) => patchContact({ autoSchedule: checked })}
          />
        </div>

        {contact.autoSchedule ? (
          <div className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-black">
                <Clock className="h-4 w-4 text-accent" /> جدول الأسبوع (بتوقيت القاهرة)
              </p>
              <Badge tone={scheduleOpen ? "success" : "danger"}>
                {scheduleOpen ? "مفتوح الآن حسب الجدول ✅" : `مقفل الآن — ${describeNextOpening(contact.weeklySchedule ?? []) || "مفيش مواعيد فتح"} 🔒`}
              </Badge>
            </div>
            <div className="space-y-2">
              {(contact.weeklySchedule ?? []).map((slot) => (
                <div
                  key={slot.day}
                  className={cx(
                    "flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5",
                    !slot.enabled && "opacity-50",
                  )}
                >
                  <label className="flex w-24 shrink-0 items-center gap-2 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(event) => patchSchedule(slot.day, { enabled: event.target.checked })}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {WEEK_DAYS_AR[slot.day]}
                  </label>
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="time"
                      value={slot.open}
                      disabled={!slot.enabled}
                      onChange={(event) => patchSchedule(slot.day, { open: event.target.value })}
                      className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs font-bold outline-none focus:border-accent disabled:opacity-40"
                    />
                    <span className="text-xs text-muted">←</span>
                    <input
                      type="time"
                      value={slot.close}
                      disabled={!slot.enabled}
                      onChange={(event) => patchSchedule(slot.day, { close: event.target.value })}
                      className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs font-bold outline-none focus:border-accent disabled:opacity-40"
                    />
                  </div>
                  {slot.close <= slot.open && slot.enabled ? (
                    <span className="rounded-lg bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-400">
                      لحد بعد نص الليل 🌙
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              الحالة بتتحدث كل دقيقة قدام العميل، والسيرفر بيرفض أي طلب وقت القفل. لو الوقتين متطابقين أو
              القفل قبل الفتح، الفترة بتتحسب لحد بعد نص الليل.
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel title="الأسعار والمصاريف" icon={<CircleDollarSign className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="علامة العملة">
            <TextInput value={commerce.currency} onChange={(event) => patchCommerce({ currency: event.target.value })} placeholder="ج.م" />
          </Field>
          <Field label="أقل مبلغ للطلب" hint="0 = من غير حد أدنى">
            <NumberInput value={commerce.minimumOrder} onValueChange={(value) => patchCommerce({ minimumOrder: value })} suffix={commerce.currency} />
          </Field>
          <Field label="مصروف التوصيل">
            <NumberInput value={commerce.deliveryFee} onValueChange={(value) => patchCommerce({ deliveryFee: value })} suffix={commerce.currency} />
          </Field>
          <Field label="توصيل مجاني بعد" hint="0 = الخاصية معطلة — لو كتبنا 300 التوصيل بيصير مجاني للطلبات فوق 300">
            <NumberInput value={commerce.freeDeliveryOver} onValueChange={(value) => patchCommerce({ freeDeliveryOver: value })} suffix={commerce.currency} />
          </Field>
          <Field label="نسبة الخدمة %" hint="بتتحسب على الإجمالي + التوصيل">
            <NumberInput
              value={commerce.serviceChargePercent}
              onValueChange={(value) => patchCommerce({ serviceChargePercent: Math.min(50, value) })}
              suffix="%"
            />
          </Field>
        </div>

        <div className="mt-3 space-y-3">
          <Field label="أنواع الطلب المتاحة">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TYPE_LABELS) as OrderType[]).map((type) => {
                const active = commerce.orderTypes.includes(type);
                return (
                  <CheckboxPill
                    key={type}
                    active={active}
                    onClick={() => {
                      const next = active ? commerce.orderTypes.filter((t) => t !== type) : [...commerce.orderTypes, type];
                      if (!next.length) {
                        show("لازم نوع طلب واحد على الأقل", "error");
                        return;
                      }
                      patchCommerce({ orderTypes: next });
                    }}
                  >
                    {TYPE_LABELS[type]}
                  </CheckboxPill>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <Toggle label="الاسم مطلوب" checked={commerce.requireName} onChange={(v) => patchCommerce({ requireName: v })} />
            <Toggle label="رقم الموبايل مطلوب" checked={commerce.requirePhone} onChange={(v) => patchCommerce({ requirePhone: v })} />
            <Toggle label="العنوان مطلوب (للتوصيل)" checked={commerce.requireAddress} onChange={(v) => patchCommerce({ requireAddress: v })} />
            <Toggle label="خانة الملاحظات" checked={commerce.enableNotes} onChange={(v) => patchCommerce({ enableNotes: v })} />
            <Toggle label="إظهار الأسعار" checked={commerce.showPrices} onChange={(v) => patchCommerce({ showPrices: v })} />
            <Toggle label="تفعيل السلة" checked={commerce.enableCart} onChange={(v) => patchCommerce({ enableCart: v })} />
          </div>
        </div>
      </Panel>

      {/* ── نظام «كاشك» ─────────────────────────────────────────────────── */}
      <Panel title="نظام كاشك (مكافأة العملاء)" icon={<Sparkles className="h-4 w-4" />}>
        <p className="mb-3 rounded-xl border border-line bg-surface-2/40 p-3 text-[11px] leading-relaxed text-muted">
          لما مشتريات العميل توصل <b className="text-ink">{commerce.loyalty.threshold.toLocaleString("en-US")} {commerce.currency}</b>{" "}
          ياخد خصم <b className="text-ink">{commerce.loyalty.percent}٪</b> على الفاتورة اللي بعدها، وبعدها الرصيد
          يتخصم منه المبلغ ده ويبدأ دورة جديدة (الزيادة بتترحّل للعميل مش بتضيع).
          <br />
          العميل بيتعرّف برقم الموبايل، والرصيد بيتجمّع من قيمة المنتجات بس —
          التوصيل ورسوم الخدمة مش بيتحسبوا ولا بياخدوا خصم. الطلبات الملغية بترجع
          تتشال من الرصيد تلقائياً.
        </p>

        <div className="space-y-3">
          <Toggle
            label="تفعيل نظام كاشك"
            description="لو مقفول، الرصيد بيفضل متسجّل بس مفيش خصم بيتطبّق على أي طلب"
            checked={commerce.loyalty.enabled}
            onChange={(v) => patchCommerce({ loyalty: { ...commerce.loyalty, enabled: v } })}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="اسم النظام" hint="الاسم اللي العميل بيشوفه في السلة والفاتورة">
              <TextInput
                value={commerce.loyalty.label}
                onChange={(event) =>
                  patchCommerce({ loyalty: { ...commerce.loyalty, label: event.target.value.slice(0, 30) } })
                }
                placeholder="كاشك"
              />
            </Field>
            <Field label="المبلغ المطلوب" hint="إجمالي المشتريات اللي بعده العميل يستحق الخصم">
              <NumberInput
                value={commerce.loyalty.threshold}
                onValueChange={(value) =>
                  patchCommerce({ loyalty: { ...commerce.loyalty, threshold: Math.max(1, value) } })
                }
                suffix={commerce.currency}
              />
            </Field>
            <Field label="نسبة الخصم %" hint="الحد الأقصى 50٪">
              <NumberInput
                value={commerce.loyalty.percent}
                onValueChange={(value) =>
                  patchCommerce({ loyalty: { ...commerce.loyalty, percent: Math.min(50, Math.max(0, value)) } })
                }
                suffix="%"
              />
            </Field>
          </div>

          {commerce.loyalty.enabled ? (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] font-bold text-emerald-500">
              مثال: عميل اشترى بـ {commerce.loyalty.threshold.toLocaleString("en-US")} {commerce.currency} → طلبه الجاي
              بـ 1,000 {commerce.currency} هيتخصم منه{" "}
              {Math.round((1000 * commerce.loyalty.percent) / 100).toLocaleString("en-US")} {commerce.currency} ويدفع{" "}
              {(1000 - Math.round((1000 * commerce.loyalty.percent) / 100)).toLocaleString("en-US")} {commerce.currency}.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="مناطق التوصيل"
        description="رسوم توصيل مختلفة لكل منطقة — العميل يختار منطقته في السلة والرسوم بتتحسب تلقائي"
        icon={<MapPin className="h-4 w-4" />}
      >
        <Toggle
          label="تفعيل مناطق التوصيل"
          description="لما تكون مفعّلة وطلب التوصيل شغّال، اختيار المنطقة بيبقى مطلوب قبل الإرسال"
          checked={commerce.enableZones}
          onChange={(checked) => patchCommerce({ enableZones: checked })}
        />

        {commerce.enableZones ? (
          <div className="mt-3 space-y-2">
            {commerce.deliveryZones.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-[11px] text-muted">
                اضيف أول منطقة — مثال: مدينة نصر برسوم ٢٠ ج.م والمعادي بـ ٣٥ ج.م
              </p>
            ) : (
              <div className="space-y-2">
                {commerce.deliveryZones.map((zone, index) => (
                  <div key={zone.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-2/40 p-2.5">
                    <div className="min-w-40 flex-1">
                      <Field label={index === 0 ? "اسم المنطقة" : undefined}>
                        <TextInput
                          value={zone.name}
                          placeholder="مدينة نصر"
                          onChange={(event) => {
                            const next = [...commerce.deliveryZones];
                            next[index] = { ...zone, name: event.target.value };
                            patchCommerce({ deliveryZones: next });
                          }}
                        />
                      </Field>
                    </div>
                    <div className="w-32">
                      <Field label={index === 0 ? `الرسوم (${commerce.currency})` : undefined}>
                        <NumberInput
                          value={zone.fee}
                          onValueChange={(value) => {
                            const next = [...commerce.deliveryZones];
                            next[index] = { ...zone, fee: Math.max(0, value) };
                            patchCommerce({ deliveryZones: next });
                          }}
                        />
                      </Field>
                    </div>
                    <div className="w-36">
                      <Field label={index === 0 ? "أقل طلب (0 = بدون)" : undefined}>
                        <NumberInput
                          value={zone.minimumOrder}
                          onValueChange={(value) => {
                            const next = [...commerce.deliveryZones];
                            next[index] = { ...zone, minimumOrder: Math.max(0, value) };
                            patchCommerce({ deliveryZones: next });
                          }}
                        />
                      </Field>
                    </div>
                    <button
                      type="button"
                      onClick={() => patchCommerce({ deliveryZones: commerce.deliveryZones.filter((z) => z.id !== zone.id) })}
                      className="mb-0.5 grid h-10 w-10 place-items-center rounded-xl border border-line text-muted transition hover:border-red-500/40 hover:text-red-400"
                      aria-label={`حذف ${zone.name || "المنطقة"}`}
                      title="حذف المنطقة"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (commerce.deliveryZones.length >= 30) {
                  show("الحد الأقصى 30 منطقة", "error");
                  return;
                }
                patchCommerce({
                  deliveryZones: [
                    ...commerce.deliveryZones,
                    { id: `zone-${Date.now().toString(36)}`, name: "", fee: commerce.deliveryFee, minimumOrder: 0 },
                  ],
                });
              }}
            >
              <Plus className="h-3.5 w-3.5" /> اضافة منطقة
            </Button>

            <p className="text-[11px] leading-relaxed text-muted">
              رسوم المنطقة بتستبدل رسوم التوصيل العامة، وتوصيل مجاني بعد {commerce.freeDeliveryOver > 0 ? `${commerce.freeDeliveryOver} ${commerce.currency}` : "—"}
              شغال مع المناطق عادي.
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="طرق الدفع"
        description="العميل يختار طريقة الدفع في السلة وتوصللك في رسالة الواتساب — اسيبها فاضية لو بتستخدم كاش بس من غير ما تسأل"
        icon={<Wallet className="h-4 w-4" />}
      >
        {commerce.paymentMethods.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-[11px] text-muted">
            مفيش طرق دفع مضافة — اضيف مثلاً: كاش عند الاستلام، فودافون كاش، انستاباي
          </p>
        ) : (
          <div className="space-y-2">
            {commerce.paymentMethods.map((method, index) => (
              <div key={`${method}-${index}`} className="flex items-center gap-2">
                <TextInput
                  value={method}
                  placeholder="كاش عند الاستلام"
                  onChange={(event) => {
                    const next = [...commerce.paymentMethods];
                    next[index] = event.target.value;
                    patchCommerce({ paymentMethods: next });
                  }}
                />
                <button
                  type="button"
                  onClick={() => patchCommerce({ paymentMethods: commerce.paymentMethods.filter((_, i) => i !== index) })}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-muted transition hover:border-red-500/40 hover:text-red-400"
                  aria-label={`حذف ${method || "الطريقة"}`}
                  title="حذف"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => {
            if (commerce.paymentMethods.length >= 10) {
              show("الحد الأقصى 10 طرق دفع", "error");
              return;
            }
            patchCommerce({ paymentMethods: [...commerce.paymentMethods, ""] });
          }}
        >
          <Plus className="h-3.5 w-3.5" /> اضافة طريقة دفع
        </Button>

        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          بتظهر كذلك في فوتر الموقع، ومتاحة في قالب الواتساب بالمتغيّر <span dir="ltr" className="font-mono text-accent">{"{payment}"}</span>.
        </p>
      </Panel>

      <Panel
        title="رقم الطلب"
        description="الرقم اللي العميل بيبعته على واتساب والموظف بيدوّر بيه في صفحة الفواتير"
        icon={<Receipt className="h-4 w-4" />}
      >
        <Field
          label="بادئة رقم الطلب"
          hint={
            <>
              حروف إنجليزية أو أرقام (٤ خانات كحد أقصى). فاضية = بتتحسب من اسم المحل الإنجليزي.
              الشكل النهائي: <span dir="ltr" className="font-mono text-accent">{`${orderPrefixPreview}-7K4P2`}</span>
            </>
          }
        >
          <TextInput
            value={commerce.orderPrefix}
            onChange={(event) => patchCommerce({ orderPrefix: event.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4) })}
            placeholder="BF"
            dir="ltr"
            className="text-start font-mono uppercase"
          />
        </Field>
        <p className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
          العميل بعد ما يأكد الطلب بيتفتحله واتساب برسالة فيها <b>رقم الطلب بس</b> — من غير المنتجات
          أو الأسعار. التفاصيل الكاملة والفاتورة بتتعمل من
          <a href="/invoices" target="_blank" rel="noopener" className="mx-1 font-bold text-accent hover:underline">صفحة الفواتير</a>
          أو من تبويب الطلبات هنا.
        </p>
      </Panel>

      <Panel title="قالب رسالة واتساب (الأرشيف)" description="القالب ده مابقاش بيتبعت للعميل — رسالة العميل بقت رقم الطلب فقط. سايبينه لو حبيت ترجّعه لاحقاً" icon={<Bell className="h-4 w-4" />}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {TEMPLATE_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => patchCommerce({ orderTemplate: `${commerce.orderTemplate}${token}` })}
              className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-accent transition hover:border-accent/50"
            >
              {token}
            </button>
          ))}
        </div>
        <TextArea
          value={commerce.orderTemplate}
          onChange={(event) => patchCommerce({ orderTemplate: event.target.value })}
          className="min-h-[220px] font-mono text-[12px] leading-relaxed"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSample((s) => !s)}>
              {sample ? "إخفاء المعاينة" : "معاينة الرسالة"}
            </Button>
            <Button
              size="sm"
              variant="soft"
              onClick={() => {
                navigator.clipboard?.writeText(preview).then(
                  () => show("الرسالة التجريبية اتنسخت"),
                  () => show("المتصفح منع النسخ", "error"),
                );
              }}
            >
              <Save className="h-3.5 w-3.5" /> نسخ المعاينة
            </Button>
          </div>
          <a
            href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("✅ تم ربط رقم الواتساب بنجاح")}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 hover:underline"
          >
            <Phone className="h-3 w-3" /> تجربة إرسال على {contact.whatsapp || "—"}
          </a>
        </div>
        {sample ? (
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3.5 text-[12px] leading-relaxed text-ink">
            {preview}
          </pre>
        ) : null}
      </Panel>

      {toast ? <Toast message={toast.text} tone={toast.tone} /> : null}
    </div>
  );
}
