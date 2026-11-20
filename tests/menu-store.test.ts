// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DATA } from "../lib/defaults";

const { save, realtime } = vi.hoisted(() => ({ save: vi.fn(), realtime: vi.fn() }));
vi.mock("../lib/firebase-auth-core", () => ({ authenticatedFetch: save }));
vi.mock("../lib/realtime", () => ({ subscribeRealtime: realtime }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  save.mockReset();
  realtime.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const menu = (storeName: string) => ({ ...DEFAULT_DATA, brand: { ...DEFAULT_DATA.brand, storeName } });
const response = (storeName: string) => Response.json(menu(storeName));

it("shares simultaneous reads and ignores an old response that finishes after a local save", async () => {
  let reply!: (value: Response) => void;
  const fetchMenu = vi.fn(() => new Promise<Response>((resolve) => { reply = resolve; }));
  vi.stubGlobal("fetch", fetchMenu);
  save.mockResolvedValue(response("محل محدث"));
  const store = await import("../lib/menu-store-core");

  const first = store.refreshMenu();
  expect(store.refreshMenu()).toBe(first);
  expect(fetchMenu).toHaveBeenCalledTimes(1);

  store.patchBrand({ storeName: "محل محدث" });
  await vi.advanceTimersByTimeAsync(220);
  expect(store.getMenuSnapshot().saveState).toBe("saved");

  reply(response("محل قديم"));
  await first;
  expect(store.getMenuSnapshot().data.brand.storeName).toBe("محل محدث");
});

it("leaves a failed draft available for editing when the catalog refreshes", async () => {
  const fetchMenu = vi.fn().mockResolvedValue(response("محل محفوظ"));
  vi.stubGlobal("fetch", fetchMenu);
  save.mockResolvedValue(Response.json({ error: "تعذّر الحفظ" }, { status: 503 }));
  const store = await import("../lib/menu-store-core");
  await store.refreshMenu();

  store.patchBrand({ storeName: "مسودة المحل" });
  await vi.advanceTimersByTimeAsync(220);
  await store.refreshMenu();

  expect(fetchMenu).toHaveBeenCalledTimes(1);
  expect(store.getMenuSnapshot()).toMatchObject({
    saveState: "error",
    saveError: "تعذّر الحفظ",
    data: { brand: { storeName: "مسودة المحل" } },
  });
});

it("queues one fresh read when catalog notifications arrive during a read", async () => {
  let reply!: (value: Response) => void;
  const fetchMenu = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { reply = resolve; }))
    .mockResolvedValueOnce(response("آخر تحديث"));
  vi.stubGlobal("fetch", fetchMenu);
  const store = await import("../lib/menu-store-core");
  const unsubscribe = store.subscribeMenu(() => undefined);
  const currentRead = store.refreshMenu();
  const changed = realtime.mock.calls[0][1] as () => void;
  changed();
  changed();
  expect(fetchMenu).toHaveBeenCalledTimes(1);

  reply(response("قبل التحديث"));
  await currentRead;
  await store.refreshMenu();
  expect(fetchMenu).toHaveBeenCalledTimes(2);
  expect(store.getMenuSnapshot().data.brand.storeName).toBe("آخر تحديث");
  unsubscribe();
});
