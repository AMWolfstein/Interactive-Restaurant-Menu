"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, Loader2, MapPin, Phone, QrCode, Snowflake } from "lucide-react";
import { toBlob, toPng } from "html-to-image";
import { useMenu } from "@/lib/use-menu";
import { formatPrice } from "@/lib/format";
import { isDiscountActive, isVariantOnOffer, offerPercent } from "@/lib/offers";
import { safeAccent } from "@/lib/color";
import { ProductImage } from "@/components/public/product-card";
import type { CommerceSettings, MenuItem } from "@/lib/types";

function discountFor(item: MenuItem) {
  return isDiscountActive(item.price, item.oldPrice, {
    day: item.offerEndDay,
    month: item.offerEndMonth,
    year: item.offerEndYear,
  });
}

function filePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "menu";
}

interface MenuItemRowProps {
  item: MenuItem;
  accent: string;
  commerce: CommerceSettings;
  language: "ar" | "en";
}

function MenuItemRow({ item, accent, commerce, language }: MenuItemRowProps) {
  const rows = item.variants?.length
    ? item.variants.map((variant) => ({
        id: variant.id,
        weight: variant.label,
        price: variant.price,
        discounted: isVariantOnOffer(variant),
        discountPercent: variant.oldPrice ? offerPercent(variant.price, variant.oldPrice) : 0,
      }))
    : [{
        id: item.id,
        weight: item.weight?.trim() || "",
        price: item.price,
        discounted: discountFor(item),
        discountPercent: item.oldPrice ? offerPercent(item.price, item.oldPrice) : 0,
      }];

  return (
    <li className="break-inside-avoid text-[12px] leading-snug sm:text-[13px]">
      <div className="space-y-1">
        {rows.map((row, index) => {
          const metaParts = [item.supplier?.trim(), row.weight.trim()].filter(Boolean);
          return (
            <div key={row.id} className="flex items-baseline justify-between gap-1.5 sm:gap-2">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-extrabold text-slate-900">{item.name}</span>
                {item.isNew && index === 0 ? <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-black text-emerald-700">جديد</span> : null}
                {item.spicy === 1 ? (
                  <span className="text-[11px] font-black text-red-600">- حار</span>
                ) : item.spicy === 2 ? (
                  <span className="text-[11px] font-black text-emerald-600">- نباتي</span>
                ) : null}
                {metaParts.length > 0 ? (
                  <span className="text-[11px] font-semibold text-slate-600">- {metaParts.join(" - ")}</span>
                ) : null}
              </div>
              <span className="mx-1 min-w-3 flex-1 shrink-0 self-center border-b border-dotted border-slate-400/70" />
              {commerce.showPrices ? (
                <div className="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-end font-black">
                  {row.discounted && row.discountPercent ? (
                    <span className="rounded bg-red-100/90 px-1 text-[9px] font-black text-red-600">خصم {row.discountPercent}%</span>
                  ) : null}
                  <span style={{ color: row.discounted ? "#dc2626" : accent }}>
                    {formatPrice(row.price, language, commerce)}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {item.description?.trim() ? (
        <p className="mt-0.5 text-[10.5px] leading-tight text-slate-600">{item.description.trim()}</p>
      ) : null}
    </li>
  );
}

function PosterHeader({
  brand,
  contact,
  compact = false,
}: {
  brand: { storeName: string; tagline?: string; logo?: string; menuPdfCover?: string };
  contact: { address?: string; phone?: string };
  compact?: boolean;
}) {
  if (brand.menuPdfCover) {
    return (
      <header className="relative overflow-hidden px-4 pt-4 pb-3 text-center sm:px-8">
        <div className="relative mx-auto max-w-full overflow-hidden rounded-2xl border-2 border-white/80 bg-white/40 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.menuPdfCover}
            alt={brand.storeName}
            className="h-28 sm:h-36 w-full object-cover"
          />
        </div>
        <div className="relative mx-auto mt-2 flex max-w-2xl flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] font-bold text-slate-700">
          {contact.address ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-sky-700" />
              {contact.address}
            </span>
          ) : null}
          {contact.phone ? (
            <a href={`tel:${contact.phone.replace(/\D/g, "")}`} className="inline-flex items-center gap-1" dir="ltr">
              <Phone className="h-3.5 w-3.5 text-sky-700" />
              {contact.phone}
            </a>
          ) : null}
        </div>
      </header>
    );
  }

  return (
    <header className={`relative overflow-hidden text-center ${compact ? "px-4 pt-5 pb-3" : "px-5 pt-6 pb-4 sm:px-10 sm:pt-7"}`}>
      <Snowflake className="absolute left-6 top-4 h-10 w-10 rotate-12 text-white/70 sm:h-14 sm:w-14" strokeWidth={1} />
      <Snowflake className="absolute right-6 top-6 h-9 w-9 -rotate-12 text-white/65 sm:h-12 sm:w-12" strokeWidth={1} />
      {brand.logo ? (
        <ProductImage
          src={brand.logo}
          alt=""
          className="relative mx-auto mb-2 h-14 w-14 rounded-2xl border-2 border-white/80 bg-white/50 object-cover shadow-md sm:h-16 sm:w-16"
        />
      ) : null}
      <h1 className="relative text-2xl font-black tracking-tight text-sky-600 drop-shadow-[0_1px_0_rgba(255,255,255,.8)] sm:text-3xl">
        {brand.storeName}
      </h1>
      {brand.tagline ? <p className="relative mt-1 text-xs font-bold text-slate-700 sm:text-sm">{brand.tagline}</p> : null}
      <div className="relative mx-auto mt-2 flex max-w-2xl flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-700">
        {contact.address ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3 text-sky-700" />
            {contact.address}
          </span>
        ) : null}
        {contact.phone ? (
          <a href={`tel:${contact.phone.replace(/\D/g, "")}`} className="inline-flex items-center gap-1" dir="ltr">
            <Phone className="h-3 w-3 text-sky-700" />
            {contact.phone}
          </a>
        ) : null}
      </div>
    </header>
  );
}

function PosterFooter({
  contact,
}: {
  contact: { footerNote?: string; phone?: string; whatsapp?: string; openingHours?: string };
}) {
  return (
    <footer className="relative mx-3 mb-4 rounded-2xl border-2 border-white/80 bg-white/30 px-4 py-3 text-center shadow-inner sm:mx-6">
      <Snowflake className="absolute bottom-2 left-3 h-8 w-8 text-white/60" strokeWidth={1} />
      {contact.footerNote ? <p className="text-xs font-black text-slate-800">{contact.footerNote}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-700">
        {contact.phone ? <span dir="ltr">☎ {contact.phone}</span> : null}
        {contact.whatsapp ? <span dir="ltr">WhatsApp: +{contact.whatsapp}</span> : null}
        {contact.openingHours ? <span>{contact.openingHours}</span> : null}
      </div>
    </footer>
  );
}

export function MenuPoster() {
  const { data } = useMenu();
  const { brand, contact, commerce, categories, items } = data;
  const accent = safeAccent(brand.accent);
  const [isExporting, setIsExporting] = useState(false);
  const pngCaptureRef = useRef<HTMLDivElement>(null);

  const groups = categories
    .filter((category) => category.visible)
    .map((category) => ({
      category,
      items: items.filter((item) => item.categoryId === category.id && item.available),
    }))
    .filter((group) => group.items.length);

  // 2-column distribution for PNG export and Print
  const twoColumns = [0, 1].map((colIndex) => groups.filter((_, index) => index % 2 === colIndex));

  const handleSavePng = async () => {
    const capture = pngCaptureRef.current;
    if (!capture || isExporting) return;
    setIsExporting(true);

    const download = (href: string) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = `${filePart(brand.storeName)}-menu.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    try {
      // انتظر الخطوط والصور قبل التصوير؛ التصوير المبكر كان يفشل خصوصًا على الموبايل.
      await document.fonts?.ready;
      await Promise.all(
        Array.from(capture.querySelectorAll("img")).map((image) =>
          image.complete ? image.decode?.().catch(() => undefined) : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
        ),
      );

      const blob = await toBlob(capture, {
        pixelRatio: 2,
        backgroundColor: "#dff5ff",
      });
      if (!blob) throw new Error("PNG generation returned an empty file");
      const objectUrl = URL.createObjectURL(blob);
      download(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      console.error("PNG export error:", err);
      try {
        // نسخة أخف للأجهزة ذات الذاكرة المحدودة.
        const fallbackUrl = await toPng(capture, {
          pixelRatio: 1,
          backgroundColor: "#dff5ff",
          skipFonts: true,
        });
        download(fallbackUrl);
      } catch (fallbackError) {
        console.error("PNG fallback error:", fallbackError);
        alert("تعذّر حفظ الصورة، يُرجى المحاولة مرة أخرى.");
      }
    } finally {
      setIsExporting(false);
    }
  };

  const bgStyle = {
    backgroundColor: "#dff5ff",
    backgroundImage:
      "radial-gradient(circle at 8% 12%, rgba(255,255,255,.95) 0 1px, transparent 2px), radial-gradient(circle at 88% 20%, rgba(255,255,255,.8) 0 2px, transparent 3px), radial-gradient(ellipse at 50% 0%, #ffffff 0%, #d9f3ff 42%, #b8e6fb 100%)",
  };

  return (
    <main
      className="min-h-screen px-2 py-4 text-[#10213a] sm:px-5 sm:py-7 print:p-0"
      dir="rtl"
      style={bgStyle}
    >
      {/* Top action bar */}
      <div className="print:hidden mx-auto mb-4 flex max-w-[840px] items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-900/70 transition hover:text-sky-950"
        >
          <ArrowRight className="h-3.5 w-3.5" /> العودة للصفحة الرئيسية
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="/qr"
            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-900/15 bg-white/60 px-3 py-2 text-xs font-bold text-sky-900 transition hover:bg-white"
          >
            <QrCode className="h-3.5 w-3.5" /> QR للطباعة
          </a>
          <button
            type="button"
            onClick={handleSavePng}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3.5 py-2 text-xs font-black text-white shadow transition hover:bg-sky-800 disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {isExporting ? "جاري الحفظ..." : "حفظ PNG"}
          </button>
        </div>
      </div>

      {/* Website View: Single-column list of categories and items */}
      <article className="mx-auto max-w-[840px] overflow-hidden rounded-[24px] border border-white/80 bg-white/25 shadow-[0_24px_80px_-35px_rgba(0,92,150,.65)] backdrop-blur-[2px] print:hidden">
        <PosterHeader brand={brand} contact={contact} />

        {groups.length ? (
          <div className="space-y-6 px-4 pb-6 sm:px-8">
            {groups.map(({ category, items: categoryItems }) => (
              <section key={category.id} className="rounded-2xl border border-white/60 bg-white/30 p-4 shadow-sm sm:p-5">
                <div className="mb-3.5 flex items-center justify-between border-b-2 border-sky-700/60 pb-2">
                  <h2 className="text-base font-black text-sky-900 sm:text-lg">
                    {category.emoji ? <span className="ml-1.5" aria-hidden>{category.emoji}</span> : null}
                    {category.name}
                  </h2>
                  <span className="rounded-full bg-sky-700/10 px-2 py-0.5 text-[10px] font-black text-sky-800">
                    {categoryItems.length} {categoryItems.length === 1 ? "صنف" : "أصناف"}
                  </span>
                </div>
                <ul className="space-y-2.5">
                  {categoryItems.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      accent={accent}
                      commerce={commerce}
                      language={brand.language}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="px-6 py-16 text-center font-bold text-slate-600">لا توجد منتجات متاحة للعرض حاليًا.</p>
        )}

        <PosterFooter contact={contact} />
      </article>

      {/* Print View: Retains exact colors and formats into 2 clean columns for paper printing */}
      <article
        className="hidden print:block mx-auto max-w-none overflow-hidden rounded-2xl border border-white/80 bg-white/25 shadow-none"
        style={bgStyle}
      >
        <PosterHeader brand={brand} contact={contact} compact />
        {groups.length ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 pb-4">
            {twoColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="space-y-4">
                {column.map(({ category, items: categoryItems }) => (
                  <section key={category.id} className="break-inside-avoid rounded-xl border border-white/60 bg-white/40 p-3 shadow-xs">
                    <div className="mb-2 flex items-center justify-between border-b-2 border-sky-700/70 pb-1">
                      <h2 className="text-sm font-black text-sky-900">
                        {category.emoji ? <span className="ml-1" aria-hidden>{category.emoji}</span> : null}
                        {category.name}
                      </h2>
                    </div>
                    <ul className="space-y-1.5">
                      {categoryItems.map((item) => (
                        <MenuItemRow
                          key={item.id}
                          item={item}
                          accent={accent}
                          commerce={commerce}
                          language={brand.language}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <PosterFooter contact={contact} />
      </article>

      {/* Off-screen Capture Element for high-resolution 2-column PNG export */}
      <div
        style={{
          position: "fixed",
          left: "-99999px",
          top: "0",
          width: "1160px",
          pointerEvents: "none",
          zIndex: -100,
        }}
        aria-hidden="true"
      >
        <div
          ref={pngCaptureRef}
          dir="rtl"
          className="p-6 text-[#10213a]"
          style={bgStyle}
        >
          <article className="overflow-hidden rounded-[24px] border-2 border-white/90 bg-white/30 shadow-[0_20px_60px_-25px_rgba(0,92,150,.5)]">
            <PosterHeader brand={brand} contact={contact} />

            {groups.length ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-6 pb-6">
                {twoColumns.map((column, columnIndex) => (
                  <div key={columnIndex} className="space-y-5">
                    {column.map(({ category, items: categoryItems }) => (
                      <section key={category.id} className="rounded-2xl border border-white/70 bg-white/40 p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between border-b-2 border-sky-700/70 pb-1.5">
                          <h2 className="text-base font-black text-sky-900">
                            {category.emoji ? <span className="ml-1.5" aria-hidden>{category.emoji}</span> : null}
                            {category.name}
                          </h2>
                          <span className="rounded-full bg-sky-700/10 px-2 py-0.5 text-[10px] font-black text-sky-800">
                            {categoryItems.length} {categoryItems.length === 1 ? "صنف" : "أصناف"}
                          </span>
                        </div>
                        <ul className="space-y-2">
                          {categoryItems.map((item) => (
                            <MenuItemRow
                              key={item.id}
                              item={item}
                              accent={accent}
                              commerce={commerce}
                              language={brand.language}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}

            <PosterFooter contact={contact} />
          </article>
        </div>
      </div>
    </main>
  );
}
