// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedOrder } from "../lib/types";

/**
 * الستور ده هو اللي بيمنع رجوع الباج القديم: تلات لوبات منفصلة بتضرب
 * `/api/admin/overview` في نفس الوقت (اللوحة + الطلبات + التنبيهات).
 * الاختبارات هنا بتثبّت إن المشتركين بيتشاركوا نداء واحد.
 */

const fetchMock = vi.fn();
const realtimeUnsubscribe = vi.fn();
const subscribeRealtimeMock = vi.fn(() => realtimeUnsubscribe);

vi.mock("../lib/supabase-auth-core", () => ({
  authenticatedFetch: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("../lib/realtime", () => ({
  subscribeRealtime: (...args: unknown[]) => subscribeRealtimeMock(...(args as [])),
}));

vi.mock("../lib/supabase", () => ({ ORDERS_TABLE: "orders" }));

const order = (id: string): SavedOrder => ({ id, status: "new" }) as SavedOrder;

const okReply = (orders: SavedOrder[]) => ({
  ok: true,
  json: async () => ({ orders, storage: { driver: "supabase", persistent: true } }),
});

type Store = typeof import("../lib/admin-overview-store");
let store: Store;

/** بيستنى المهام الدقيقة تخلص عشان الـ fetch يتحل */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  subscribeRealtimeMock.mockClear();
  realtimeUnsubscribe.mockClear();
  fetchMock.mockResolvedValue(okReply([order("A")]));
  store = await import("../lib/admin-overview-store");
});

afterEach(() => {
  store.resetAdminOverviewStore();
});

describe("الستور المشترك — دمج النداءات", () => {
  it("تلات مشتركين = نداء شبكة واحد", async () => {
    // ده بالظبط سيناريو اللوحة + الطلبات + التنبيهات مع بعض
    store.subscribeAdminOverview(() => {});
    store.subscribeAdminOverview(() => {});
    store.subscribeOverviewRefresh(() => {});
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("اشتراك Realtime واحد بس مهما كان عدد المشتركين", async () => {
    store.subscribeAdminOverview(() => {});
    store.subscribeAdminOverview(() => {});
    store.subscribeOverviewRefresh(() => {});
    await flush();

    expect(subscribeRealtimeMock).toHaveBeenCalledTimes(1);
  });

  it("النداءات المتزامنة بتتجمّع في طلب واحد", async () => {
    store.subscribeAdminOverview(() => {});
    await flush();
    fetchMock.mockClear();

    await Promise.all([
      store.refreshAdminOverview(true),
      store.refreshAdminOverview(true),
      store.refreshAdminOverview(true),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("بيتجاهل التحديث المتكرر السريع (throttle)", async () => {
    store.subscribeAdminOverview(() => {});
    await flush();
    fetchMock.mockClear();

    // موجة Realtime: خمس أحداث ورا بعض
    for (let i = 0; i < 5; i += 1) await store.refreshAdminOverview();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("force بيتجاوز الـ throttle", async () => {
    store.subscribeAdminOverview(() => {});
    await flush();
    fetchMock.mockClear();

    await store.refreshAdminOverview(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("الستور المشترك — الحالة والإشعارات", () => {
  it("بيوزّع البيانات على كل المشتركين", async () => {
    const listener = vi.fn();
    store.subscribeAdminOverview(listener);
    await flush();

    expect(listener).toHaveBeenCalled();
    expect(store.getAdminOverviewSnapshot().orders).toHaveLength(1);
    expect(store.getAdminOverviewSnapshot().loading).toBe(false);
  });

  it("بيبلّغ مستمعي التحديث بالطلبات الجديدة", async () => {
    const onRefresh = vi.fn();
    store.subscribeOverviewRefresh(onRefresh);
    await flush();

    expect(onRefresh).toHaveBeenCalledWith([expect.objectContaining({ id: "A" })]);
  });

  it("بيسجّل الخطأ لما الرد مش ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "ممنوع" }) });
    store.subscribeAdminOverview(() => {});
    await flush();

    expect(store.getAdminOverviewSnapshot().error).toBe("ممنوع");
    expect(store.getAdminOverviewSnapshot().loading).toBe(false);
  });

  it("بيسجّل خطأ اتصال لما الشبكة تقع", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    store.subscribeAdminOverview(() => {});
    await flush();

    expect(store.getAdminOverviewSnapshot().error).toContain("تعذّر");
  });

  it("اللقطة بتفضل نفس المرجع لو مفيش تغيير (مهم لـuseSyncExternalStore)", async () => {
    store.subscribeAdminOverview(() => {});
    await flush();
    const first = store.getAdminOverviewSnapshot();
    expect(store.getAdminOverviewSnapshot()).toBe(first);
  });
});

describe("الستور المشترك — التنظيف", () => {
  it("بيوقف الـRealtime لما آخر مشترك يخرج", async () => {
    const off1 = store.subscribeAdminOverview(() => {});
    const off2 = store.subscribeOverviewRefresh(() => {});
    await flush();

    off1();
    expect(realtimeUnsubscribe).not.toHaveBeenCalled(); // لسه فيه مشترك

    off2();
    expect(realtimeUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("بيعيد التشغيل لو حد اشترك تاني بعد التنظيف", async () => {
    const off = store.subscribeAdminOverview(() => {});
    await flush();
    off();

    subscribeRealtimeMock.mockClear();
    store.subscribeAdminOverview(() => {});
    await flush();

    expect(subscribeRealtimeMock).toHaveBeenCalledTimes(1);
  });
});

describe("applyOrderUpdate — التحديث التفاؤلي", () => {
  it("بيستبدل الطلب في اللقطة المشتركة", async () => {
    fetchMock.mockResolvedValue(okReply([order("A"), order("B")]));
    store.subscribeAdminOverview(() => {});
    await flush();

    store.applyOrderUpdate({ ...order("B"), status: "cancelled" } as SavedOrder);

    const orders = store.getAdminOverviewSnapshot().orders;
    expect(orders.find((o) => o.id === "B")?.status).toBe("cancelled");
    expect(orders.find((o) => o.id === "A")?.status).toBe("new");
  });

  it("بيبلّغ المشتركين بالتغيير", async () => {
    const listener = vi.fn();
    store.subscribeAdminOverview(listener);
    await flush();
    listener.mockClear();

    store.applyOrderUpdate({ ...order("A"), status: "cancelled" } as SavedOrder);
    expect(listener).toHaveBeenCalled();
  });

  it("بيتجاهل طلب مش موجود من غير ما يكسر حاجة", async () => {
    store.subscribeAdminOverview(() => {});
    await flush();
    const before = store.getAdminOverviewSnapshot();

    store.applyOrderUpdate(order("مش-موجود"));
    expect(store.getAdminOverviewSnapshot()).toBe(before);
  });
});
