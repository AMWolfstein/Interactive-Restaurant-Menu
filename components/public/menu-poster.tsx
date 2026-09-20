"use client";

import Link from "next/link";
import { ArrowRight, Printer, QrCode } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { formatPrice } from "@/lib/format";
import { isItemOnOffer } from "@/lib/offers";
import { ProductImage } from "@/components/public/product-card";

export function MenuPoster() {
  const { data } = useMenu();
  const { brand, contact, commerce, categories, items } = data;
  const groups = categories
    .filter((category) => category.visible)
    .map((category) => ({ category, items: items.filter((item) => item.categoryId === category.id && item.available) }))
    .filter((group) => group.items.length);

  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-ink print:bg-white print:p-0" dir="rtl">
      <div className="print:hidden mx-auto mb-4 flex max-w-5xl items-center justify-between gap-3">
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

      <article className="mx-auto max-w-5xl rounded-xl2 border border-line bg-surface p-5 shadow-[0_25px_70px_-48px_rgba(0,0,0,.8)] print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-7 print:text-black print:shadow-none">
        <header className="flex items-center justify-between gap-4 border-b border-line pb-4 print:border-black/20">
          <div className="flex min-w-0 items-center gap-3">
            {brand.logo ? <ProductImage src={brand.logo} alt="" className="h-14 w-14 rounded-xl border border-line print:border-black/20" /> : null}
            <div>
              <h1 className="text-2xl font-black">{brand.storeName}</h1>
              {brand.tagline ? <p className="mt-1 text-xs text-muted print:text-black/60">{brand.tagline}</p> : null}
            </div>
          </div>
          <div className="text-end text-[11px] leading-relaxed text-muted print:text-black/60">
            {contact.phone ? <p dir="ltr">{contact.phone}</p> : null}
            {contact.openingHours ? <p>{contact.openingHours}</p> : null}
          </div>
        </header>

        {groups.length ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {groups.map(({ category, items: categoryItems }) => (
              <section key={category.id} className="break-inside-avoid">
                <h2 className="mb-2.5 inline-flex items-center gap-2 border-b-2 border-accent pb-1 text-sm font-black">
                  <span aria-hidden>{category.emoji}</span> {category.name}
                </h2>
                <ul className="space-y-2.5">
                  {categoryItems.map((item) => {
                    const onOffer = isItemOnOffer(item);
                    return (
                      <li key={item.id} className="flex items-start justify-between gap-3 border-b border-dashed border-line pb-2.5 print:border-black/15">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="text-[13px] font-black">{item.name}</h3>
                            {item.isNew ? <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-bold text-emerald-600">جديد</span> : null}
                            {onOffer ? <span className="rounded bg-red-500/12 px-1 py-0.5 text-[9px] font-bold text-red-600">عرض</span> : null}
                          </div>
                          {item.description ? <p className="mt-0.5 text-[10px] leading-relaxed text-muted print:text-black/60">{item.description}</p> : null}
                          {item.weight ? <p className="mt-0.5 text-[10px] font-bold text-muted print:text-black/60">{item.weight}</p> : null}
                          {item.variants?.length ? <p className="mt-1 text-[10px] text-muted print:text-black/60">{item.variants.map((variant) => `${variant.label}: ${formatPrice(variant.price, brand.language, commerce)}`).join(" · ")}</p> : null}
                        </div>
                        {commerce.showPrices ? (
                          <div className="shrink-0 text-end">
                            <p className="text-[13px] font-black text-accent print:text-black">{formatPrice(item.price, brand.language, commerce)}</p>
                            {onOffer && item.oldPrice ? <p className="text-[10px] text-muted line-through print:text-black/55">{formatPrice(item.oldPrice, brand.language, commerce)}</p> : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : <p className="py-16 text-center text-sm font-bold text-muted">لا توجد منتجات متاحة للطباعة حاليًا.</p>}

        <footer className="mt-7 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[10px] text-muted print:border-black/20 print:text-black/60">
          <span>{contact.footerNote}</span>
          {contact.whatsapp ? <span dir="ltr">WhatsApp: +{contact.whatsapp}</span> : null}
        </footer>
      </article>
    </main>
  );
}
