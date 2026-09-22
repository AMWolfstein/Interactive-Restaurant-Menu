"use client";

import { Globe, Sparkles, Store } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { ImageField } from "@/components/image-field";
import { HeroSlidesManager } from "./hero-slides-manager";
import { Button, ColorField, Field, Panel, TextArea, TextInput, Toggle } from "@/components/ui";

export function BrandPanel() {
  const { data, patchBrand, patchContact } = useMenu();
  const { brand, contact } = data;

  return (
    <div className="space-y-4">
      <Panel
        title="هوية المحل"
        description="اللي العميل بيشوفه في الهيدر والفوتر وبعنوان الصفحة"
        icon={<Store className="h-4 w-4" />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المتجر">
            <TextInput
              value={brand.storeName}
              onChange={(event) => patchBrand({ storeName: event.target.value })}
              placeholder="محل البركة"
            />
          </Field>
          <Field label="الشعار النصي">
            <TextInput
              value={brand.tagline}
              onChange={(event) => patchBrand({ tagline: event.target.value })}
              placeholder="أفضل المنتجات بأحسن سعر"
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ImageField
            label="لوجو المحل"
            value={brand.logo}
            onChange={(value) => patchBrand({ logo: value })}
            hint="لو فاضي هيظهر أيقونة متجر بلون الأكسنت"
            aspect="aspect-square"
          />
          <div className="space-y-3">
            <ColorField
              label="لون البراند"
              value={brand.accent}
              onChange={(value) => patchBrand({ accent: value })}
              swatches={["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#eab308", "#14b8a6"]}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="شريط الإعلان العلوي"
        description="إعلان متحرك فوق الهيدر — عروض، خصومات، أو تنبيه"
        icon={<Sparkles className="h-4 w-4" />}
      >
        <Toggle
          label="إظهار شريط الإعلان"
          description="اتركه مقفل لو عايز صفحة نضيفة بدون بانر"
          checked={brand.announcementEnabled}
          onChange={(checked) => patchBrand({ announcementEnabled: checked })}
        />
        <div className="mt-3">
          <Field label="نص الإعلان" hint="النص بيتكرر في شريط متحرك — اكتب جملة قصيرة">
            <TextInput
              value={brand.announcementText}
              onChange={(event) => patchBrand({ announcementText: event.target.value })}
              placeholder="🚚 توصيل مجاني للطلبات فوق ٣٠٠ ج.م"
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="قسم الترحيب (Hero)"
        description="البانر الكبير فوق الكتالوج — تقدر تقفله خالص"
        icon={<Globe className="h-4 w-4" />}
      >
        <Toggle
          label="إظهار قسم الترحيب"
          checked={brand.showHero}
          onChange={(checked) => patchBrand({ showHero: checked })}
        />
        <div className="mt-3 space-y-3">
          <ImageField label="صورة خلفية بديلة" value={brand.heroImage} onChange={(value) => patchBrand({ heroImage: value })} hint="تظهر وحدها لو لم تضف صوراً للسلايدر، وتكون احتياطية لو تعذّر تحميل أي صورة" />
          <HeroSlidesManager
            images={brand.heroImages ?? []}
            onChange={(heroImages) => patchBrand({ heroImages })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="العنوان الرئيسي">
              <TextInput value={brand.heroTitle} onChange={(event) => patchBrand({ heroTitle: event.target.value })} />
            </Field>
            <Field label="الوصف تحت العنوان">
              <TextInput value={brand.heroSubtitle} onChange={(event) => patchBrand({ heroSubtitle: event.target.value })} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="الفوتر والسوشيال" description="آخر الصفحة — ملاحظة أخيرة وروابط التواصل">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="ملاحظة الفوتر" className="sm:col-span-2 lg:col-span-4">
            <TextArea
              value={contact.footerNote}
              onChange={(event) => patchContact({ footerNote: event.target.value })}
            />
          </Field>
          <Field label="رقم واتساب" hint="نفس الرقم المستخدم في استقبال الطلبات، وهيظهر كأيقونة في الفوتر">
            <TextInput
              value={contact.whatsapp}
              onChange={(event) => patchContact({ whatsapp: event.target.value })}
              placeholder="2010xxxxxxxx"
            />
          </Field>
          <Field label="رابط إنستجرام">
            <TextInput
              value={contact.instagram}
              onChange={(event) => patchContact({ instagram: event.target.value })}
              placeholder="https://instagram.com/shop"
            />
          </Field>
          <Field label="رابط فيسبوك">
            <TextInput
              value={contact.facebook}
              onChange={(event) => patchContact({ facebook: event.target.value })}
              placeholder="https://facebook.com/shop"
            />
          </Field>
          <Field label="رابط تيك توك">
            <TextInput
              value={contact.tiktok}
              onChange={(event) => patchContact({ tiktok: event.target.value })}
              placeholder="https://www.tiktok.com/@shop"
            />
          </Field>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[11px] text-muted">
          <Button size="sm" variant="soft" onClick={() => window.open("/", "_blank")}>
            معاينة الموقع في تبويب جديد
          </Button>
          التعديلات بتتحفظ في الباك إند وتظهر فوراً لكل العملاء.
        </p>
      </Panel>
    </div>
  );
}
