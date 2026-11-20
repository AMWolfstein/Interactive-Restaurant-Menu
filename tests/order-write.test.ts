import { describe, expect, it } from "vitest";
import { DEFAULT_DATA } from "../lib/defaults";
import { changeOrderStatus, prepareOrder, type PlaceOrderInput } from "../lib/order-write";
import type { CustomerRecord, MenuData } from "../lib/types";
import { ALWAYS_OPEN, commerce, contact } from "./helpers";

const now = "2026-11-20T10:30:00.000Z";
const phone = "01012345678";
const item = {
  id: "tea",
  categoryId: "drinks",
  name: "شاي",
  price: 100,
  available: true,
  isNew: false,
  spicy: 0 as const,
};
const input: PlaceOrderInput = {
  lines: [{ itemId: item.id, quantity: 1 }],
  customer: { name: "عميل تجريبي", phone, address: "عنوان تجريبي كامل", notes: "" },
  orderType: "delivery",
  zoneId: "near",
  paymentMethod: "كاش",
};
const catalog: MenuData = {
  ...DEFAULT_DATA,
  contact: contact(ALWAYS_OPEN),
  commerce: commerce({
    minimumOrder: 0,
    enableZones: true,
    deliveryZones: [{ id: "near", name: "قريب", fee: 12, minimumOrder: 100 }],
    loyalty: { enabled: true, label: "كاشك", threshold: 500, percent: 10 },
  }),
  items: [item],
};
const customer: CustomerRecord = {
  phone,
  name: input.customer.name,
  spent: 550,
  lifetime: 550,
  ordersCount: 1,
  rewardsUsed: 0,
  discountTotal: 0,
  createdAt: now,
  updatedAt: now,
};

describe("transactional order calculations", () => {
  it("stores a price snapshot and consumes the reward before pricing a second order", () => {
    const first = prepareOrder(catalog, input, "ORD-ABCDE", now, phone, customer);
    const second = prepareOrder(catalog, input, "ORD-FGHIJ", now, phone, first.updatedCustomer);

    expect(first.order).toMatchObject({
      total: 102, subtotal: 100, deliveryFee: 12, zoneName: "قريب", paymentMethod: "كاش",
      lines: [{ unitPrice: 100 }], loyalty: { discount: 10, balanceAfter: 150 },
    });
    expect(first.soldQuantities.get(item.id)).toBe(1);
    expect(second.order.total).toBe(112);
    expect(second.order.loyalty).toBeUndefined();
    expect(second.updatedCustomer?.spent).toBe(250);
    expect(customer.spent).toBe(550);
  });

  it("restores only the balance actually removed when cancelling hit zero", () => {
    const { order } = prepareOrder(catalog, input, "ORD-ABCDE", now, phone, { ...customer, spent: 0 });
    const reducedBalance = { ...customer, spent: 50 };
    const cancelled = changeOrderStatus(order, "cancelled", now, reducedBalance);
    expect(cancelled.updatedCustomer?.spent).toBe(0);
    expect(cancelled.order.loyaltyAdjustment?.spent).toBe(-50);
    expect(changeOrderStatus(cancelled.order, "cancelled", now, cancelled.updatedCustomer).updatedCustomer).toBeUndefined();

    const restored = changeOrderStatus(cancelled.order, "new", now, cancelled.updatedCustomer);
    expect(restored.updatedCustomer?.spent).toBe(50);
    expect(restored.updatedCustomer?.ordersCount).toBe(reducedBalance.ordersCount);
  });
});
