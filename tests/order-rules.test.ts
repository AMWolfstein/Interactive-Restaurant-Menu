import { describe, expect, it } from "vitest";

import { checkOrderRules, isStoreAcceptingOrders, resolveDeliveryZone } from "../lib/order-rules";
import type { DeliveryZone } from "../lib/types";
import { ALWAYS_OPEN, contact, menu, weeklySchedule } from "./helpers";

/**
 * القواعد دي كانت متفروضة في المتصفح بس، فأي POST مباشر على /api/orders كان
 * بيعدّيها. الاختبارات هنا بتقفل الباب ده وبتثبّت السلوك.
 */

const VALID_CUSTOMER = {
  name: "أحمد محمد",
  phone: "01012345678",
  address: "٥ شارع الجمهورية، الدور التالت، شقة ٧",
};

/** طلب سليم على محل مفتوح من غير أي قيود — لازم يعدّي */
describe("checkOrderRules — الحالة السليمة", () => {
  it("بيقبل طلب مستوفي كل الشروط", () => {
    const result = checkOrderRules(menu({ minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 120,
    });
    expect(result).toBeNull();
  });
});

describe("checkOrderRules — السلة مقفولة", () => {
  it("بيرفض بـ409 لما enableCart = false", () => {
    const result = checkOrderRules(menu({ enableCart: false }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 500,
    });
    expect(result?.status).toBe(409);
  });
});

describe("checkOrderRules — المحل مقفول", () => {
  it("بيرفض لما المفتاح اليدوي مقفول (autoSchedule = false)", () => {
    // دي الحالة اللي كانت ضايعة تماماً على السيرفر: التحقق القديم كان بيبص
    // على الجدول الأوتوماتيكي بس، فالقفل اليدوي ما كانش بيمنع أي طلب.
    const result = checkOrderRules(menu({}, { isOpen: false, autoSchedule: false }), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 500,
    });
    expect(result?.status).toBe(409);
    expect(result?.message).toContain("مقفل");
  });

  it("بيقبل لما المفتاح اليدوي مفتوح", () => {
    const result = checkOrderRules(menu({ minimumOrder: 0 }, { isOpen: true, autoSchedule: false }), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 500,
    });
    expect(result).toBeNull();
  });

  it("بيرفض بره مواعيد الجدول الأوتوماتيكي", () => {
    const storeMenu = menu(
      { minimumOrder: 0 },
      { autoSchedule: true, weeklySchedule: weeklySchedule("09:00", "17:00") },
    );
    // ٣ الفجر بتوقيت القاهرة — بره المواعيد
    const night = new Date("2026-09-23T00:00:00Z"); // 03:00 القاهرة (UTC+3 صيفاً)
    const result = checkOrderRules(
      storeMenu,
      { orderType: "pickup", customer: VALID_CUSTOMER, subtotal: 500 },
      night,
    );
    expect(result?.status).toBe(409);
  });

  it("بيقبل جوه مواعيد الجدول الأوتوماتيكي", () => {
    const storeMenu = menu(
      { minimumOrder: 0 },
      { autoSchedule: true, weeklySchedule: weeklySchedule("09:00", "23:00") },
    );
    const noon = new Date("2026-09-23T10:00:00Z"); // 13:00 القاهرة
    const result = checkOrderRules(
      storeMenu,
      { orderType: "pickup", customer: VALID_CUSTOMER, subtotal: 500 },
      noon,
    );
    expect(result).toBeNull();
  });
});

