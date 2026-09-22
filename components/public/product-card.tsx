"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Flame, Heart, Leaf, Minus, Plus } from "lucide-react";
import { pick, formatPrice } from "@/lib/format";
import type { CommerceSettings, MenuItem, SiteLanguage } from "@/lib/types";
import { cx } from "@/lib/cx";
import { isDiscountActive, offerPercent } from "@/lib/offers";
import {
  FAVORITES_SERVER_SNAPSHOT,
  getFavoritesSnapshot,
  subscribeFavorites,
  toggleFavorite,
} from "@/lib/favorites-store";

export function ProductImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div
        className={cx(
          "grid shrink-0 place-items-center bg-[linear-gradient(135deg,color-mix(in_oklab,var(--accent)_28%,transparent),var(--surface-2))] text-2xl",
          className,
        )}
        aria-hidden
      >
        📦
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={cx("shrink-0 object-cover", className)}
    />
  );
}

export function ProductCard({
  item,
  lang,
  commerce,
  getQuantity,
  onAdd,
  onRemoveOne,
  onSupplierClick,
  layout = "list",
  disabled,
}: {
  item: MenuItem;
  lang: SiteLanguage;
  commerce: CommerceSettings;
  /** كمية العنصر (أو الاختيار المحدد لو فيه variants) في السلة حالياً */
  getQuantity: (variantId?: string) => number;
  onAdd: (variantId?: string) => void;
  onRemoveOne: (variantId?: string) => void;
  onSupplierClick?: (supplier: string) => void;
  layout?: "list" | "grid";
  disabled?: boolean;
}) {
  const en = lang === "en";
  const favorites = useSyncExternalStore(subscribeFavorites, getFavoritesSnapshot, () => FAVORITES_SERVER_SNAPSHOT);
  const favorite = favorites.includes(item.id);
  const [selectedVariantId, setSelectedVariantId] = useState(item.variants?.[0]?.id);
  const selectedVariant = item.variants?.find((variant) => variant.id === selectedVariantId);
  const quantity = getQuantity(selectedVariantId);
  const displayPrice = selectedVariant?.price ?? item.price;
  const displayOldPrice = selectedVariant?.oldPrice ?? item.oldPrice;
  const price = formatPrice(displayPrice, lang, commerce);
  const discountEnd = selectedVariant
    ? { day: selectedVariant.offerEndDay, month: selectedVariant.offerEndMonth, year: selectedVariant.offerEndYear }
    : { day: item.offerEndDay, month: item.offerEndMonth, year: item.offerEndYear };
  const hasDiscount = isDiscountActive(displayPrice, displayOldPrice, discountEnd);
  const off = hasDiscount ? offerPercent(displayPrice, displayOldPrice) : 0;
  const gridHasDiscount = isDiscountActive(item.price, item.oldPrice, { day: item.offerEndDay, month: item.offerEndMonth, year: item.offerEndYear });
  const gridOff = gridHasDiscount ? offerPercent(item.price, item.oldPrice) : 0;

  if (layout === "grid") {
    return (
      <GridProductCard
        item={item}
        lang={lang}
        commerce={commerce}
        quantity={quantity}
        onAdd={onAdd}
        onRemoveOne={onRemoveOne}
        onSupplierClick={onSupplierClick}
        disabled={disabled}
        favorite={favorite}
        hasDiscount={gridHasDiscount}
        off={gridOff}
      />
    );
  }

  return (
    <article
      className={cx(
        "group relative flex gap-3.5 rounded-card border border-line bg-surface p-3 transition hover:border-accent/45",
        !item.available && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={() => toggleFavorite(item.id)}
        aria-label={favorite ? (en ? "Remove from favorites" : "إزالة من المفضلة") : (en ? "Add to favorites" : "إضافة للمفضلة")}
        className={cx(
          "absolute end-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full border border-line bg-bg/85 backdrop-blur transition",
          favorite ? "text-red-500" : "text-muted hover:text-red-500",
        )}
      >
        <Heart className={cx("h-4 w-4", favorite && "fill-current")} />
      </button>
      <div className="relative">
        <ProductImage src={item.image} alt={pick(lang, item.name, item.nameEn)} className="h-24 w-24 rounded-xl sm:h-28 sm:w-28" />
        {!item.available ? (
          <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/65 text-[11px] font-black tracking-wide text-white">
            {en ? "SOLD OUT" : "خلصت"}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[15px] font-extrabold">{pick(lang, item.name, item.nameEn)}</h3>
            {item.isNew ? (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                {en ? "NEW" : "جديد"}
              </span>
            ) : null}
            {item.spicy === 1 ? (
              <span className="inline-flex items-center gap-0.5 text-red-500" title={en ? "Hot" : "حار"}>
                <Flame className="h-3 w-3 fill-red-500/25" />
              </span>
            ) : item.spicy === 2 ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-400" title={en ? "Vegetarian" : "نباتي"}>
                <Leaf className="h-3 w-3" />
              </span>
            ) : null}
          </div>
          {item.supplier ? (
            <button
              type="button"
              onClick={() => onSupplierClick?.(item.supplier!)}
              className="mt-1 block max-w-full truncate text-start text-[11px] font-bold text-muted underline decoration-dotted underline-offset-2 transition hover:text-accent"
            >
              المورد: {item.supplier}
            </button>
          ) : null}
          {item.variants && item.variants.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.variants.map((variant) => (
                <button key={variant.id} type="button" onClick={() => setSelectedVariantId(variant.id)} className={cx("rounded-md border px-2 py-1 text-[10px] font-bold", selectedVariantId === variant.id ? "border-accent bg-accent/15 text-accent" : "border-line text-muted")}>
                  {variant.label}
                </button>
              ))}
            </div>
          ) : null}
          {pick(lang, item.description, item.descriptionEn) ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
              {pick(lang, item.description, item.descriptionEn)}
            </p>
          ) : null}
          {(selectedVariant?.label ?? item.weight) ? (
            <p className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold text-muted">
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5">⚖️ {selectedVariant?.label ?? item.weight}</span>
            </p>
          ) : null}
          {hasDiscount && discountEnd.day && discountEnd.month && discountEnd.year ? (
            <OfferCountdown day={discountEnd.day} month={discountEnd.month} year={discountEnd.year} />
          ) : null}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            {commerce.showPrices ? (
              <>
                <span className="text-lg font-black text-accent">{price}</span>
                {hasDiscount ? (
                  <span className="text-[11px] text-muted line-through">
{formatPrice(displayOldPrice!, lang, commerce)}
                  </span>
                ) : null}
                {hasDiscount ? (
                  <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-black text-red-400">
                    -{off}%
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-xs font-bold text-muted">{en ? "Ask for price" : "السعر عند الطلب"}</span>
            )}
          </div>

          {commerce.enableCart && item.available && !disabled ? (
            quantity > 0 ? (
              <div className="flex items-center gap-1 rounded-xl border border-accent/40 bg-accent/10 p-1">
                <button
                  type="button"
                  onClick={() => onRemoveOne(selectedVariantId)}
                  aria-label={en ? "Remove one" : "تقليل"}
                  className="grid h-7 w-7 place-items-center rounded-lg text-accent transition hover:bg-accent hover:text-accent-contrast"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-5 text-center text-sm font-black">{quantity}</span>
                <button
                  type="button"
                  onClick={() => onAdd(selectedVariantId)}
                  aria-label={en ? "Add one" : "زيادة"}
                  className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-contrast transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onAdd(selectedVariantId)}
                className="inline-flex items-center gap-1 rounded-xl border border-accent/35 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent transition hover:bg-accent hover:text-accent-contrast"
              >
                <Plus className="h-3.5 w-3.5" /> {en ? "Add" : "إضافة"}
              </button>
            )
          ) : null}
        </div>
      </div>
    </article>
  );
}


function GridProductCard({
  item,
  lang,
  commerce,
  quantity,
  onAdd,
  onRemoveOne,
  onSupplierClick,
  disabled,
  favorite,
  hasDiscount,
  off,
}: {
  item: MenuItem;
  lang: SiteLanguage;
  commerce: CommerceSettings;
  quantity: number;
  onAdd: (variantId?: string) => void;
  onRemoveOne: (variantId?: string) => void;
  onSupplierClick?: (supplier: string) => void;
  disabled?: boolean;
  favorite: boolean;
  hasDiscount: boolean;
  off: number;
}) {
  return (
    <article className={cx("relative flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface", !item.available && "opacity-70")}>
      <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
        <ProductImage src={item.image} alt={item.name} className="h-full w-full" />
        <button
          type="button"
          onClick={() => toggleFavorite(item.id)}
          aria-label={favorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
          className={cx("absolute end-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-white/15 bg-black/65", favorite ? "text-red-500" : "text-white")}
        >
          <Heart className={cx("h-3.5 w-3.5", favorite && "fill-current")} />
        </button>
        {!item.available ? <span className="absolute inset-0 grid place-items-center bg-black/65 text-[10px] font-black text-white">غير متاح</span> : null}
      </div>

      <div className="flex flex-1 flex-col p-2">
        <div className="flex min-h-9 items-start gap-1">
          <h3 className="line-clamp-2 flex-1 text-[11px] font-black leading-4 sm:text-xs">{item.name}</h3>
          {item.spicy === 1 ? (
            <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-red-500/25 text-red-500" aria-label="حار" />
          ) : item.spicy === 2 ? (
            <Leaf className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="نباتي" />
          ) : null}
        </div>

        {item.supplier ? (
          <button
            type="button"
            onClick={() => onSupplierClick?.(item.supplier!)}
            className="mt-1 truncate text-start text-[9px] font-bold text-muted underline decoration-dotted underline-offset-2 transition hover:text-accent sm:text-[10px]"
          >
            {item.supplier}
          </button>
        ) : <span className="mt-1 h-3" />}

        <div className="mt-2 flex flex-wrap items-baseline gap-1">
          {commerce.showPrices ? (
            <>
              <span className="text-xs font-black text-accent sm:text-sm">{formatPrice(item.price, lang, commerce)}</span>
              {hasDiscount ? <span className="text-[9px] text-muted line-through">{formatPrice(item.oldPrice!, lang, commerce)}</span> : null}
              {hasDiscount ? <span className="rounded bg-red-500/15 px-1 text-[8px] font-black text-red-400">-{off}%</span> : null}
            </>
          ) : <span className="text-[10px] font-bold text-muted">السعر عند الطلب</span>}
        </div>

        {hasDiscount && item.offerEndDay && item.offerEndMonth && item.offerEndYear ? (
          <OfferCountdown day={item.offerEndDay} month={item.offerEndMonth} year={item.offerEndYear} compact />
        ) : null}

        <div className="mt-auto pt-2">
          {commerce.enableCart && item.available && !disabled ? (
            quantity > 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-accent/35 bg-accent/10 p-0.5">
                <button type="button" onClick={() => onRemoveOne()} aria-label="تقليل" className="grid h-6 w-6 place-items-center text-accent"><Minus className="h-3 w-3" /></button>
                <span className="text-[11px] font-black">{quantity}</span>
                <button type="button" onClick={() => onAdd()} aria-label="زيادة" className="grid h-6 w-6 place-items-center rounded-md bg-accent text-accent-contrast"><Plus className="h-3 w-3" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => onAdd()} className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent px-1 py-1.5 text-[10px] font-black text-accent-contrast sm:text-xs">
                <Plus className="h-3 w-3" /> إضافة
              </button>
            )
          ) : null}
        </div>
      </div>
    </article>
  );
}

function OfferCountdown({ day, month, year, compact = false }: { day: number; month: number; year: number; compact?: boolean }) {
  const endsAt = new Date(year, month - 1, day, 23, 59, 59).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - Date.now()));

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, endsAt - Date.now()));
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  if (remaining <= 0) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const time = [days ? `${days}ي` : "", `${hours}`.padStart(2, "0"), `${minutes}`.padStart(2, "0"), `${seconds}`.padStart(2, "0")]
    .filter(Boolean)
    .join(":");

  return (
    <p className={cx("mt-1 font-black text-red-400", compact ? "text-[8px]" : "text-[10px]")}>
      ⏳ {compact ? "متبقي" : "ينتهي العرض خلال"}: <span dir="ltr">{time}</span>
    </p>
  );
}
