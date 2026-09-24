import { describe, expect, it } from "vitest";

import {
  computeLoyaltyDiscount,
  isUsablePhone,
  loyaltyStatus,
  normalizePhone,
  projectLoyalty,
} from "../lib/loyalty";
import { DEFAULT_DATA } from "../lib/defaults";
import type { LoyaltySettings } from "../lib/types";

/**
 * منطق «كاشك» متكرر في مكانين: الدوال دي، ودالة place_order في SQL.
 * أي تغيير هنا لازم يتعمل هناك — والاختبارات دي بتمسك الانحراف بدري.
 */

const settings = (overrides: Partial<LoyaltySettings> = {}): LoyaltySettings => ({
  ...DEFAULT_DATA.commerce.loyalty,
  enabled: true,
  threshold: 5000,
  percent: 5,
  ...overrides,
});

describe("normalizePhone — مفتاح العميل", () => {
  it("بيوحّد كل صيغ الرقم المصري لنفس المفتاح", () => {
    // لو دي فشلت، العميل الواحد هيتقسّم لكذا حساب وكل واحد بيجمع رصيد لوحده
    const expected = "01012345678";
    expect(normalizePhone("01012345678")).toBe(expected);
    expect(normalizePhone("+201012345678")).toBe(expected);
    expect(normalizePhone("00201012345678")).toBe(expected);
    expect(normalizePhone("201012345678")).toBe(expected);
    expect(normalizePhone("0101 234 5678")).toBe(expected);
    expect(normalizePhone("0101-234-5678")).toBe(expected);
    expect(normalizePhone("1012345678")).toBe(expected);
  });

  it("بيرجّع فاضي للمدخلات الفاضية", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("مش رقم")).toBe("");
  });

  it("بيحدّد الطول بـ20 رقم", () => {
    expect(normalizePhone("1".repeat(40)).length).toBe(20);
  });

  it("isUsablePhone بيرفض الأرقام القصيرة", () => {
    expect(isUsablePhone("0101234")).toBe(false);
    expect(isUsablePhone("01012345678")).toBe(true);
  });
});

describe("loyaltyStatus", () => {
  it("مش مستحق تحت العتبة", () => {
    const status = loyaltyStatus(settings(), 4999);
    expect(status.eligible).toBe(false);
    expect(status.remaining).toBe(1);
  });

  it("مستحق عند العتبة بالظبط", () => {
    const status = loyaltyStatus(settings(), 5000);
    expect(status.eligible).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it("مش مستحق لما النظام مقفول حتى لو الرصيد كفاية", () => {
    expect(loyaltyStatus(settings({ enabled: false }), 9000).eligible).toBe(false);
  });

  it("نسبة التقدّم مش بتعدّي ١٠٠", () => {
    expect(loyaltyStatus(settings(), 99_999).progress).toBe(100);
  });

  it("الرصيد السالب بيتعامل كصفر", () => {
    expect(loyaltyStatus(settings(), -500).balance).toBe(0);
  });
});

describe("projectLoyalty — الرصيد شامل السلة الحالية", () => {
  it("بيحسب الباقي بعد احتساب السلة", () => {
    const projection = projectLoyalty({ threshold: 5000, balance: 0 }, 200);
    expect(projection.balanceAfter).toBe(200);
    expect(projection.remaining).toBe(4800);
  });

  it("بيحدّد إن الطلب الحالي هو اللي بيفتح المكافأة", () => {
    const projection = projectLoyalty({ threshold: 5000, balance: 4900 }, 200);
    expect(projection.unlocksReward).toBe(true);
    expect(projection.remaining).toBe(0);
  });
});

describe("computeLoyaltyDiscount", () => {
  it("مفيش خصم لما النظام مقفول", () => {
    expect(computeLoyaltyDiscount(settings({ enabled: false }), 1000, 9000)).toBeNull();
  });

  it("مفيش خصم تحت العتبة", () => {
    expect(computeLoyaltyDiscount(settings(), 1000, 4999)).toBeNull();
  });

  it("بيحسب الخصم ويرحّل الزيادة فوق العتبة", () => {
    // رصيد ٥٦٠٠ وعتبة ٥٠٠٠ → الخصم ٥٪ على ١٠٠٠ = ٥٠، والمتبقي ٦٠٠ يترحّل
    const snapshot = computeLoyaltyDiscount(settings(), 1000, 5600);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.discount).toBe(50);
    expect(snapshot?.threshold).toBe(5000);
  });

  it("الخصم بيتقرّب لأقرب جنيه", () => {
    // ٥٪ من ٣٣٣ = ١٦.٦٥ → ١٧
    expect(computeLoyaltyDiscount(settings(), 333, 5000)?.discount).toBe(17);
  });
});
