"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Flame,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { formatPrice, pick } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
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

type Draft = Omit<MenuItem, "id">;

const emptyDraft = (categoryId: string): Draft => ({
  categoryId,
  name: "",
  nameEn: "",
  description: "",
  descriptionEn: "",
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
});

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
        if (only === "offers") return !!item.oldPrice && item.oldPrice > item.price;
        if (only === "noImage") return !item.image?.trim();
        return true;
      })
      .filter((item) =>
        term
          ? [item.name, item.nameEn, item.description, item.descriptionEn]
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
    const draft = {
      ...editing.draft,
      name: editing.draft.name.trim(),
      description: editing.draft.description?.trim() ?? "",
      oldPrice: editing.draft.oldPrice && editing.draft.oldPrice > 0 ? editing.draft.oldPrice : null,
    };
    if (!draft.name) {
      show("اسم الصنف مطلوب", "error");
      return;
    }
    if (!draft.categoryId || !categories.some((category) => category.id === draft.categoryId)) {
      show("أضف قسماً أولاً ثم اختاره للصنف", "error");
      return;
    }
    const offerParts = [draft.offerEndDay, draft.offerEndMonth, draft.offerEndYear];
    if (offerParts.some(Boolean) && !offerParts.every(Boolean)) {
      show("اكتب يوم وشهر وسنة انتهاء العرض بالكامل", "error");
      return;
    }
    if (draft.offerEndDay && draft.offerEndMonth && draft.offerEndYear) {
      const date = new Date(draft.offerEndYear, draft.offerEndMonth - 1, draft.offerEndDay);
      if (date.getDate() !== draft.offerEndDay || date.getMonth() !== draft.offerEndMonth - 1) {
        show("تاريخ انتهاء العرض غير صحيح", "error");
        return;
      }
    }
    if (editing.id) {
      updateItem(editing.id, draft);
      show("تم تحديث الصنف ✅");
    } else {
      addItem(draft);
      show("تمت إضافة الصنف ✅");
    }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="أصناف القائمة"
        description={`${items.length} صنف داخل ${categories.length} قسم — كل التعديلات بتتحفظ أوتوماتيك`}
        icon={<UtensilsCrossed className="h-4 w-4" />}
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" /> صنف جديد
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
            icon={<UtensilsCrossed className="h-5 w-5" />}
            title="مفيش أصناف مطابقة"
            description="غيّر الفلتر أو اعمل صنف جديد"
            action={
              <Button size="sm" onClick={openNew}>
                <Plus className="h-3.5 w-3.5" /> صنف جديد
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
                      show(allSoldOut ? `رجّعنا كل أصناف «${category.name}» متاح` : `قفلنا أصناف «${category.name}»`);
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
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface text-xs">🍽️</span>
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
                          {item.spicy ? <Flame className="h-3 w-3 text-red-500" /> : null}
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
                            show("اتعملت نسخة من الصنف");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </IconButton>
                        {confirmId === item.id ? (
                          <button
                            onClick={() => {
                              deleteItem(item.id);
                              setConfirmId(null);
                              show("اتحذف الصنف");
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
  const { categories, brand, commerce } = data;
  if (!editing) return null;
  const draft = editing.draft;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing.id ? "تعديل الصنف" : "صنف جديد"}
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
          <Field label="اسم الصنف">
            <TextInput value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="صدور دجاج مجمدة" />
          </Field>
          <Field label="وصف الصنف">
            <TextArea value={draft.description ?? ""} onChange={(event) => set({ description: event.target.value })} rows={2} />
          </Field>
          <Field label="الوزن / حجم العبوة" hint="مثال: 1 كجم أو 500 جم">
            <TextInput value={draft.weight ?? ""} onChange={(event) => set({ weight: event.target.value })} placeholder="1 كجم" />
          </Field>
          <Field label="المورد">
            <TextInput value={draft.supplier ?? ""} onChange={(event) => set({ supplier: event.target.value })} placeholder="اسم المورد" />
          </Field>
          <Field label="السعر الجديد">
            <NumberInput value={draft.price} onValueChange={(value) => set({ price: value })} suffix={commerce.currency} />
          </Field>
          <Field label="السعر قبل الخصم" hint="اكتب السعر القديم والنظام هيحسب نسبة الخصم تلقائياً">
            <NumberInput value={draft.oldPrice ?? 0} onValueChange={(value) => set({ oldPrice: value || null })} suffix={commerce.currency} />
          </Field>
          <Field label="تاريخ انتهاء العرض" hint="اختياري — اليوم / الشهر / السنة">
            <div className="grid grid-cols-3 gap-2" dir="rtl">
              <TextInput
                inputMode="numeric"
                placeholder="اليوم"
                value={draft.offerEndDay ?? ""}
                onChange={(event) => set({ offerEndDay: event.target.value ? Math.min(31, Math.max(1, Number(event.target.value))) : null })}
              />
              <TextInput
                inputMode="numeric"
                placeholder="الشهر"
                value={draft.offerEndMonth ?? ""}
                onChange={(event) => set({ offerEndMonth: event.target.value ? Math.min(12, Math.max(1, Number(event.target.value))) : null })}
              />
              <TextInput
                inputMode="numeric"
                placeholder="السنة"
                value={draft.offerEndYear ?? ""}
                onChange={(event) => set({ offerEndYear: event.target.value ? Math.max(new Date().getFullYear(), Number(event.target.value)) : null })}
              />
            </div>
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

        <ImageField
          label="صورة الصنف"
          value={draft.image ?? ""}
          onChange={(value) => set({ image: value })}
          hint="صورة حلوة = طلبات أكتر. ارفع من الموبايل أو حط رابط"
        />

        <div className="flex flex-wrap items-center gap-2">
          <CheckboxPill active={draft.available} onClick={() => set({ available: !draft.available })}>
            متاح للطلب
          </CheckboxPill>
          <CheckboxPill active={draft.isNew} onClick={() => set({ isNew: !draft.isNew })}>
            جديد 🆕
          </CheckboxPill>
          <span className="ms-1 text-[11px] font-bold text-muted">الطعم:</span>
          {([
            { value: 0, label: "بارد" },
            { value: 1, label: "حار" },
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
              {option.value === 1 ? <Flame className="h-3 w-3" /> : null}
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
