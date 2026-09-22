"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, Loader2, MapPin, Phone, QrCode, Snowflake } from "lucide-react";
import { getFontEmbedCSS, toBlob, toPng } from "html-to-image";
import { useMenu } from "@/lib/use-menu";
import { formatPrice } from "@/lib/format";
import { isDiscountActive, isVariantOnOffer, offerPercent } from "@/lib/offers";
import { safeAccent } from "@/lib/color";
import { ProductImage } from "@/components/public/product-card";
import type { Category, CommerceSettings, HeroImage, MenuItem } from "@/lib/types";

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

/**
 * بعض البيانات القديمة كانت بتحفظ الوزن في خانة الوصف أيضاً. نقارن النص
 * بعد إزالة الفواصل والمسافات عشان ما يظهرش الوزن مرة في السطر ومرة تحته.
 */
function comparableDetail(value?: string) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/(?:كيلوجرام|كيلوغرام|كيلو)/g, "كجم")
    .replace(/(?:جرام|غرام)/g, "جم")
    .replace(/(?:مليلتر|ملليلتر|مللي|ملي)/g, "مل");
}

function visibleDescription(item: MenuItem) {
  const description = item.description?.trim() ?? "";
  const normalizedDescription = comparableDetail(description);
  if (!normalizedDescription) return "";

  const weights = [item.weight, ...(item.variants?.map((variant) => variant.label) ?? [])]
    .map((weight) => comparableDetail(weight))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (weights.includes(normalizedDescription)) return "";

  // يغطي أيضاً أوصافاً قديمة مثل «الوزن: 500 جم / 1 كجم» لو كل محتواها
  // مجرد تكرار للأوزان الموجودة بالفعل في السطور.
  const textWithoutWeights = weights.reduce(
    (text, weight) => text.replaceAll(weight, ""),
    normalizedDescription,
  );
  const textWithoutWeightLabels = textWithoutWeights.replace(
    /(?:الوزن|الاوزان|وزن|اوزان|الحجم|الاحجام|حجم|احجام|العبوه|العبوات|عبوه|عبوات)/g,
    "",
  );
  return textWithoutWeightLabels ? description : "";
}

/**
 * الوصف في المنيو مخصص للعروض فقط: منتجات قسم العروض، أو منتج اسمه
 * «عرض» حتى لو اتحط داخل قسم تاني (زي عروض الجبن المجمعة).
 */
function itemShowsDescription(item: MenuItem, category: Category) {
  return [category.id, category.name, category.nameEn, item.name, item.nameEn]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => /عرض|عروض|offers?/i.test(value));
}

type PosterGroup = {
  category: Category;
  items: MenuItem[];
  continuation?: boolean;
};

type PosterPage = {
  columns: [PosterGroup[], PosterGroup[]];
};

// كل صفحة PNG بتتصور لوحدها. الحد ده يمنع تكوين Canvas طويل جداً يفشل
// على الموبايل، مع احتساب المنتجات متعددة الأوزان ووصف العروض كسطور إضافية.
const EXPORT_COLUMN_UNITS = 36;
const EXPORT_SECTION_UNITS = 2.5;

function itemExportUnits(item: MenuItem, category: Category) {
  const priceRows = Math.max(1, item.variants?.length ?? 0);
  const description = itemShowsDescription(item, category) ? visibleDescription(item) : "";
  const descriptionRows = description
    ? Math.max(0.75, Math.ceil(description.length / 70) * 0.75)
    : 0;
  return priceRows * 1.15 + descriptionRows + 0.35;
}

