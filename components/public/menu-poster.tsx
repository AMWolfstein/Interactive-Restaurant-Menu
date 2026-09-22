"use client";

import Link from "next/link";
import { ArrowRight, MapPin, Phone, Printer, QrCode, Snowflake } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { formatPrice } from "@/lib/format";
import { isDiscountActive, isVariantOnOffer, offerPercent } from "@/lib/offers";
import { safeAccent } from "@/lib/color";
import { ProductImage } from "@/components/public/product-card";
import type { MenuItem } from "@/lib/types";

/**
 * صفحة المنيو مصممة كفلاير مطبوع: خلفية ثلجية، عنوان كبير، وثلاثة أعمدة
 * صغيرة حتى تظل البيانات قابلة للقراءة وتشبه المنيو المرفق.
 */
function discountFor(item: MenuItem) {
  return isDiscountActive(item.price, item.oldPrice, {
    day: item.offerEndDay,
    month: item.offerEndMonth,
    year: item.offerEndYear,
  });
}

export function MenuPoster() {
  const { data } = useMenu();
  const { brand, contact, commerce, categories, items } = data;
  const accent = safeAccent(brand.accent);
  const groups = categories
    .filter((category) => category.visible)
    .map((category) => ({
      category,
      items: items.filter((item) => item.categoryId === category.id && item.available),
    }))
    .filter((group) => group.items.length);

  const columns = [0, 1, 2].map((column) => groups.filter((_, index) => index % 3 === column));

  return (
    <main
      className="min-h-screen bg-bg px-2 py-4 text-[#10213a] sm:px-5 sm:py-7 print:bg-white print:p-0"
      dir="rtl"
      style={{
        backgroundColor: "#dff5ff",
        backgroundImage:
          "radial-gradient(circle at 8% 12%, rgba(255,255,255,.95) 0 1px, transparent 2px), radial-gradient(circle at 88% 20%, rgba(255,255,255,.8) 0 2px, transparent 3px), radial-gradient(ellipse at 50% 0%, #ffffff 0%, #d9f3ff 42%, #b8e6fb 100%)",
      }}
    >
      <div className="print:hidden mx-auto mb-4 flex max-w-[1120px] items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-900/70 transition hover:text-sky-950">
          <ArrowRight className="h-3.5 w-3.5" /> العودة للكتالوج
        </Link>
        <div className="flex gap-2">
          <a href="/qr" className="inline-flex items-center gap-1.5 rounded-xl border border-sky-900/15 bg-white/60 px-3 py-2 text-xs font-bold text-sky-900 transition hover:bg-white">
            <QrCode className="h-3.5 w-3.5" /> QR للطباعة
          </a>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3 py-2 text-xs font-black text-white transition hover:bg-sky-800">
            <Printer className="h-3.5 w-3.5" /> طباعة / حفظ PDF
          </button>
        </div>
      </div>

      <article className="mx-auto max-w-[1120px] overflow-hidden rounded-[28px] border border-white/80 bg-white/25 shadow-[0_24px_80px_-35px_rgba(0,92,150,.65)] backdrop-blur-[2px] print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <header className="relative overflow-hidden px-5 pb-7 pt-8 text-center sm:px-12 sm:pt-10">
          <Snowflake className="absolute left-8 top-6 h-14 w-14 rotate-12 text-white/75 sm:h-24 sm:w-24" strokeWidth={1} />
          <Snowflake className="absolute right-8 top-10 h-12 w-12 -rotate-12 text-white/70 sm:h-20 sm:w-20" strokeWidth={1} />
          {brand.logo ? (
            <ProductImage src={brand.logo} alt="" className="relative mx-auto mb-2 h-20 w-20 rounded-2xl border-4 border-white/70 bg-white/50 object-cover shadow-lg sm:h-24 sm:w-24" />
          ) : null}
          <h1 className="relative text-5xl font-black tracking-tight text-sky-600 drop-shadow-[0_2px_0_rgba(255,255,255,.8)] sm:text-7xl">
            {brand.storeName}
          </h1>
          {brand.tagline ? <p className="relative mt-2 text-base font-bold text-slate-700 sm:text-xl">{brand.tagline}</p> : null}
          <div className="relative mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11px] font-bold text-slate-700 sm:text-xs">
            {contact.address ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-sky-700" />{contact.address}</span> : null}
            {contact.phone ? <a href={`tel:${contact.phone.replace(/\D/g, "")}`} className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-3.5 w-3.5 text-sky-700" />{contact.phone}</a> : null}
          </div>
        </header>

        {groups.length ? (
          <div className="grid grid-cols-1 gap-x-5 gap-y-7 px-4 pb-8 sm:px-8 md:grid-cols-3 md:gap-x-8 md:gap-y-0">
            {columns.map((column, columnIndex) => (
              <div key={columnIndex} className="space-y-7">
                {column.map(({ category, items: categoryItems }) => (
                  <section key={category.id} className="break-inside-avoid">
                    <div className="mb-3 flex items-center justify-center gap-2 border-b-2 border-sky-700/70 pb-1.5">
                      <h2 className="text-lg font-black text-sky-900 sm:text-xl">
                        {category.emoji ? <span className="ml-1" aria-hidden>{category.emoji}</span> : null}
                        {category.name}
                      </h2>
                    </div>
                    <ul className="space-y-2">
                      {categoryItems.map((item) => {
                        const itemDiscount = discountFor(item);
                        const off = itemDiscount && item.oldPrice ? offerPercent(item.price, item.oldPrice) : 0;
                        const details = [item.description?.trim(), item.weight?.trim()].filter(Boolean).join(" · ");
                        return (
                          <li key={item.id} className="break-inside-avoid text-[12px] leading-snug sm:text-[13px]">
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-extrabold text-slate-900">{item.name}</span>
                              {item.isNew ? <span className="text-[9px] font-black text-emerald-700">جديد</span> : null}
                              <span className="min-w-3 flex-1 border-b border-dotted border-slate-400/70" />
                              {commerce.showPrices ? (
                                <span className="shrink-0 whitespace-nowrap font-black" style={{ color: itemDiscount ? "#dc2626" : accent }}>
                                  {formatPrice(item.price, brand.language, commerce)}
                                  {itemDiscount && off ? <small className="mr-1 text-[9px]">({off}%)</small> : null}
                                </span>
                              ) : null}
                            </div>
                            {details ? <p className="mt-0.5 text-[10px] text-slate-600">{details}</p> : null}
                            {item.variants?.length ? (
                              <div className="mt-1 space-y-0.5 border-r-2 border-sky-600/40 pr-2">
                                {item.variants.map((variant) => {
                                  const onOffer = isVariantOnOffer(variant);
                                  return (
                                    <div key={variant.id} className="flex items-baseline gap-1 text-[10.5px] font-bold text-slate-700">
                                      <span>{variant.label}</span><span className="min-w-2 flex-1 border-b border-dotted border-slate-300" />
                                      {commerce.showPrices ? <span className="shrink-0" style={{ color: onOffer ? "#dc2626" : accent }}>{formatPrice(variant.price, brand.language, commerce)}</span> : null}
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
            ))}
          </div>
        ) : <p className="px-6 py-16 text-center font-bold text-slate-600">لا توجد منتجات متاحة للطباعة حاليًا.</p>}

        <footer className="relative mx-4 mb-5 rounded-3xl border-4 border-white/80 bg-white/30 px-5 py-5 text-center shadow-inner sm:mx-10">
          <Snowflake className="absolute bottom-2 left-4 h-12 w-12 text-white/70" strokeWidth={1} />
          {contact.footerNote ? <p className="text-sm font-black text-slate-800">{contact.footerNote}</p> : null}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs font-bold text-slate-700">
            {contact.phone ? <span dir="ltr">☎ {contact.phone}</span> : null}
            {contact.whatsapp ? <span dir="ltr">WhatsApp: +{contact.whatsapp}</span> : null}
            {contact.openingHours ? <span>{contact.openingHours}</span> : null}
          </div>
        </footer>
      </article>
    </main>
  );
}
