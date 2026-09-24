import { describe, expect, it } from "vitest";

import { computeTotals, toWhatsappNumber } from "../lib/format";
import type { CartLine, DeliveryZone, MenuItem } from "../lib/types";
import { commerce } from "./helpers";

/**
 * حساب الفاتورة. نفس المنطق مكرر في place_order (SQL) — أي فرق بينهم معناه
 * إن العميل بيشوف رقم في السلة وبيتحاسب على رقم تاني في الفاتورة.
 */

const item = (price: number, id = "i1"): MenuItem =>
  ({ id, name: `صنف ${id}`, price, available: true }) as MenuItem;

const line = (itemId: string, quantity: number): CartLine => ({ itemId, quantity }) as CartLine;

const cart = (...entries: [number, number][]) =>
  entries.map(([price, quantity], index) => ({
    line: line(`i${index}`, quantity),
    item: item(price, `i${index}`),
  }));

describe("computeTotals — الأساسيات", () => {
  it("بيجمع الأصناف صح", () => {
    const totals = computeTotals(cart([50, 2], [30, 1]), commerce(), "pickup");
    expect(totals.subtotal).toBe(130);
    expect(totals.itemCount).toBe(3);
    expect(totals.total).toBe(130);
  });

  it("مفيش رسوم توصيل على الاستلام من المحل", () => {
    const totals = computeTotals(cart([100, 1]), commerce({ deliveryFee: 40 }), "pickup");
    expect(totals.delivery).toBe(0);
  });

  it("بيضيف رسوم التوصيل", () => {
    const totals = computeTotals(cart([100, 1]), commerce({ deliveryFee: 40 }), "delivery");
    expect(totals.delivery).toBe(40);
    expect(totals.total).toBe(140);
  });
});

describe("computeTotals — التوصيل المجاني", () => {
  it("بيلغي الرسوم فوق الحد", () => {
    const settings = commerce({ deliveryFee: 40, freeDeliveryOver: 200 });
    expect(computeTotals(cart([250, 1]), settings, "delivery").delivery).toBe(0);
  });

  it("الحد بالظبط بيأهّل للمجاني", () => {
    const settings = commerce({ deliveryFee: 40, freeDeliveryOver: 200 });
    expect(computeTotals(cart([200, 1]), settings, "delivery").delivery).toBe(0);
  });

  it("بيحسب الباقي على التوصيل المجاني", () => {
    const settings = commerce({ deliveryFee: 40, freeDeliveryOver: 200 });
    expect(computeTotals(cart([150, 1]), settings, "delivery").freeDeliveryGap).toBe(50);
  });

  it("صفر = الخاصية مقفولة", () => {
    const settings = commerce({ deliveryFee: 40, freeDeliveryOver: 0 });
    const totals = computeTotals(cart([9999, 1]), settings, "delivery");
    expect(totals.delivery).toBe(40);
    expect(totals.freeDeliveryGap).toBe(0);
  });
});

describe("computeTotals — مناطق التوصيل", () => {
  it("رسوم المنطقة بتغلب الرسوم العامة", () => {
    const zone: DeliveryZone = { id: "z1", name: "المعادي", fee: 65, minimumOrder: 0 };
    const totals = computeTotals(cart([100, 1]), commerce({ deliveryFee: 40 }), "delivery", zone);
    expect(totals.delivery).toBe(65);
  });
});

describe("computeTotals — رسوم الخدمة والخصم", () => {
  it("رسوم الخدمة بتتحسب بعد الخصم", () => {
    // (٢٠٠ − ٥٠ خصم + ٠ توصيل) × ١٠٪ = ١٥
    const totals = computeTotals(cart([200, 1]), commerce({ serviceChargePercent: 10 }), "pickup", null, 50);
    expect(totals.discount).toBe(50);
    expect(totals.service).toBe(15);
    expect(totals.total).toBe(165);
  });

  it("الخصم مش بيعدّي قيمة الأصناف", () => {
    const totals = computeTotals(cart([100, 1]), commerce(), "pickup", null, 500);
    expect(totals.discount).toBe(100);
    expect(totals.total).toBe(0);
  });

  it("الخصم السالب بيتجاهل", () => {
    const totals = computeTotals(cart([100, 1]), commerce(), "pickup", null, -50);
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(100);
  });

  it("الإجمالي عمره ما يبقى سالب", () => {
    const totals = computeTotals(cart([10, 1]), commerce(), "pickup", null, 9999);
    expect(totals.total).toBeGreaterThanOrEqual(0);
  });
});

describe("toWhatsappNumber", () => {
  it("بيحوّل الرقم المصري المحلي لصيغة دولية", () => {
    expect(toWhatsappNumber("01012345678")).toBe("201012345678");
  });

  it("بيشيل البادئة الدولية 00", () => {
    expect(toWhatsappNumber("00201012345678")).toBe("201012345678");
  });

  it("بيرجّع فاضي للمدخل الفاضي", () => {
    expect(toWhatsappNumber("")).toBe("");
  });
});
