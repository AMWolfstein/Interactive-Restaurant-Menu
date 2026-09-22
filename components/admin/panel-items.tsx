"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Flame,
  Leaf,
  ListFilter,
  Package,
  Pencil,
  Plus,
  Scale,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { formatPrice, pick } from "@/lib/format";
import type { MenuItem, MenuVariant } from "@/lib/types";
import { ImageField } from "@/components/image-field";
import {
  Badge,
  Button,
  CheckboxPill,
  EmptyState,
  Field,
  IconButton,
  Modal,
  NumberInput,
  Panel,
  Select,
  TextArea,
  TextInput,
  Toast,
  useToast,
} from "@/components/ui";
import { cx } from "@/lib/cx";
import { isItemOnOffer } from "@/lib/offers";

type Draft = Omit<MenuItem, "id">;

/** معرّف بسيط للوزن الجديد داخل الفورم */
function newVariantId() {
  return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** وزن فارغ جديد */
function emptyVariant(): MenuVariant {
  return {
    id: newVariantId(),
    label: "",
    price: 0,
    oldPrice: null,
    offerEndDay: null,
    offerEndMonth: null,
    offerEndYear: null,
  };
}

/**
 * يضمن إن المنتج معاه مصفوفة أوزان (variants) عشان الفورم يشتغل بيها دايماً.
 * - المنتج الجديد بيبدأ بمصفوفة فاضية (variants: []) عشان يظهر زرار الإضافة بس.
 * - المنتجات القديمة (variants غير معرّفة، والسعر/الوزن في الحقول الأساسية) بتتحوّل
 *   لأول وزن أوتوماتيك أول ما تتفتح للتعديل عشان بياناتها ما تضيعش.
 */
function ensureVariants(draft: Draft): MenuVariant[] {
  if (Array.isArray(draft.variants)) return draft.variants.map((variant) => ({ ...variant }));
  // منتج قديم بدون أوزان: نحوّل الحقول الأساسية لأول وزن
  if ((draft.weight?.trim() || draft.price) ?? false) {
    return [
      {
        id: newVariantId(),
        label: draft.weight?.trim() ?? "",
        price: draft.price ?? 0,
        oldPrice: draft.oldPrice ?? null,
        offerEndDay: draft.offerEndDay ?? null,
        offerEndMonth: draft.offerEndMonth ?? null,
        offerEndYear: draft.offerEndYear ?? null,
      },
    ];
  }
  return [];
}

const emptyDraft = (categoryId: string): Draft => ({
  categoryId,
  name: "",
  description: "",
  weight: "",
  supplier: "",
  price: 0,
  oldPrice: null,
  offerEndDay: null,
  offerEndMonth: null,
  offerEndYear: null,
  salesCount: 0,
  image: "",
  available: true,
  isNew: false,
  spicy: 0,
  variants: [],
});

/** يحوّل الحقول القديمة (يوم/شهر/سنة) لقيمة يفهمها date input. */
function offerDateValue(draft: { offerEndDay?: number | null; offerEndMonth?: number | null; offerEndYear?: number | null }) {
  if (!draft.offerEndDay || !draft.offerEndMonth || !draft.offerEndYear) return "";
  return `${draft.offerEndYear}-${String(draft.offerEndMonth).padStart(2, "0")}-${String(draft.offerEndDay).padStart(2, "0")}`;
}

function offerDateParts(value: string) {
  if (!value) return { offerEndDay: null, offerEndMonth: null, offerEndYear: null };
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return { offerEndDay: null, offerEndMonth: null, offerEndYear: null };
  return { offerEndDay: day, offerEndMonth: month, offerEndYear: year };
}

export function ItemsPanel({ intent, nonce }: { intent?: string; nonce: number }) {
  const { data, updateItem, deleteItem, duplicateItem, addItem, setCategoryAvailability } = useMenu();
  const { items, categories, brand, commerce } = data;
  const lang = brand.language;
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [only, setOnly] = useState<"all" | "soldOut" | "offers" | "noImage">("all");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    if (intent === "new") {
      openNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter((item) => (categoryFilter === "all" ? true : item.categoryId === categoryFilter))
      .filter((item) => {
        if (only === "soldOut") return !item.available;
        if (only === "offers") return isItemOnOffer(item);
        if (only === "noImage") return !item.image?.trim();
        return true;
      })
      .filter((item) =>
        term
          ? [item.name, item.description]
              .filter(Boolean)
              .some((text) => String(text).toLowerCase().includes(term))
          : true,
      )
;
  }, [items, categoryFilter, only, query]);

  const groups = useMemo(() => {
    return categories
      .map((category) => ({ category, rows: visible.filter((item) => item.categoryId === category.id) }))
      .filter((group) => group.rows.length > 0);
  }, [categories, visible]);

  function openNew() {
    const categoryId = categoryFilter === "all" ? categories[0]?.id ?? "" : categoryFilter;
    setEditing({ id: null, draft: emptyDraft(categoryId) });
  }

  const save = () => {
    if (!editing) return;
    const rawVariants = ensureVariants(editing.draft);
    // تنظيف الأوزان: تشذيب النص وتصفير السعر القديم الغلط
    const variants: MenuVariant[] = rawVariants.map((variant) => ({
      ...variant,
      label: variant.label.trim(),
      oldPrice: variant.oldPrice && variant.oldPrice > 0 ? variant.oldPrice : null,
    }));

    const draft: Draft = {
      ...editing.draft,
      name: editing.draft.name.trim(),
      description: editing.draft.description?.trim() ?? "",
      supplier: editing.draft.supplier?.trim() ?? "",
      variants,
    };
    if (!draft.name) {
      show("اسم المنتج مطلوب", "error");
      return;
    }
    if (!draft.categoryId || !categories.some((category) => category.id === draft.categoryId)) {
      show("أضف قسماً أولاً ثم اختاره للمنتج", "error");
      return;
    }
    if (!variants.length) {
      show("أضف وزناً واحداً على الأقل بسعره", "error");
      return;
    }
    // تحقق من كل وزن: العرض لازم يكون تاريخ كامل وصحيح لو مكتوب
    for (const variant of variants) {
      const offerParts = [variant.offerEndDay, variant.offerEndMonth, variant.offerEndYear];
      if (offerParts.some(Boolean) && !offerParts.every(Boolean)) {
        show("اكتب يوم وشهر وسنة انتهاء العرض بالكامل", "error");
        return;
      }
      if (variant.offerEndDay && variant.offerEndMonth && variant.offerEndYear) {
        const date = new Date(variant.offerEndYear, variant.offerEndMonth - 1, variant.offerEndDay);
        if (date.getDate() !== variant.offerEndDay || date.getMonth() !== variant.offerEndMonth - 1) {
          show("تاريخ انتهاء العرض غير صحيح", "error");
          return;
        }
      }
    }

    // أول وزن بيتزامن مع الحقول الأساسية عشان الشبكة والفواتير والبوستر يفضلوا شغالين
    const first = variants[0];
    draft.weight = first.label;
    draft.price = first.price;
    draft.oldPrice = first.oldPrice ?? null;
    draft.offerEndDay = first.offerEndDay ?? null;
    draft.offerEndMonth = first.offerEndMonth ?? null;
    draft.offerEndYear = first.offerEndYear ?? null;

    if (editing.id) {
      updateItem(editing.id, draft);
      show("تم تحديث المنتج ✅");
    } else {
      addItem(draft);
      show("تمت إضافة المنتج ✅");
    }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="منتجات المتجر"
        description={`${items.length} منتج داخل ${categories.length} قسم — كل التعديلات بتتحفظ أوتوماتيك`}
        icon={<Package className="h-4 w-4" />}
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" /> منتج جديد
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-52 flex-1 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="دوّر بالاسم أو الوصف…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted/70"
            />
          </div>
          <Select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="w-auto py-2 text-xs"
          >
            <option value="all">كل الأقسام</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {pick(lang, category.name, category.nameEn)}
              </option>
            ))}
          </Select>
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
            <ListFilter className="h-3.5 w-3.5" /> فلترة:
          </span>
          {(
            [
              { key: "all", label: "الكل" },
              { key: "soldOut", label: "خلصت" },
              { key: "offers", label: "عروض" },
              { key: "noImage", label: "بدون صورة" },
            ] as const
          ).map((option) => (
            <CheckboxPill key={option.key} active={only === option.key} onClick={() => setOnly(option.key)}>
              {option.label}
            </CheckboxPill>
          ))}
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="مفيش منتجات مطابقة"
            description="غيّر الفلتر أو اعمل منتج جديد"
            action={
              <Button size="sm" onClick={openNew}>
                <Plus className="h-3.5 w-3.5" /> منتج جديد
              </Button>
            }
          />
        ) : (
          <div className="space-y-5">
            {groups.map(({ category, rows }) => (
              <section key={category.id}>
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black">
                    {category.emoji} {pick(lang, category.name, category.nameEn)}
                  </h3>
                  <Badge>{rows.length}</Badge>
                  <button
                    onClick={() => {
                      const allSoldOut = rows.every((item) => !item.available);
                      setCategoryAvailability(category.id, allSoldOut);
                      show(allSoldOut ? `رجّعنا كل منتجات «${category.name}» متاح` : `قفلنا منتجات «${category.name}»`);
                    }}
                    className="rounded-lg border border-line px-2 py-0.5 text-[10px] font-bold text-muted transition hover:border-accent/50 hover:text-accent"
                  >
                    تبديل حالة القسم كله
                  </button>
                </header>
                <ul className="space-y-2">
                  {rows.map((item) => (
                    <li
                      key={item.id}
                      className={cx(
                        "flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 p-2",
                        !item.available && "opacity-70",
                      )}
                    >
                      {item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface text-xs">📦</span>
                      )}

                      <div className="min-w-36 flex-1">
                        <p className="truncate text-[13px] font-bold">{pick(lang, item.name, item.nameEn)}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          <span
                            className={cx(
                              "cursor-pointer rounded-md px-1.5 py-0.5 font-bold",
                              item.available ? "bg-emerald-500/12 text-emerald-400" : "bg-red-500/12 text-red-400",
                            )}
                            onClick={() => updateItem(item.id, { available: !item.available })}
                          >
                            {item.available ? "متاح" : "خلصت"}
                          </span>
                          {item.isNew ? <span className="text-emerald-400">جديد</span> : null}
                          {item.spicy === 1 ? <Flame className="h-3 w-3 text-red-500" /> : item.spicy === 2 ? <Leaf className="h-3 w-3 text-emerald-400" /> : null}
                          {item.oldPrice && item.oldPrice > item.price ? (
                            <span className="text-red-400">خصم {Math.round(((item.oldPrice - item.price) / item.oldPrice) * 100)}%</span>
                          ) : null}
                        </p>
                      </div>

                      <NumberInput
                        value={item.price}
                        onValueChange={(value) => updateItem(item.id, { price: value })}
                        className="w-28"
                        suffix={commerce.currency}
                      />

                      <div className="flex items-center gap-1">
                        <IconButton label="تعديل" onClick={() => setEditing({ id: item.id, draft: { ...item } })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label="تكرار"
                          onClick={() => {
                            duplicateItem(item.id);
                            show("اتعملت نسخة من المنتج");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </IconButton>
                        {confirmId === item.id ? (
                          <button
                            onClick={() => {
                              deleteItem(item.id);
                              setConfirmId(null);
                              show("اتحذف المنتج");
                            }}
                            className="rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-black text-red-400"
                          >
                            تأكيد
                          </button>
                        ) : (
                          <IconButton
                            label="حذف"
                            className="hover:border-red-500/50 hover:text-red-400"
                            onClick={() => {
                              setConfirmId(item.id);
                              window.setTimeout(
                                () => setConfirmId((current) => (current === item.id ? null : current)),
                                4000,
                              );
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <ItemEditor
        editing={editing}
        onChange={(draft) => setEditing((current) => (current ? { ...current, draft } : current))}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      {toast ? <Toast message={toast.text} tone={toast.tone} /> : null}
    </div>
  );
}

function ItemEditor({
  editing,
  onChange,
  onClose,
  onSave,
}: {
  editing: { id: string | null; draft: Draft } | null;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { data } = useMenu();
  const { categories, suppliers, brand, commerce } = data;
  if (!editing) return null;
  const draft = editing.draft;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const variants = ensureVariants(draft);
  const setVariants = (next: MenuVariant[]) => onChange({ ...draft, variants: next });
  const updateVariant = (id: string, patch: Partial<MenuVariant>) =>
    setVariants(variants.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));
  const addVariant = () => setVariants([...variants, emptyVariant()]);
  const removeVariant = (id: string) => {
    const next = variants.filter((variant) => variant.id !== id);
    setVariants(next.length ? next : [emptyVariant()]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing.id ? "تعديل المنتج" : "منتج جديد"}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">
            {draft.price > 0 ? formatPrice(draft.price, brand.language, commerce) : "حدد السعر"}
            {draft.oldPrice && draft.oldPrice > draft.price ? " — فيه خصم 🔥" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button onClick={onSave}>حفظ</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المنتج">
            <TextInput value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="أرز مصري فاخر" />
          </Field>
          <Field label="وصف المنتج">
            <TextArea value={draft.description ?? ""} onChange={(event) => set({ description: event.target.value })} rows={2} />
          </Field>
          <Field label="المورد" hint="اختار من قائمة الموردين التي أضفتها في تبويب الموردين">
            <Select value={draft.supplier ?? ""} onChange={(event) => set({ supplier: event.target.value })}>
              <option value="">بدون مورد</option>
              {draft.supplier && !suppliers.some((supplier) => supplier.name === draft.supplier) ? (
                <option value={draft.supplier}>{draft.supplier} (قديم)</option>
              ) : null}
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.name}>
                  {supplier.name}{supplier.visible ? "" : " (مخفي من الموقع)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="القسم">
            <Select value={draft.categoryId} onChange={(event) => set({ categoryId: event.target.value })}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji} {pick(brand.language, category.name, category.nameEn)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <VariantsEditor
          variants={variants}
          currency={commerce.currency}
          onAdd={addVariant}
          onRemove={removeVariant}
          onUpdate={updateVariant}
        />

        <ImageField
          label="صورة المنتج"
          value={draft.image ?? ""}
          onChange={(value) => set({ image: value })}
          hint="صورة حلوة = مبيعات أكتر. ارفع من الموبايل أو حط رابط"
        />

        <div className="flex flex-wrap items-center gap-2">
          <CheckboxPill active={draft.available} onClick={() => set({ available: !draft.available })}>
            متاح للبيع
          </CheckboxPill>
          <CheckboxPill active={draft.isNew} onClick={() => set({ isNew: !draft.isNew })}>
            جديد 🆕
          </CheckboxPill>
          <span className="ms-1 text-[11px] font-bold text-muted">الصفة الغذائية 🥗:</span>
          {([
            { value: 0, label: "عادي" },
            { value: 1, label: "حار" },
            { value: 2, label: "نباتي 🌱" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => set({ spicy: option.value })}
              className={cx(
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition",
                draft.spicy === option.value ? "border-accent bg-accent/15 text-accent" : "border-line bg-surface-2 text-muted",
              )}
            >
              {option.value === 1 ? <Flame className="h-3 w-3 text-red-500" /> : option.value === 2 ? <Leaf className="h-3 w-3 text-emerald-400" /> : <span aria-hidden>🍽️</span>}
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/**
 * محرّر الأوزان: كل وزن له سعره الجديد وسعره قبل الخصم وتاريخ انتهاء العرض.
 * تظهر الحقول بس بعد الضغط على «+ إضافة وزن»، وكل وزن مضاف بيبان كشريحة جنب الزرار
 * عشان تقدر تضيف أكتر من وزن بسعر مختلف لنفس المنتج (مثلاً 1 كجم و 500 جرام).
 */
function VariantsEditor({
  variants,
  currency,
  onAdd,
  onRemove,
  onUpdate,
}: {
  variants: MenuVariant[];
  currency: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<MenuVariant>) => void;
}) {
  // نبدأ بزرار الإضافة بس (variants فاضية)، وأول ما نضيف وزن تظهر حقوله
  const showCards = variants.length > 0;

  // الأوزان اللي المستخدم فعّل عليها العرض يدوياً (غير اللي عندها بيانات عرض محفوظة)
  const [manualOffers, setManualOffers] = useState<Record<string, boolean>>({});
  const hasOfferData = (variant: MenuVariant) =>
    Boolean(variant.oldPrice || variant.offerEndDay || variant.offerEndMonth || variant.offerEndYear);
  const isOfferOn = (variant: MenuVariant) => manualOffers[variant.id] ?? hasOfferData(variant);

  const toggleOffer = (variant: MenuVariant) => {
    const next = !isOfferOn(variant);
    setManualOffers((current) => ({ ...current, [variant.id]: next }));
    // إلغاء العرض = تفضية بيانات الخصم عشان المنتج يرجع بسعره العادي
    if (!next) {
      onUpdate(variant.id, { oldPrice: null, offerEndDay: null, offerEndMonth: null, offerEndYear: null });
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface-2/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Scale className="h-4 w-4 text-accent" />
        <h4 className="text-sm font-black">الأوزان والأسعار</h4>
        <span className="text-[11px] text-muted">أضف وزناً واحداً على الأقل بسعره</span>
      </div>

      {showCards ? (
        <div className="space-y-2.5">
          {variants.map((variant, index) => (
            <div key={variant.id} className="rounded-xl border border-line bg-surface p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-accent">
                  <Scale className="h-3.5 w-3.5" /> وزن {index + 1}
                  {variant.label.trim() ? <span className="text-foreground">— {variant.label.trim()}</span> : null}
                </span>
                <IconButton
                  label="حذف الوزن"
                  className="hover:border-red-500/50 hover:text-red-400"
                  onClick={() => onRemove(variant.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="الوزن / حجم العبوة" hint="مثال: 1 كجم أو 500 جم">
                  <TextInput
                    value={variant.label}
                    onChange={(event) => onUpdate(variant.id, { label: event.target.value })}
                    placeholder="1 كجم"
                  />
                </Field>
                <Field label="السعر">
                  <NumberInput
                    value={variant.price}
                    onValueChange={(value) => onUpdate(variant.id, { price: value })}
                    suffix={currency}
                  />
                </Field>
                <Field label="عرض / خصم" hint="من غير عرض السعر هيفضل زي ما هو">
                  <Button
                    type="button"
                    size="sm"
                    variant={isOfferOn(variant) ? "success" : "outline"}
                    onClick={() => toggleOffer(variant)}
                    className="w-full"
                  >
                    <Tag className="h-3.5 w-3.5" />
                    {isOfferOn(variant) ? "العرض مفعّل — اضغط للإلغاء" : "تفعيل عرض على الوزن ده"}
                  </Button>
                </Field>
                <Field label="السعر قبل الخصم" hint="اكتب السعر القديم والنظام هيحسب نسبة الخصم تلقائياً">
                  <NumberInput
                    value={variant.oldPrice ?? 0}
                    onValueChange={(value) => onUpdate(variant.id, { oldPrice: value || null })}
                    suffix={currency}
                    disabled={!isOfferOn(variant)}
                  />
                </Field>
                <Field label="تاريخ انتهاء العرض" hint="اختياري — اضغط على الخانة واختار اليوم من التقويم">
                  <TextInput
                    type="date"
                    value={offerDateValue(variant)}
                    onChange={(event) => onUpdate(variant.id, offerDateParts(event.target.value))}
                    dir="ltr"
                    className="text-start disabled:opacity-40"
                    disabled={!isOfferOn(variant)}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {showCards
          ? variants
              .filter((variant) => variant.label.trim())
              .map((variant) => (
                <span
                  key={`chip-${variant.id}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-accent/35 bg-accent/10 px-2 py-1 text-[11px] font-bold text-accent"
                >
                  {variant.label.trim()}
                </span>
              ))
          : null}
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> إضافة وزن
        </Button>
      </div>
    </div>
  );
}