describe("checkOrderRules — نوع الطلب", () => {
  it("بيرفض نوع طلب الأدمن قافله", () => {
    const result = checkOrderRules(menu({ orderTypes: ["pickup"], minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "delivery",
      customer: VALID_CUSTOMER,
      subtotal: 500,
    });
    expect(result?.status).toBe(400);
    expect(result?.message).toContain("مش متاح");
  });

  it("بيقبل النوع المفعّل", () => {
    const result = checkOrderRules(menu({ orderTypes: ["pickup"], minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 500,
    });
    expect(result).toBeNull();
  });
});

describe("checkOrderRules — بيانات العميل المطلوبة", () => {
  it("بيرفض اسم ناقص لما requireName مفعّل", () => {
    const result = checkOrderRules(menu({ requireName: true, minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: { ...VALID_CUSTOMER, name: "ا" },
      subtotal: 500,
    });
    expect(result?.message).toContain("الاسم");
  });

  it("بيرفض رقم موبايل ناقص لما requirePhone مفعّل", () => {
    const result = checkOrderRules(menu({ requirePhone: true, minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: { ...VALID_CUSTOMER, phone: "0101234" },
      subtotal: 500,
    });
    expect(result?.message).toContain("الموبايل");
  });

  it("بيقبل رقم موبايل مكتوب بمسافات وشرطات", () => {
    // المهم عدد الأرقام مش شكل الكتابة
    const result = checkOrderRules(menu({ requirePhone: true, minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: { ...VALID_CUSTOMER, phone: "010 1234-5678" },
      subtotal: 500,
    });
    expect(result).toBeNull();
  });

  it("بيطلب العنوان في التوصيل بس", () => {
    const settings = menu({ requireAddress: true, minimumOrder: 0 }, ALWAYS_OPEN);
    const shortAddress = { ...VALID_CUSTOMER, address: "بيتي" };

    expect(
      checkOrderRules(settings, { orderType: "delivery", customer: shortAddress, subtotal: 500 })
        ?.message,
    ).toContain("العنوان");

    // استلام من المحل → مش محتاج عنوان
    expect(
      checkOrderRules(settings, { orderType: "pickup", customer: shortAddress, subtotal: 500 }),
    ).toBeNull();
  });
});

describe("checkOrderRules — الحد الأدنى", () => {
  it("بيرفض تحت الحد الأدنى العام", () => {
    const result = checkOrderRules(menu({ minimumOrder: 100 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 99,
    });
    expect(result?.status).toBe(400);
    expect(result?.message).toContain("أقل طلب");
  });

  it("بيقبل عند الحد الأدنى بالظبط", () => {
    const result = checkOrderRules(menu({ minimumOrder: 100 }, ALWAYS_OPEN), {
      orderType: "pickup",
      customer: VALID_CUSTOMER,
      subtotal: 100,
    });
    expect(result).toBeNull();
  });

  it("بيرفض تحت الحد الأدنى الخاص بالمنطقة", () => {
    const zone: DeliveryZone = { id: "z1", name: "المعادي", fee: 30, minimumOrder: 200 };
    const result = checkOrderRules(menu({ minimumOrder: 0 }, ALWAYS_OPEN), {
      orderType: "delivery",
      customer: VALID_CUSTOMER,
      subtotal: 150,
      zone,
    });
    expect(result?.message).toContain("المعادي");
  });

  it("الحد الأدنى بيتحسب على الأصناف قبل التوصيل", () => {
    // ١٥٠ صنف + ٥٠ توصيل = ٢٠٠ إجمالي، بس الحد الأدنى على الأصناف بس
    const result = checkOrderRules(menu({ minimumOrder: 200, deliveryFee: 50 }, ALWAYS_OPEN), {
      orderType: "delivery",
      customer: VALID_CUSTOMER,
      subtotal: 150,
    });
    expect(result?.status).toBe(400);
  });
});

describe("resolveDeliveryZone", () => {
  const zones: DeliveryZone[] = [
    { id: "z1", name: "المعادي", fee: 30, minimumOrder: 0 },
    { id: "z2", name: "المهندسين", fee: 45, minimumOrder: 100 },
  ];

  it("مش مطلوبة في الاستلام من المحل", () => {
    const result = resolveDeliveryZone(
      { ...menu().commerce, enableZones: true, deliveryZones: zones },
      "pickup",
      undefined,
    );
    expect(result.required).toBe(false);
  });

  it("مش مطلوبة لما المناطق مقفولة", () => {
    const result = resolveDeliveryZone(
      { ...menu().commerce, enableZones: false, deliveryZones: zones },
      "delivery",
      undefined,
    );
    expect(result.required).toBe(false);
  });

  it("مطلوبة وبترجع null لمعرّف غلط", () => {
    const result = resolveDeliveryZone(
      { ...menu().commerce, enableZones: true, deliveryZones: zones },
      "delivery",
      "مش-موجود",
    );
    expect(result.required).toBe(true);
    expect(result.zone).toBeNull();
  });

  it("بترجّع المنطقة الصح", () => {
    const result = resolveDeliveryZone(
      { ...menu().commerce, enableZones: true, deliveryZones: zones },
      "delivery",
      "z2",
    );
    expect(result.zone?.fee).toBe(45);
  });
});

describe("isStoreAcceptingOrders", () => {
  it("بيحترم المفتاح اليدوي لما الجدول الأوتوماتيكي مقفول", () => {
    expect(isStoreAcceptingOrders(contact({ isOpen: false, autoSchedule: false }))).toBe(false);
    expect(isStoreAcceptingOrders(contact({ isOpen: true, autoSchedule: false }))).toBe(true);
  });
});