/** يقسم الأقسام والمنتجات على صفحات ذات عمودين من غير قطع منتج بين صفحتين. */
function paginateForExport(groups: PosterGroup[]): PosterPage[] {
  if (!groups.length) return [];

  const pages: PosterPage[] = [];
  let page: PosterPage = { columns: [[], []] };
  let columnIndex: 0 | 1 = 0;
  let usedUnits = 0;

  const advanceColumn = () => {
    if (columnIndex === 0) {
      columnIndex = 1;
    } else {
      pages.push(page);
      page = { columns: [[], []] };
      columnIndex = 0;
    }
    usedUnits = 0;
  };

  for (const group of groups) {
    let itemIndex = 0;
    let continuation = false;

    while (itemIndex < group.items.length) {
      const firstItemUnits = itemExportUnits(group.items[itemIndex], group.category);
      if (usedUnits > 0 && usedUnits + EXPORT_SECTION_UNITS + firstItemUnits > EXPORT_COLUMN_UNITS) {
        advanceColumn();
      }

      const chunk: MenuItem[] = [];
      let sectionUnits = EXPORT_SECTION_UNITS;
      while (itemIndex < group.items.length) {
        const nextItem = group.items[itemIndex];
        const nextUnits = itemExportUnits(nextItem, group.category);
        if (chunk.length > 0 && usedUnits + sectionUnits + nextUnits > EXPORT_COLUMN_UNITS) break;
        chunk.push(nextItem);
        sectionUnits += nextUnits;
        itemIndex += 1;
      }

      page.columns[columnIndex].push({
        category: group.category,
        items: chunk,
        continuation,
      });
      usedUnits += sectionUnits;

      if (itemIndex < group.items.length) {
        continuation = true;
        advanceColumn();
      }
    }
  }

  if (page.columns[0].length || page.columns[1].length) pages.push(page);
  return pages;
}

interface MenuItemRowProps {
  item: MenuItem;
  accent: string;
  commerce: CommerceSettings;
  language: "ar" | "en";
  showDescription: boolean;
}

function MenuItemRow({ item, accent, commerce, language, showDescription }: MenuItemRowProps) {
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
  const description = showDescription ? visibleDescription(item) : "";

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
      {description ? (
        <p className="mt-0.5 text-[10.5px] leading-tight text-slate-600">{description}</p>
      ) : null}
    </li>
  );
}

