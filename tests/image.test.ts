import { describe, expect, it } from "vitest";

import { dataUrlKb } from "../lib/image";

/**
 * الحساب القديم كان `length / 1024 * 2` — مبالغة بحوالي ٢.٧ مرة، فصور
 * سليمة كانت بتترفض لأنها «أكبر من الحد».
 */
describe("dataUrlKb", () => {
  const dataUrl = (bytes: number) => {
    const raw = "x".repeat(bytes);
    const base64 = Buffer.from(raw).toString("base64");
    return `data:image/webp;base64,${base64}`;
  };

  it("بيحسب الحجم الحقيقي بدقة", () => {
    // ١٠٢٤٠٠ بايت = ١٠٠ ك.ب
    expect(dataUrlKb(dataUrl(102_400))).toBe(100);
  });

  it("بيطابق حجم البايتات الفعلي", () => {
    for (const bytes of [1024, 5000, 50_000, 300_000]) {
      const expected = Math.round(bytes / 1024);
      expect(Math.abs(dataUrlKb(dataUrl(bytes)) - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("بيتعامل مع الحشو (padding) صح", () => {
    // أطوال مختلفة بتنتج padding مختلف
    for (const bytes of [100, 101, 102]) {
      expect(dataUrlKb(dataUrl(bytes))).toBe(0); // أقل من نص كيلوبايت
    }
  });

  it("مش بيبالغ زي الحساب القديم", () => {
    const url = dataUrl(102_400);
    const oldEstimate = Math.round((url.length / 1024) * 2);
    expect(dataUrlKb(url)).toBeLessThan(oldEstimate);
  });
});
