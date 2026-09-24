import { describe, expect, it } from "vitest";

import { isLegacyMenyuBackup, normalizeData } from "../lib/normalize";
import { DEFAULT_DATA } from "../lib/defaults";

describe("normalizeData — الاستيراد من Menyu القديم", () => {
  const legacy = {
    restaurant: {
      name: "برجر فاكتوري",
      phone: "+20 101 234-5678",
      currency: "ج.م",
    },
    categories: [{ id: "c1", name: "برجر" }],
    items: [{ id: "i1", name: "تشيز برجر", price: 120, categoryId: "c1", imageUrl: "x.jpg" }],
  };

  it("بيتعرّف على النسخة القديمة", () => {
    expect(isLegacyMenyuBackup(legacy)).toBe(true);
    expect(isLegacyMenyuBackup({ items: [], categories: [] })).toBe(false);
  });

  it("بينضّف رقم الواتساب من الرموز والمسافات", () => {
    // كان فيه باج هنا: /\\D/g بدل /\D/g — يعني التعبير كان بيدوّر على حرف
    // شرطة مايلة حرفي متبوع بـ D، فما كانش بيشيل أي حاجة والرقم بيتخزّن
    // «+20 101 234-5678» زي ما هو، ورابط الواتساب بيبوظ.
    const result = normalizeData(legacy);
    expect(result.contact.whatsapp).toBe("201012345678");
    expect(result.contact.whatsapp).not.toContain("+");
    expect(result.contact.whatsapp).not.toContain(" ");
    expect(result.contact.whatsapp).not.toContain("-");
  });

  it("بيحتفظ برقم التليفون زي ما هو للعرض", () => {
    expect(normalizeData(legacy).contact.phone).toBe("+20 101 234-5678");
  });

  it("بينقل اسم المحل والعملة", () => {
    const result = normalizeData(legacy);
    expect(result.brand.storeName).toBe("برجر فاكتوري");
    expect(result.commerce.currency).toBe("ج.م");
  });
});

describe("normalizeData — الثبات", () => {
  it("بيكمّل الناقص من الافتراضيات", () => {
    const result = normalizeData({});
    expect(result.commerce.currency).toBe(DEFAULT_DATA.commerce.currency);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("بيثبّت اللغة على العربي", () => {
    expect(normalizeData({ brand: { language: "en" } }).brand.language).toBe("ar");
  });

  it("بيرجّع شكل صالح لأي مدخل غريب", () => {
    for (const input of [null, undefined, 0, "نص", [], true]) {
      const result = normalizeData(input);
      expect(result.commerce).toBeDefined();
      expect(result.contact).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }
  });

  it("بيصحّح productLayout الغلط لـ list", () => {
    expect(normalizeData({ commerce: { productLayout: "حاجة غريبة" } }).commerce.productLayout).toBe("list");
  });
});
