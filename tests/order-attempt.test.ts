import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DATA } from "../lib/defaults";
import type { MenuData, SavedOrder } from "../lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../lib/firebase-admin", () => ({ firebaseProjectId: () => "" }));

let directory: string;
let databasePath: string;
let createOrder: typeof import("../lib/server-database").createOrder;
const item = { id: "tea", categoryId: "", name: "شاي", price: 100, available: true, isNew: false, spicy: 0 as const };
const menu: MenuData = {
  ...DEFAULT_DATA,
  contact: { ...DEFAULT_DATA.contact, isOpen: true, autoSchedule: false },
  items: [item],
};
const input = {
  lines: [{ itemId: item.id, quantity: 1 }],
  customer: { name: "عميل تجريبي", phone: "01012345678", address: "", notes: "" },
  orderType: "pickup" as const,
};

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "order-attempt-test-"));
  databasePath = path.join(directory, "store.json");
  vi.stubEnv("DATABASE_FILE", databasePath);
  ({ createOrder } = await import("../lib/server-database"));
});

beforeEach(async () => {
  await writeFile(databasePath, JSON.stringify({ menu, orders: [], customers: [] }));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function database(): Promise<{ menu: MenuData; orders: SavedOrder[] }> {
  return JSON.parse(await readFile(databasePath, "utf8"));
}

describe("idempotent order attempts", () => {
  it("records concurrent and later retries once, even after the store closes", async () => {
    const key = randomUUID();
    const [first, concurrent] = await Promise.all([createOrder(input, key), createOrder(input, key)]);
    const saved = await database();
    expect(concurrent.order.id).toBe(first.order.id);
    expect(saved.orders).toHaveLength(1);
    expect(saved.menu.items[0].salesCount).toBe(1);

    const state = JSON.parse(await readFile(databasePath, "utf8"));
    state.menu.contact.isOpen = false;
    await writeFile(databasePath, JSON.stringify(state));
    const replay = await createOrder(input, key);
    expect(replay.order).toEqual(first.order);
  });

  it("rejects reusing a key for changed details and allows a new order with the same cart", async () => {
    const key = randomUUID();
    const first = await createOrder(input, key);
    await expect(createOrder({ ...input, lines: [{ itemId: item.id, quantity: 2 }] }, key))
      .rejects.toMatchObject({ status: 409 });
    await expect(createOrder(input, "invalid")).rejects.toMatchObject({ status: 400 });
    const separate = await createOrder(input, randomUUID());
    expect(separate.order.id).not.toBe(first.order.id);
    expect((await database()).orders).toHaveLength(2);
  });
});
