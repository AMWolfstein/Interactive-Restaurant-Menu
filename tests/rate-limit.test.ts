import { beforeEach, describe, expect, it } from "vitest";

import { getClientIp, rateLimit, resetRateLimits } from "../lib/rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  const config = { limit: 3, windowMs: 60_000 };

  it("بيسمح بالطلبات تحت الحد", () => {
    expect(rateLimit("a", config).success).toBe(true);
    expect(rateLimit("a", config).success).toBe(true);
    expect(rateLimit("a", config).success).toBe(true);
  });

  it("بيرفض بعد تجاوز الحد", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("b", config);
    const blocked = rateLimit("b", config);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("بيعد المتبقي صح", () => {
    expect(rateLimit("c", config).remaining).toBe(2);
    expect(rateLimit("c", config).remaining).toBe(1);
    expect(rateLimit("c", config).remaining).toBe(0);
  });

  it("المفاتيح مستقلة عن بعض", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("d1", config);
    expect(rateLimit("d1", config).success).toBe(false);
    // مفتاح تاني (IP تاني) لازم يفضل شغال
    expect(rateLimit("d2", config).success).toBe(true);
  });

  it("النافذة بتتجدد بعد انتهاء المدة", () => {
    const short = { limit: 1, windowMs: 1 };
    expect(rateLimit("e", short).success).toBe(true);
    // ننتظر لحد ما النافذة تعدي
    const until = Date.now() + 5;
    while (Date.now() < until) {
      /* انتظار قصير */
    }
    expect(rateLimit("e", short).success).toBe(true);
  });
});

describe("getClientIp", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test", { headers });

  it("بيفضّل هيدر Vercel الموثوق", () => {
    expect(
      getClientIp(req({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })),
    ).toBe("1.1.1.1");
  });

  it("بياخد أول IP من x-forwarded-for", () => {
    expect(getClientIp(req({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
  });

  it("بيرجع unknown من غير هيدرات", () => {
    expect(getClientIp(req({}))).toBe("unknown");
  });
});
