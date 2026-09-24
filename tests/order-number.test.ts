import { describe, expect, it } from "vitest";

import { generateOrderNumber, orderPrefixFrom } from "../lib/order-number";

/** نفس المنطق متكرر في generate_order_number في SQL */

describe("orderPrefixFrom", () => {
  it("بيستخدم البادئة المضبوطة يدوياً", () => {
    expect(orderPrefixFrom({ orderPrefix: "bf" })).toBe("BF");
  });

  it("بينضّف الرموز من البادئة", () => {
    expect(orderPrefixFrom({ orderPrefix: "b-f!@#" })).toBe("BF");
  });

  it("بيحدّد البادئة بـ4 حروف", () => {
    expect(orderPrefixFrom({ orderPrefix: "ABCDEFGH" })).toBe("ABCD");
  });

  it("بياخد أوائل حروف الاسم الإنجليزي", () => {
    expect(orderPrefixFrom({ storeNameEn: "Burger Factory" })).toBe("BF");
  });

  it("بيستخدم حروف الاسم لما يبقى كلمة واحدة", () => {
    expect(orderPrefixFrom({ storeNameEn: "Koshary" })).toBe("KOS");
  });

  it("بيرجع ORD لما مفيش أي مصدر", () => {
    expect(orderPrefixFrom({})).toBe("ORD");
    expect(orderPrefixFrom({ storeNameEn: "مطعم" })).toBe("ORD");
  });
});

describe("generateOrderNumber", () => {
  it("بيولّد رقم بالشكل الصح", () => {
    expect(generateOrderNumber("BF")).toMatch(/^BF-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it("الأبجدية مافيهاش حروف متشابهة (0/O/1/I)", () => {
    // الأرقام دي بتتقري بصوت عالي في المحل، فالالتباس بيوجع
    const codes = Array.from({ length: 200 }, () => generateOrderNumber("X").split("-")[1]!);
    expect(codes.join("")).not.toMatch(/[01OI]/);
  });

  it("بيتجنّب الأرقام المستخدمة", () => {
    let calls = 0;
    // أول محاولتين نقول إن الرقم مستخدم
    const number = generateOrderNumber("BF", () => (calls++ < 2 ? true : false));
    expect(number).toMatch(/^BF-/);
    expect(calls).toBeGreaterThan(2);
  });

  it("بيرجع لبادئة ORD لو البادئة مش صالحة", () => {
    expect(generateOrderNumber("!!!")).toMatch(/^ORD-/);
  });

  it("بيولّد أرقام مختلفة", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateOrderNumber("BF")));
    expect(set.size).toBe(100);
  });
});
