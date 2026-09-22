"use client";

import Link from "next/link";
import { ArrowRight, Clock, MapPin, Phone, Printer, QrCode } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { formatPrice } from "@/lib/format";
import { isDiscountActive, isVariantOnOffer, offerPercent } from "@/lib/offers";
import { safeAccent } from "@/lib/color";
import { ProductImage } from "@/components/public/product-card";

/** ألوان «الورقة» — ثابتة دايماً زي ورق الطباعة الحقيقي حتى لو الموقع بوضع ليلي. */
const PAPER = {
  ink: "#191c22",
  muted: "#5f6672",
  faint: "#8a919e",
  line: "#dfe3ea",
  leader: "#c7cdd8",
};

/**
 * نسخة أغمق من لون البراند عشان يفضل مقروء على الورق الأبيض
 * (الألوان الفاتحة زي الأصفر باهتة على الأبيض كنص).
 */
function accentInk(accent: string): string {
  const hex = safeAccent(accent).replace("#", "");
  const mix = (channel: number) => Math.round(channel * 0.74 + 17 * 0.26);
  const r = mix(parseInt(hex.slice(0, 2), 16));
  const g = mix(parseInt(hex.slice(2, 4), 16));
  const b = mix(parseInt(hex.slice(4, 6), 16));
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** زخرفة فاصلة: خط — معيّن — خط (لمسة منيو كافيه). */
function Ornament({ diamond, wide = false }: { diamond: string; wide?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden>
      <span className={`h-px ${wide ? "w-24" : "w-14"} bg-[var(--paper-line)]`} />
      <span className="h-1.5 w-1.5 rotate-45 rounded-[1px]" style={{ backgroundColor: diamond }} />
      <span className={`h-px ${wide ? "w-24" : "w-14"} bg-[var(--paper-line)]`} />
    </div>
  );
}

export function MenuPoster() {
  const { data } = useMenu();
  const { brand, contact, commerce, categories, items } = data;
  const accent = accentInk(brand.accent);
  const groups = categories
    .filter((category) => category.visible)
    .map((category) => ({
      category,
      items: items.filter((item) => item.categoryId === category.id && item.available),
    }))
    .filter((group) => group.items.length);

  return (
    <main className="min-h-screen bg-bg px-3 py-6 text-ink print:bg-white print:p-0" dir="rtl">
      {/* شريط الأدوات — على الشاشة فقط */}
      <div className="print:hidden mx-auto mb-5 flex max-w-4xl items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted transition hover:text-accent">
          <ArrowRight className="h-3.5 w-3.5" /> العودة للكتالوج
        </Link>
        <div className="flex gap-2">
          <a href="/qr" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-muted transition hover:border-accent/60 hover:text-accent">
            <QrCode className="h-3.5 w-3.5" /> QR للطباعة
          </a>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-black text-accent-contrast transition hover:brightness-110">
            <Printer className="h-3.5 w-3.5" /> طباعة / حفظ PDF
          </button>
        </div>
      </div>

      {/* الورقة — أبيض دايماً زي نسخة الطباعة */}
      <article
        className="print:shadow-none mx-auto max-w-4xl overflow-hidden rounded-xl2 border border-black/10 bg-white shadow-[0_30px_80px_-40px_rgba(0,0,0,.5)] print:max-w-none print:rounded-none print:border-0"
        style={{ "--paper-line": PAPER.line, color: PAPER.ink } as React.CSSProperties}
      >
        {/* ═══ الهيدر ═══ */}
        <header
          className="break-after-avoid px-6 pb-7 pt-9 text-center sm:px-10 print:px-6 print:pt-2"
          style={{
            background: `color-mix(in oklab, ${accent} 5%, #ffffff)`,
            borderBottom: `1px solid color-mix(in oklab, ${accent} 22%, #ffffff)`,
          }}
        >
          <Ornament diamond={accent} />
          {brand.logo ? (
            <ProductImage
              src={brand.logo}
              alt=""
              className="mx-auto mt-5 h-16 w-16 rounded-full border border-[var(--paper-line)] object-cover print:border-black/20"
            />
          ) : (
            <div className="mt-5" />
          )}
          <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">{brand.storeName}</h1>
          {brand.tagline ? (
            <div className="mt-2.5 flex items-center justify-center gap-3">
              <span className="h-px w-8 bg-[var(--paper-line)]" />
              <p className="text-[13px] font-bold" style={{ color: PAPER.muted }}>{brand.tagline}</p>
              <span className="h-px w-8 bg-[var(--paper-line)]" />
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11.5px] font-bold" style={{ color: PAPER.muted }}>
            {contact.openingHours ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" style={{ color: accent }} /> {contact.openingHours}
              </span>
            ) : null}
            {contact.phone ? (
              <a href={`tel:${contact.phone.replace(/\D/g, "")}`} className="inline-flex items-center gap-1.5 transition hover:opacity-70">
                <Phone className="h-3.5 w-3.5" style={{ color: accent }} /> <span dir="ltr">{contact.phone}</span>
              </a>
            ) : null}
            {contact.address ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" style={{ color: accent }} /> {contact.address}
              </span>
            ) : null}
          </div>
        </header>

        {/* ═══ الأقسام ═══ */}
        {groups.length ? (
          <div className="grid gap-x-10 gap-y-8 px-6 py-8 sm:grid-cols-2 sm:px-10 print:grid-cols-2 print:gap-x-8 print:px-6 print:py-6">
            {groups.map(({ category, items: categoryItems }) => (
              <section key={category.id} className="break-inside-avoid">
                <div className="mb-4 flex items-center gap-3 break-after-avoid">
                  <span className="h-px flex-1 bg-[var(--paper-line)]" />
                  <h2 className="flex items-center gap-1.5 text-[15px] font-black" style={{ color: accent }}>
                    {category.emoji ? <span aria-hidden>{category.emoji}</span> : null}
                    {category.name}
                  </h2>
                  <span className="h-px flex-1 bg-[var(--paper-line)]" />
                </div>

                <ul className="space-y-3.5">
                  {categoryItems.map((item) => {
                    // خصم مستوى المنتج نفسه — منفصل عن خصم الحجم/العبوة
                    const itemDiscount = isDiscountActive(item.price, item.oldPrice, {
                      day: item.offerEndDay,
                      month: item.offerEndMonth,
                      year: item.offerEndYear,
                    });
                    const off = itemDiscount && item.oldPrice ? offerPercent(item.price, item.oldPrice) : 0;
                    const details = [item.description?.trim(), item.weight?.trim()].filter(Boolean).join(" · ");
                    return (
                      <li key={item.id} className="break-inside-avoid">
                        <div className="flex items-baseline gap-2">
                          <h3 className="text-[13.5px] font-extrabold leading-6">{item.name}</h3>
                          {item.isNew ? (
                            <span
                              className="rounded-full border px-1.5 py-px text-[9px] font-black leading-4"
                              style={{ borderColor: "#10b981", color: "#047857" }}
                            >
                              جديد
                            </span>
                          ) : null}
                          {itemDiscount ? (
                            <span
                              className="rounded-full border px-1.5 py-px text-[9px] font-black leading-4"
                              style={{ borderColor: accent, color: accent }}
                            >
                              خصم {off}%
                            </span>
                          ) : null}
                          <span className="mx-1 flex-1 border-b border-dotted" style={{ borderColor: PAPER.leader }} />
                          {commerce.showPrices ? (
                            <span className="flex shrink-0 items-baseline gap-1.5">
                              <span className="text-[14px] font-black" style={itemDiscount ? { color: accent } : undefined}>
                                {formatPrice(item.price, brand.language, commerce)}
                              </span>
                              {itemDiscount && item.oldPrice ? (
                                <span className="text-[10px] line-through" style={{ color: PAPER.faint }}>
                                  {formatPrice(item.oldPrice, brand.language, commerce)}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>

                        {details ? (
                          <p className="mt-0.5 text-[10.5px] leading-relaxed" style={{ color: PAPER.muted }}>{details}</p>
                        ) : null}

                        {item.variants?.length ? (
                          <div className="mt-1.5 space-y-1 border-r-2 pr-2.5" style={{ borderColor: `color-mix(in oklab, ${accent} 35%, #ffffff)` }}>
                            {item.variants.map((variant) => {
                              const variantOnOffer = isVariantOnOffer(variant);
                              return (
                                <div key={variant.id} className="flex items-baseline gap-2 text-[11.5px] font-bold" style={{ color: PAPER.muted }}>
                                  <span>{variant.label}</span>
                                  <span className="mx-1 flex-1 border-b border-dotted" style={{ borderColor: PAPER.leader }} />
                                  {commerce.showPrices ? (
                                    <span className="flex shrink-0 items-baseline gap-1.5">
                                      <span className="font-black" style={variantOnOffer ? { color: accent } : { color: PAPER.ink }}>
                                        {formatPrice(variant.price, brand.language, commerce)}
                                      </span>
                                      {variantOnOffer && variant.oldPrice ? (
                                        <span className="text-[9px] line-through" style={{ color: PAPER.faint }}>
                                          {formatPrice(variant.oldPrice, brand.language, commerce)}
                                        </span>
                                      ) : null}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="px-6 py-16 text-center text-sm font-bold" style={{ color: PAPER.muted }}>
            لا توجد منتجات متاحة للطباعة حاليًا.
          </p>
        )}

        {/* ═══ الفوتر ═══ */}
        <footer
          className="px-6 py-5 text-center sm:px-10 print:px-6 print:py-4"
          style={{
            background: `color-mix(in oklab, ${accent} 5%, #ffffff)`,
            borderTop: `1px solid color-mix(in oklab, ${accent} 22%, #ffffff)`,
          }}
        >
          <Ornament diamond={accent} />
          {contact.footerNote ? (
            <p className="mt-3 text-[11.5px] font-bold" style={{ color: PAPER.muted }}>{contact.footerNote}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10.5px]" style={{ color: PAPER.faint }}>
            {contact.phone ? <span dir="ltr">☎ {contact.phone}</span> : null}
            {contact.whatsapp ? <span dir="ltr">WhatsApp: +{contact.whatsapp}</span> : null}
          </div>
        </footer>
      </article>
    </main>
  );
}
