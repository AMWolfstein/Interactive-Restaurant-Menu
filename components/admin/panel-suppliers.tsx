"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Package, Plus, Search, Trash2, Truck } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { Button, EmptyState, Field, IconButton, Panel, TextInput, Toast, useToast } from "@/components/ui";
import { cx } from "@/lib/cx";

/** إدارة الموردين بشكل مستقل عن الأقسام، مع إبقاء المنتجات مربوطة باسم المورد. */
export function SuppliersPanel() {
  const { data, addSupplier, updateSupplier, deleteSupplier } = useMenu();
  const { suppliers, items } = data;
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { toast, show } = useToast();

  const visibleSuppliers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return suppliers.filter((supplier) => !term || supplier.name.toLocaleLowerCase().includes(term));
  }, [query, suppliers]);

  const add = () => {
    const name = newName.trim();
    if (!name) {
      show("اكتب اسم المورد الأول", "error");
      return;
    }
    if (suppliers.some((supplier) => supplier.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      show("المورد ده موجود بالفعل", "error");
      return;
    }
    addSupplier({ name, visible: true });
    setNewName("");
    show("تمت إضافة المورد ✅");
  };

  const rename = (id: string, value: string) => {
    const name = value.trim();
    if (name && suppliers.some((supplier) => supplier.id !== id && supplier.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      show("اسم المورد مستخدم بالفعل", "error");
      return;
    }
    // التعديل الفوري يحفظ الاسم الجديد ويحدّث ربط المنتجات تلقائياً.
    updateSupplier(id, { name: value });
  };

  return (
    <div className="space-y-4">
      <Panel
        title="موردو المتجر"
        description="أضف الموردين هنا مرة واحدة، وبعدها اختار المورد من قائمة المنتج الجديد"
        icon={<Truck className="h-4 w-4" />}
        actions={<span className="rounded-full bg-accent/12 px-2.5 py-1 text-[11px] font-black text-accent">{suppliers.length} مورد</span>}
      >
        <div className="mb-4 grid gap-3 rounded-xl border border-accent/20 bg-accent/5 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="إضافة مورد جديد" hint="الاسم هيظهر كاختيار في نموذج المنتج وكفلتر في الموقع">
            <TextInput
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") add();
              }}
              placeholder="مثال: شركة النيل للتوريدات"
            />
          </Field>
          <Button onClick={add} className="sm:mb-[1.15rem]">
            <Plus className="h-4 w-4" /> إضافة مورد
          </Button>
        </div>

        {suppliers.length > 0 ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="دوّر على مورد…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted/70"
            />
          </div>
        ) : null}

        {visibleSuppliers.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-5 w-5" />}
            title={suppliers.length ? "مفيش مورد مطابق" : "لسه مفيش موردين"}
            description={suppliers.length ? "جرّب كلمة بحث تانية" : "أضف أول مورد عشان تختاره بسهولة عند إضافة المنتجات"}
          />
        ) : (
          <ul className="space-y-2">
            {visibleSuppliers.map((supplier) => {
              const productCount = items.filter((item) => item.supplier?.trim() === supplier.name.trim()).length;
              return (
                <li
                  key={supplier.id}
                  className={cx(
                    "flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/40 p-2.5",
                    !supplier.visible && "opacity-65",
                  )}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                    <Truck className="h-4 w-4" />
                  </span>
                  <div className="min-w-40 flex-1">
                    <TextInput
                      value={supplier.name}
                      onChange={(event) => rename(supplier.id, event.target.value)}
                      className="h-9 py-1.5"
                      aria-label={`اسم المورد ${supplier.name}`}
                    />
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface px-2 py-1.5 text-[11px] font-bold text-muted">
                    <Package className="h-3 w-3" /> {productCount} منتج
                  </span>
                  <IconButton
                    label={supplier.visible ? "إخفاء المورد من الموقع" : "إظهار المورد في الموقع"}
                    onClick={() => updateSupplier(supplier.id, { visible: !supplier.visible })}
                    className={supplier.visible ? "text-accent" : ""}
                  >
                    {supplier.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </IconButton>
                  {confirmId === supplier.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        deleteSupplier(supplier.id);
                        setConfirmId(null);
                        show(`اتحذف «${supplier.name}» واتشال من المنتجات المرتبطة بيه`);
                      }}
                      className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-[11px] font-black text-red-400"
                    >
                      تأكيد الحذف
                    </button>
                  ) : (
                    <IconButton
                      label="حذف المورد"
                      className="hover:border-red-500/50 hover:text-red-400"
                      onClick={() => {
                        setConfirmId(supplier.id);
                        window.setTimeout(() => setConfirmId((current) => (current === supplier.id ? null : current)), 4000);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          إخفاء المورد يمنع ظهوره في واجهة العميل فقط، ولا يمسح المنتجات. الحذف يمسح المورد من القائمة ويفرّغ اختياره من المنتجات المرتبطة به.
        </p>
      </Panel>

      {toast ? <Toast message={toast.text} tone={toast.tone} /> : null}
    </div>
  );
}
