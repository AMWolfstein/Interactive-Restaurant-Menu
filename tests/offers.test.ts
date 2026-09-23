import { describe, expect, it } from "vitest";

import { isDiscountActive, isItemOnOffer, offerPercent } from "../lib/offers";
import type { MenuItem } from "../lib/types";

describe("isDiscountActive", () => {
  it("مفيش عرض من غير سعر قديم", () => {
    expect(isDiscountActive(100)).toBe(false);
    expect(isDiscountActive(100, null)).toBe(false);
  });

  it("مفيش عرض لو السعر القديم أقل أو يساوي الجديد", () => {
    expect(isDiscountActive(100, 100)).toBe(false);
    expect(isDiscountActive(100, 80)).toBe(false);
  });

  it("عرض مستمر من غير تاريخ انتهاء", () => {
    expect(isDiscountActive(80, 100)).toBe(true);
    expect(isDiscountActive(80, 100, {})).toBe(true);
  });

  it("العرض شغّال قبل تاريخ الانتهاء", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    expect(isDiscountActive(80, 100, { day: 30, month: 9, year: 2026 }, now)).toBe(true);
  });

  it("العرض منتهي بعد تاريخ الانتهاء", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(isDiscountActive(80, 100, { day: 30, month: 9, year: 2026 }, now)).toBe(false);
  });

  it("العرض بيفضل شغّال لآخر لحظة في يوم الانتهاء بتوقيت المحل", () => {
    // ٢٣:٠٠ بتوقيت القاهرة في يوم الانتهاء = لسه شغّال.
    // الحساب القديم بتوقيت الجهاز كان بيدّي نتيجة مختلفة على سيرفر UTC.
    const lateCairo = new Date("2026-09-30T20:00:00Z"); // 23:00 القاهرة
    expect(isDiscountActive(80, 100, { day: 30, month: 9, year: 2026 }, lateCairo)).toBe(true);
  });

  it("العرض بيقف بعد نص الليل بتوقيت المحل", () => {
    // 00:30 القاهرة في اليوم اللي بعده
    const afterMidnight = new Date("2026-09-30T21:30:00Z");
    expect(isDiscountActive(80, 100, { day: 30, month: 9, year: 2026 }, afterMidnight)).toBe(false);
  });
});

describe("isItemOnOffer", () => {
  const item = (overrides: Partial<MenuItem> = {}) =>
    ({ id: "i1", name: "صنف", price: 80, available: true, ...overrides }) as MenuItem;

  it("بيشوف عرض المنتج نفسه", () => {
    expect(isItemOnOffer(item({ oldPrice: 100 }))).toBe(true);
  });

  it("بيشوف عرض في أي variant", () => {
    const withVariant = item({
      variants: [{ id: "v1", name: "كبير", price: 90, oldPrice: 120 }],
    } as Partial<MenuItem>);
    expect(isItemOnOffer(withVariant)).toBe(true);
  });

  it("مفيش عرض لما مفيش أسعار قديمة", () => {
    expect(isItemOnOffer(item())).toBe(false);
  });
});

describe("offerPercent", () => {
  it("بيحسب نسبة الخصم", () => {
    expect(offerPercent(80, 100)).toBe(20);
    expect(offerPercent(50, 200)).toBe(75);
  });

  it("صفر لما مفيش خصم", () => {
    expect(offerPercent(100, 100)).toBe(0);
    expect(offerPercent(100)).toBe(0);
  });
});
