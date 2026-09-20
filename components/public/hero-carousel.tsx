"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { HeroImage } from "@/lib/types";
import { cx } from "@/lib/cx";

const AUTO_ADVANCE_MS = 6_000;

/** طبقة صور متحركة للـ Hero. النصوص والأزرار يظلان خارجها لكي لا يتغيرا أثناء التنقل. */
export function HeroCarousel({ images, fallback, label }: { images?: HeroImage[]; fallback: string; label: string }) {
  const slides = useMemo(() => {
    const valid = (images ?? []).filter((image) => image.image.trim());
    return valid.length ? valid : fallback ? [{ id: "fallback", image: fallback, order: 0 }] : [];
  }, [images, fallback]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const activeIndex = Math.min(index, Math.max(0, slides.length - 1));

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % slides.length), AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  if (!slides.length) return <div className="absolute inset-0 bg-surface-2" aria-hidden />;

  const previous = () => setIndex((activeIndex - 1 + slides.length) % slides.length);
  const next = () => setIndex((activeIndex + 1) % slides.length);

  return (
    <div
      className="group absolute inset-0 overflow-hidden bg-surface-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      aria-roledescription={slides.length > 1 ? "carousel" : undefined}
      aria-label={label}
    >
      <div className="flex h-full w-full transition-transform duration-700 motion-reduce:transition-none" style={{ transform: `translateX(-${activeIndex * 100}%)` }} dir="ltr">
        {slides.map((slide) => (
          <div key={slide.id} className="relative h-full w-full shrink-0" aria-hidden={slide !== slides[activeIndex]}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slide.image} alt="" className="h-full w-full object-cover" draggable={false} />
          </div>
        ))}
      </div>

      {slides.length > 1 ? (
        <>
          <div className="absolute inset-x-0 bottom-2.5 z-10 flex items-center justify-center gap-1.5" dir="ltr">
            {slides.map((slide, slideIndex) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => setIndex(slideIndex)}
                className={cx(
                  "h-1.5 rounded-full bg-white/55 shadow-sm transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
                  slideIndex === activeIndex ? "w-5 bg-white" : "w-1.5 hover:bg-white/85",
                )}
                aria-label={`عرض الصورة ${slideIndex + 1} من ${slides.length}`}
                aria-current={slideIndex === activeIndex ? "true" : undefined}
              />
            ))}
          </div>
          <div className="absolute inset-y-0 start-2 z-10 hidden items-center sm:flex">
            <button type="button" onClick={previous} className="grid h-8 w-8 place-items-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur transition hover:bg-black/55 focus:opacity-100 group-hover:opacity-100" aria-label="الصورة السابقة">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute inset-y-0 end-2 z-10 hidden items-center sm:flex">
            <button type="button" onClick={next} className="grid h-8 w-8 place-items-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur transition hover:bg-black/55 focus:opacity-100 group-hover:opacity-100" aria-label="الصورة التالية">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            className="absolute end-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur transition hover:bg-black/55 focus:opacity-100 group-hover:opacity-100"
            aria-label={paused ? "تشغيل الحركة التلقائية" : "إيقاف الحركة التلقائية"}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        </>
      ) : null}
    </div>
  );
}