function PosterHeader({
  brand,
  contact,
  compact = false,
}: {
  brand: { storeName: string; tagline?: string; logo?: string; heroImage?: string; heroImages?: HeroImage[] };
  contact: { address?: string; phone?: string };
  compact?: boolean;
}) {
  // صورة الهيدر بتيجي من أول صورة فعّالة في سلايدر الصفحة الرئيسية وبنفس
  // ترتيبه. لو مفيش صور سلايدر بنرجع لصورة الهيرو القديمة (heroImage)،
  // وأخيراً للوجو عشان الهيدر ما يفضلش فاضي.
  const headerImage =
    (brand.heroImages ?? []).find((slide) => slide.image.trim())?.image.trim()
    || brand.heroImage?.trim()
    || brand.logo;

  return (
    <header className={`relative overflow-hidden text-center ${compact ? "px-4 pt-5 pb-3" : "px-5 pt-6 pb-4 sm:px-10 sm:pt-7"}`}>
      <Snowflake className="absolute left-6 top-4 h-10 w-10 rotate-12 text-white/70 sm:h-14 sm:w-14" strokeWidth={1} />
      <Snowflake className="absolute right-6 top-6 h-9 w-9 -rotate-12 text-white/65 sm:h-12 sm:w-12" strokeWidth={1} />
      {headerImage ? (
        <ProductImage
          src={headerImage}
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
  pageNumber,
  pageCount,
}: {
  contact: { footerNote?: string; phone?: string; whatsapp?: string; openingHours?: string };
  pageNumber?: number;
  pageCount?: number;
}) {
  return (
    <footer className="relative mx-3 mb-4 rounded-2xl border-2 border-white/80 bg-white/30 px-4 py-3 text-center shadow-inner sm:mx-6">
      <Snowflake className="absolute bottom-2 left-3 h-8 w-8 text-white/60" strokeWidth={1} />
      {contact.footerNote ? <p className="text-xs font-black text-slate-800">{contact.footerNote}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-700">
        {contact.phone ? <span dir="ltr">☎ {contact.phone}</span> : null}
        {contact.whatsapp ? <span dir="ltr">WhatsApp: +{contact.whatsapp}</span> : null}
        {contact.openingHours ? <span>{contact.openingHours}</span> : null}
        {pageNumber && pageCount && pageCount > 1 ? <span>صفحة {pageNumber} من {pageCount}</span> : null}
      </div>
    </footer>
  );
}

export function MenuPoster() {
  const { data } = useMenu();
  const { brand, contact, commerce, categories, items } = data;
  const accent = safeAccent(brand.accent);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const pngCaptureRefs = useRef<Array<HTMLDivElement | null>>([]);

  const groups: PosterGroup[] = categories
    .filter((category) => category.visible)
    .map((category) => ({
      category,
      items: items.filter((item) => item.categoryId === category.id && item.available),
    }))
    .filter((group) => group.items.length);

  // العرض والطباعة يفضلوا كاملين، أما PNG فيتقسم لصفحات مستقلة خفيفة.
  const twoColumns = [0, 1].map((colIndex) => groups.filter((_, index) => index % 2 === colIndex));
  const exportPages = paginateForExport(groups);
  const exportPageCount = exportPages.length;

  const handleSavePng = async () => {
    if (isExporting || exportPageCount === 0) return;
    setIsExporting(true);
    setExportProgress(1);
    setExportMessage("");
    let savedPages = 0;
    const failedPages: number[] = [];

    /** ننتظر تحميل صور الصفحة (صورة الهيدر/صور المنتجات) قبل التصوير، وبمهلة قصوى
     *  عشان صورة واحدة بطيئة أو مقطوعة ما توقفش التصدير كله. */
    const waitForAssets = async (capture: HTMLDivElement) => {
      const images = Array.from(capture.querySelectorAll("img"));
      const settle = images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete && image.naturalWidth > 0) return resolve();
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
      );
      await Promise.race([
        Promise.all(settle),
        new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
      ]);
    };

    const download = (href: string, pageNumber: number) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = `${filePart(brand.storeName)}-menu-page-${String(pageNumber).padStart(2, "0")}-of-${String(exportPageCount).padStart(2, "0")}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    // لو صورة فشلت (CORS أو رابط قديم) بنحط بيكسل شفاف بدل ما التصدير يقع كله.
    const TRANSPARENT_PIXEL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    const baseOptions = {
      backgroundColor: "#dff5ff",
      imagePlaceholder: TRANSPARENT_PIXEL,
      // onImageErrorHandler يمنع رفض الوعد لو صورة داخل النسخة فشلت.
      onImageErrorHandler: () => undefined,
    } as const;

    // نجهّز CSS الخطوط مرة واحدة بدل ما كل صفحة تعيد تحميلها من Google Fonts.
    // لو فشل (إنترنت/CSP) بنكمل بخطوط النظام بدل ما نوقف التصدير.
    let fontEmbedCSS: string | undefined;
    try {
      await document.fonts?.ready;
      const firstCapture = pngCaptureRefs.current.find(Boolean);
      if (firstCapture) fontEmbedCSS = await getFontEmbedCSS(firstCapture, baseOptions);
    } catch (fontError) {
      console.warn("Font embedding skipped:", fontError);
      fontEmbedCSS = "";
    }

    const fontOptions = fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true };

    /** سلّم محاولات: جودة عالية ← أخف ← أبسط صيغة. أول نجاح بيوقف السلّم. */
    const capturePage = async (capture: HTMLDivElement): Promise<string | null> => {
      const attempts: Array<() => Promise<string | null>> = [
        async () => {
          const blob = await toBlob(capture, { ...baseOptions, ...fontOptions, pixelRatio: 1.5 });
          return blob ? URL.createObjectURL(blob) : null;
        },
        async () => {
          const blob = await toBlob(capture, { ...baseOptions, ...fontOptions, pixelRatio: 1 });
          return blob ? URL.createObjectURL(blob) : null;
        },
        async () => toPng(capture, { ...baseOptions, pixelRatio: 1, skipFonts: true }),
      ];

      for (const attempt of attempts) {
        try {
          const href = await attempt();
          if (href) return href;
        } catch (attemptError) {
          console.error("PNG attempt failed:", attemptError);
        }
      }
      return null;
    };

    try {
      for (let pageIndex = 0; pageIndex < exportPageCount; pageIndex += 1) {
        const pageNumber = pageIndex + 1;
        setExportProgress(pageNumber);
        const capture = pngCaptureRefs.current[pageIndex];
        if (!capture) {
          failedPages.push(pageNumber);
          continue;
        }

        await waitForAssets(capture);
        const href = await capturePage(capture);
        if (!href) {
          failedPages.push(pageNumber);
          continue;
        }

        download(href, pageNumber);
        if (href.startsWith("blob:")) {
          window.setTimeout(() => URL.revokeObjectURL(href), 20_000);
        }
        savedPages += 1;
        // مهلة قصيرة تفصل تنزيلات المتصفح المتتالية من غير تحميل كل الصور في الذاكرة.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
      }

      if (savedPages === exportPageCount) {
        setExportMessage(`تم تحميل المنيو بالكامل في ${exportPageCount} ${exportPageCount === 1 ? "صورة" : "صور"} PNG ✅`);
      } else if (savedPages > 0) {
        setExportMessage(
          `تم تحميل ${savedPages} من ${exportPageCount}. تعذّر تصوير الصفحات: ${failedPages.join("، ")} — جرّب مرة أخرى أو استخدم زر الطباعة.`,
        );
      } else {
        setExportMessage("تعذّر إكمال تحميل المنيو. جرّب تحديث الصفحة أو استخدم طباعة / حفظ PDF من المتصفح.");
      }
    } catch (error) {
      console.error("PNG menu export error:", error);
      const savedHint = savedPages > 0 ? ` تم تحميل ${savedPages} من ${exportPageCount}.` : "";
      setExportMessage(`تعذّر إكمال تحميل المنيو.${savedHint} حاول مرة أخرى.`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
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
      <div className="print:hidden mx-auto mb-4 max-w-[840px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-900/70 transition hover:text-sky-950"
          >
            <ArrowRight className="h-3.5 w-3.5" /> العودة للصفحة الرئيسية
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              href="/qr"
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-900/15 bg-white/60 px-3 py-2 text-xs font-bold text-sky-900 transition hover:bg-white"
            >
              <QrCode className="h-3.5 w-3.5" /> QR للطباعة
            </a>
            <button
              type="button"
              onClick={handleSavePng}
              disabled={isExporting || exportPageCount === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3.5 py-2 text-xs font-black text-white shadow transition hover:bg-sky-800 disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {isExporting
                ? `جاري تحميل الصورة ${exportProgress} من ${exportPageCount}...`
                : exportPageCount > 1
                  ? `تحميل المنيو — ${exportPageCount} صور PNG`
                  : "تحميل المنيو PNG"}
            </button>
          </div>
        </div>
        {exportPageCount > 1 ? (
          <p className="mt-2 text-end text-[11px] font-bold text-sky-900/70">
            ضغطة واحدة تحمّل المنيو بالكامل تلقائياً في {exportPageCount} صور مرقّمة وراء بعض.
            <span className="block font-medium">لو المتصفح طلب السماح بتنزيل ملفات متعددة، اختار «سماح».</span>
          </p>
        ) : null}
        {exportMessage ? (
          <p className="mt-1.5 text-end text-[11px] font-black text-sky-800" role="status">
            {exportMessage}
          </p>
        ) : null}
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
                      showDescription={itemShowsDescription(item, category)}
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
                          showDescription={itemShowsDescription(item, category)}
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

      {/* كل الصفحات موجودة خارج الشاشة، لكن التصوير والتحميل بيتم صفحة وراء صفحة. */}
      <div
        style={{
          position: "fixed",
          left: "-99999px",
          top: "0",
          width: "960px",
          pointerEvents: "none",
          zIndex: -100,
        }}
        aria-hidden="true"
      >
        {exportPages.map((posterPage, pageIndex) => (
          <div
            key={pageIndex}
            ref={(node) => {
              pngCaptureRefs.current[pageIndex] = node;
            }}
            dir="rtl"
            className="p-6 text-[#10213a]"
            style={bgStyle}
          >
            <article className="overflow-hidden rounded-[24px] border-2 border-white/90 bg-white/30 shadow-[0_20px_60px_-25px_rgba(0,92,150,.5)]">
              <PosterHeader brand={brand} contact={contact} />

              <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-6 pb-6">
                {posterPage.columns.map((column, columnIndex) => (
                  <div key={columnIndex} className="space-y-5">
                    {column.map(({ category, items: categoryItems, continuation }, sectionIndex) => (
                      <section key={`${category.id}-${sectionIndex}`} className="rounded-2xl border border-white/70 bg-white/40 p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between border-b-2 border-sky-700/70 pb-1.5">
                          <h2 className="text-base font-black text-sky-900">
                            {category.emoji ? <span className="ml-1.5" aria-hidden>{category.emoji}</span> : null}
                            {category.name}{continuation ? " — تابع" : ""}
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
                              showDescription={itemShowsDescription(item, category)}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                ))}
              </div>

              <PosterFooter contact={contact} pageNumber={pageIndex + 1} pageCount={exportPageCount} />
            </article>
          </div>
        ))}
      </div>
    </main>
  );
}
