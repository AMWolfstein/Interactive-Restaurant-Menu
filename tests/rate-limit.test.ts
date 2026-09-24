import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getClientIp,
  isSharedRateLimitEnabled,
  rateLimit,
  resetRateLimits,
} from "../lib/rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit — عدّاد الذاكرة", () => {
  const config = { limit: 3, windowMs: 60_000 };

  it("بيسمح بالطلبات تحت الحد", async () => {
    expect((await rateLimit("a", config)).success).toBe(true);
    expect((await rateLimit("a", config)).success).toBe(true);
    expect((await rateLimit("a", config)).success).toBe(true);
  });

  it("بيرفض بعد تجاوز الحد", async () => {
    for (let i = 0; i < 3; i += 1) await rateLimit("b", config);
    const blocked = await rateLimit("b", config);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("بيعد المتبقي صح", async () => {
    expect((await rateLimit("c", config)).remaining).toBe(2);
    expect((await rateLimit("c", config)).remaining).toBe(1);
    expect((await rateLimit("c", config)).remaining).toBe(0);
  });

  it("المفاتيح مستقلة عن بعض", async () => {
    for (let i = 0; i < 3; i += 1) await rateLimit("d1", config);
    expect((await rateLimit("d1", config)).success).toBe(false);
    // مفتاح تاني (IP تاني) لازم يفضل شغال
    expect((await rateLimit("d2", config)).success).toBe(true);
  });

  it("النافذة بتتجدد بعد انتهاء المدة", async () => {
    const short = { limit: 1, windowMs: 1 };
    expect((await rateLimit("e", short)).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await rateLimit("e", short)).success).toBe(true);
  });

  it("بيعلّم إن المصدر الذاكرة لما Redis مش متظبط", async () => {
    expect((await rateLimit("f", config)).store).toBe("memory");
    expect(isSharedRateLimitEnabled()).toBe(false);
  });
});

describe("rateLimit — المخزن المشترك (Redis)", () => {
  const config = { limit: 3, windowMs: 60_000 };

  /** رد pipeline نموذجي: [SET, INCR, PTTL] */
  const pipelineReply = (count: number, ttl = 30_000) =>
    new Response(JSON.stringify([{ result: "OK" }, { result: count }, { result: ttl }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("بيتعرّف إن المخزن المشترك مفعّل", () => {
    expect(isSharedRateLimitEnabled()).toBe(true);
  });

  it("بيسمح طالما العدّاد تحت الحد", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pipelineReply(2)));
    const result = await rateLimit("r1", config);
    expect(result.success).toBe(true);
    expect(result.store).toBe("redis");
    expect(result.remaining).toBe(1);
  });

  it("بيرفض لما العدّاد يعدّي الحد", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pipelineReply(4)));
    const result = await rateLimit("r2", config);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("بيقبل عند الحد بالظبط", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pipelineReply(3)));
    expect((await rateLimit("r3", config)).success).toBe(true);
  });

  it("بيبعت أوامر SET NX + INCR + PTTL في نداء واحد", async () => {
    const spy = vi.fn(async () => pipelineReply(1));
    vi.stubGlobal("fetch", spy);
    await rateLimit("r4", config);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://fake.upstash.io/pipeline");
    const body = JSON.parse(String(init.body));
    expect(body.map((cmd: string[]) => cmd[0])).toEqual(["SET", "INCR", "PTTL"]);
    // المفتاح لازم يكون متبادئ بـ rl: عشان ما يتلخبطش مع بيانات تانية
    expect(body[0][1]).toBe("rl:r4");
    expect(init.headers).toMatchObject({ authorization: "Bearer fake-token" });
  });

  it("بيرجع للذاكرة لو Redis رجّع خطأ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await rateLimit("r5", config);
    expect(result.success).toBe(true);
    expect(result.store).toBe("memory");
  });

  it("بيرجع للذاكرة لو الشبكة وقعت", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await rateLimit("r6", config);
    expect(result.store).toBe("memory");
    // مهم: وقوع Redis ما يمنعش الطلبات السليمة
    expect(result.success).toBe(true);
  });

  it("بيرجع للذاكرة لو الرد فيه error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ result: "OK" }, { error: "WRONGTYPE" }, { result: 1 }]), {
        status: 200,
      }),
    ));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await rateLimit("r7", config)).store).toBe("memory");
  });

  it("بيصلّح TTL الناقص بدل ما يرجّع تاريخ غلط", async () => {
    // -1 = مفتاح من غير انتهاء (سباق نادر بين SET وINCR)
    vi.stubGlobal("fetch", vi.fn(async () => pipelineReply(1, -1)));
    const before = Date.now();
    const result = await rateLimit("r8", config);
    expect(result.resetAt).toBeGreaterThanOrEqual(before + config.windowMs - 50);
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
