"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Flame, Heart, Minus, Plus } from "lucide-react";
import { pick, formatPrice } from "@/lib/format";
import type { CommerceSettings, MenuItem, SiteLanguage } from "@/lib/types";
import { cx } from "@/lib/cx";
import {
  FAVORITES_SERVER_SNAPSHOT,
  getFavoritesSnapshot,
  subscribeFavorites,
  toggleFavorite,
} from "@/lib/favorites-store";

export function DishImage({
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
        🍽️
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

export function DishCard({
  item,
  lang,
  commerce,
  quantity,
  onAdd,
  onRemoveOne,
  disabled,
}: {
  item: MenuItem;
  lang: SiteLanguage;
  commerce: CommerceSettings;
  quantity: number;
  onAdd: () => void;
  onRemoveOne: () => void;
  disabled?: boolean;
}) {
  const en = lang === "en";
  const price = formatPrice(item.price, lang, commerce);
  const hasDiscount = !!item.oldPrice && item.oldPrice > item.price;
  const off = hasDiscount ? Math.round(((item.oldPrice! - item.price) / item.oldPrice!) * 100) : 0;
  const favorites = useSyncExternalStore(subscribeFavorites, getFavoritesSnapshot, () => FAVORITES_SERVER_SNAPSHOT);
  const favorite = favorites.includes(item.id);

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
        <DishImage src={item.image} alt={pick(lang, item.name, item.nameEn)} className="h-24 w-24 rounded-xl sm:h-28 sm:w-28" />
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
            {item.spicy > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-red-500" title={en ? "Spicy" : "حار"}>
                {Array.from({ length: item.spicy }).map((_, index) => (
                  <Flame key={index} className="h-3 w-3 fill-red-500/25" />
                ))}
              </span>
            ) : null}
          </div>
          {pick(lang, item.description, item.descriptionEn) ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
              {pick(lang, item.description, item.descriptionEn)}
            </p>
          ) : null}
          {item.weight || item.supplier ? (
            <p className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold text-muted">
              {item.weight ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5">⚖️ {item.weight}</span> : null}
              {item.supplier ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5">المورد: {item.supplier}</span> : null}
            </p>
          ) : null}
          {hasDiscount && item.offerEndDay && item.offerEndMonth && item.offerEndYear ? (
            <OfferCountdown day={item.offerEndDay} month={item.offerEndMonth} year={item.offerEndYear} />
          ) : null}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            {commerce.showPrices ? (
              <>
                <span className="text-lg font-black text-accent">{price}</span>
                {hasDiscount ? (
                  <span className="text-[11px] text-muted line-through">
                    {formatPrice(item.oldPrice!, lang, commerce)}
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
                  onClick={onRemoveOne}
                  aria-label={en ? "Remove one" : "تقليل"}
                  className="grid h-7 w-7 place-items-center rounded-lg text-accent transition hover:bg-accent hover:text-accent-contrast"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-5 text-center text-sm font-black">{quantity}</span>
                <button
                  type="button"
                  onClick={onAdd}
                  aria-label={en ? "Add one" : "زيادة"}
                  className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-contrast transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAdd}
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

function OfferCountdown({ day, month, year }: { day: number; month: number; year: number }) {
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

  return <p className="mt-1 text-[10px] font-black text-red-400">⏳ ينتهي العرض خلال: <span dir="ltr">{time}</span></p>;
}
