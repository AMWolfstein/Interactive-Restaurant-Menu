"use client";

import { LayoutGrid, List, Moon, Palette, Sun } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { FONT_OPTIONS } from "@/lib/fonts";
import { ColorField, Field, NumberInput, Panel, RangeField, Select, Segmented, TextInput, Toggle } from "@/components/ui";

export function LookPanel() {
  const { data, patchBrand, patchCommerce } = useMenu();
  const { brand, commerce } = data;

  return (
    <div className="space-y-4">
      <Panel title="النمط والألوان" description="اختار ستايل أسود أو أبيض للموقع كله، وعدّل لون الأزرار والأسعار" icon={<Palette className="h-4 w-4" />}>
        <div className="space-y-4">
          <Field label="ستايل الموقع" hint="الاختيار بيتحفظ وبيظهر فوراً لكل الزوار">
            <Segmented
              className="w-full [&>button]:flex-1"
              value={brand.theme}
              onChange={(value) => patchBrand({ theme: value })}
              options={[
                { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> أسود</span> },
                { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> أبيض</span> },
              ]}
            />
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold">
              <div className="rounded-xl border border-white/10 bg-[#08090b] p-3 text-white">
                <span className="mb-2 block h-1.5 w-8 rounded-full bg-accent" />
                خلفية سوداء
              </div>
              <div className="rounded-xl border border-black/10 bg-white p-3 text-[#111318]">
                <span className="mb-2 block h-1.5 w-8 rounded-full bg-accent" />
                خلفية بيضاء
              </div>
            </div>
          </Field>
          <ColorField
            label="لون الأكسنت"
            value={brand.accent}
            onChange={(value) => patchBrand({ accent: value })}
            swatches={["#f59e0b", "#ef4444", "#f43f5e", "#a855f7", "#6366f1", "#3b82f6", "#14b8a6", "#22c55e", "#eab308", "#78716c"]}
          />
          <Field label="خط الموقع" hint="بيتحمّل من Google Fonts ولو النت مقطوع بيرجع لخط الجهاز">
            <Select value={brand.font} onChange={(event) => patchBrand({ font: event.target.value })}>
              {FONT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <RangeField
            label="انحناء الحواف"
            value={brand.radius}
            min={0}
            max={28}
            suffix="px"
            onChange={(value) => patchBrand({ radius: value })}
          />
        </div>
      </Panel>

      <Panel title="عناصر الواجهة" description="تتحكم في شكل عرض المنتجات والعناصر الظاهرة">
        <div className="mb-3">
          <Field label="شكل عرض المنتجات" hint="الشبكة تعرض المنتجات بدون الوصف">
            <Segmented
              className="w-full [&>button]:flex-1"
              value={commerce.productLayout}
              onChange={(value) => patchCommerce({ productLayout: value })}
              options={[
                { value: "list", label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" /> العرض الحالي</span> },
                { value: "grid", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> شبكة</span> },
              ]}
            />
          </Field>
          {commerce.productLayout === "grid" ? (
            <Field label="عدد المنتجات في الصف على الموبايل" hint="اكتب من ١ إلى ٦. عدد المنتجات في الصفحة ثابت: ١٥ منتج، والكمبيوتر يفضل ٣ أعمدة.">
              <NumberInput
                value={commerce.mobileGridColumns}
                min={1}
                step={1}
                suffix="منتج"
                onValueChange={(value) => patchCommerce({ mobileGridColumns: Math.min(6, Math.max(1, Math.floor(value))) })}
              />
            </Field>
          ) : null}
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Toggle
            label="إظهار الأسعار"
            description="اقفله لو عايز السعر يبقى عند الطلب"
            checked={commerce.showPrices}
            onChange={(checked) => patchCommerce({ showPrices: checked })}
          />
          <Toggle
            label="خانة البحث"
            checked={commerce.enableSearch}
            onChange={(checked) => patchCommerce({ enableSearch: checked })}
          />
          <Toggle
            label="قسم الأكثر مبيعاً"
            description="كاروسيفي أفقي للمنتجات الأعلى مبيعاً"
            checked={commerce.enableFeatured}
            onChange={(checked) => patchCommerce({ enableFeatured: checked })}
          />
          <Toggle
            label="احتفال بعد الطلب 🎉"
            description="كونفيتي لما العميل يبعت الطلب"
            checked={commerce.enableConfetti}
            onChange={(checked) => patchCommerce({ enableConfetti: checked })}
          />
          <Toggle
            label="تفعيل السلة والطلب"
            description="اقفله لو عايز الموقع معرض بدون طلبات"
            checked={commerce.enableCart}
            onChange={(checked) => patchCommerce({ enableCart: checked })}
          />
          <Field label="عنوان قسم الأكثر مبيعاً">
            <TextInput
              value={commerce.featuredLabel}
              onChange={(event) => patchCommerce({ featuredLabel: event.target.value })}
              placeholder="الأكثر مبيعاً ⭐"
            />
          </Field>
        </div>
      </Panel>
    </div>
  );
}
