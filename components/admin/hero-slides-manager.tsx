"use client";

import { GripVertical, ImagePlus, MoveDown, MoveUp, Trash2 } from "lucide-react";
import { ImageField } from "@/components/image-field";
import { Button } from "@/components/ui";
import type { HeroImage } from "@/lib/types";

const MAX_HERO_SLIDES = 6;

export function HeroSlidesManager({
  images,
  onChange,
}: {
  images: HeroImage[];
  onChange: (next: HeroImage[]) => void;
}) {
  const reorder = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((image, order) => ({ ...image, order })));
  };

  const update = (id: string, image: string) => onChange(images.map((slide) => (slide.id === id ? { ...slide, image } : slide)));

  const remove = (id: string) => onChange(images.filter((slide) => slide.id !== id).map((slide, order) => ({ ...slide, order })));

  const add = () => {
    if (images.length >= MAX_HERO_SLIDES) return;
    onChange([...images, { id: `hero-${crypto.randomUUID().slice(0, 8)}`, image: "", order: images.length }]);
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black">صور السلايدر</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            أضف من 2 إلى {MAX_HERO_SLIDES} صور ليظهر السلايدر تلقائياً. لو تركتها فارغة هتستخدم صورة الخلفية الواحدة أعلاه.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={images.length >= MAX_HERO_SLIDES}>
          <ImagePlus className="h-3.5 w-3.5" /> إضافة صورة
        </Button>
      </div>

      {images.length ? (
        <div className="mt-3 space-y-3">
          {images.map((slide, index) => (
            <div key={slide.id} className="rounded-xl border border-line bg-surface p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted">
                  <GripVertical className="h-3.5 w-3.5" /> الصورة {index + 1}
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => reorder(index, -1)} disabled={index === 0} title="تحريك لأعلى">
                    <MoveUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => reorder(index, 1)} disabled={index === images.length - 1} title="تحريك لأسفل">
                    <MoveDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => remove(slide.id)} title="حذف الصورة">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <ImageField label="" value={slide.image} onChange={(value) => update(slide.id, value)} aspect="aspect-[16/7]" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
