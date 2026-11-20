import { checkOrderRules, resolveDeliveryZone } from "./order-rules";
import { generateOrderNumber, orderPrefixFrom } from "./order-number";
import { computeLoyaltyDiscount, nextBalance } from "./loyalty";
import { StoreError } from "./store-error";
import type { CartLine, CustomerRecord, LoyaltyAdjustment, MenuData, OrderStatus, OrderType, SavedOrder } from "./types";

export interface PlaceOrderInput {
  lines: CartLine[];
  customer: { name: string; phone: string; address: string; notes: string };
  orderType: OrderType;
  zoneId?: string;
  paymentMethod?: string;
}

interface ServerTotals {
  subtotal: number;
  delivery: number;
  service: number;
  total: number;
}

/**
 * @param discount خصم «كاشك» — بيتخصم من قيمة الأصناف قبل حساب رسوم الخدمة
 *                 عشان العميل يستفيد بالمكافأة كاملة. التوصيل مش بيتأثر بيه.
 */
function computeServerTotals(
  lines: { price: number; quantity: number }[],
  commerce: MenuData["commerce"],
  orderType: string,
  zoneFee?: number | null,
  discount = 0,
): ServerTotals {
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const isDelivery = orderType === "delivery";
  const qualifiesFree =
    isDelivery && commerce.freeDeliveryOver > 0 && subtotal >= commerce.freeDeliveryOver;
  const baseFee = typeof zoneFee === "number" && zoneFee >= 0 ? zoneFee : commerce.deliveryFee;
  const delivery = isDelivery && !qualifiesFree ? Math.max(0, baseFee) : 0;
  const safeDiscount = Math.max(0, Math.min(subtotal, discount));
  const service =
    commerce.serviceChargePercent > 0
      ? Math.round(((subtotal - safeDiscount + delivery) * commerce.serviceChargePercent) / 100)
      : 0;
  return {
    subtotal,
    delivery,
    service,
    total: Math.max(0, subtotal - safeDiscount + delivery + service),
  };
}

export function orderNumber(menu: MenuData, exists?: (id: string) => boolean) {
  return generateOrderNumber(orderPrefixFrom({
    orderPrefix: menu.commerce.orderPrefix,
    storeNameEn: menu.brand.storeNameEn,
    storeName: menu.brand.storeName,
  }), exists);
}

export function prepareOrder(
  menu: MenuData,
  input: PlaceOrderInput,
  id: string,
  createdAt: string,
  phoneKey: string,
  customer?: CustomerRecord,
) {
  const { required, zone } = resolveDeliveryZone(menu.commerce, input.orderType, input.zoneId);
  if (required && !zone) throw new StoreError("اختار منطقة التوصيل", 400);

  const soldQuantities = new Map<string, number>();
  const items = new Map(menu.items.map((item) => [item.id, item]));
  const lines = input.lines.map(({ itemId, quantity }) => {
    const item = items.get(itemId);
    if (!item?.available) throw new StoreError("أحد المنتجات لم يعد متاحاً", 409);
    soldQuantities.set(itemId, (soldQuantities.get(itemId) ?? 0) + quantity);
    return { itemId, name: item.name, quantity, unitPrice: item.price };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const violation = checkOrderRules(menu, {
    orderType: input.orderType,
    customer: input.customer,
    subtotal,
    zone,
  });
  if (violation) throw new StoreError(violation.message, violation.status);

  const settings = menu.commerce.loyalty;
  const loyalty = phoneKey && settings.percent > 0
    ? computeLoyaltyDiscount(settings, subtotal, customer?.spent ?? 0)
    : null;
  const totals = computeServerTotals(
    lines.map(({ unitPrice, quantity }) => ({ price: unitPrice, quantity })),
    menu.commerce,
    input.orderType,
    zone?.fee,
    loyalty?.discount,
  );

  const order: SavedOrder = {
    id,
    createdAt,
    customer: input.customer,
    orderType: input.orderType,
    lines,
    subtotal: totals.subtotal,
    deliveryFee: totals.delivery,
    serviceFee: totals.service,
    total: totals.total,
    currency: menu.commerce.currency,
    status: "new",
    ...(zone ? { zoneName: zone.name } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    ...(loyalty ? { loyalty } : {}),
  };

  const discount = loyalty?.discount ?? 0;
  const updatedCustomer: CustomerRecord | undefined = phoneKey ? {
    phone: phoneKey,
    name: input.customer.name || customer?.name || "",
    spent: loyalty?.balanceAfter ?? nextBalance(customer?.spent ?? 0, subtotal),
    lifetime: (customer?.lifetime ?? 0) + subtotal,
    ordersCount: (customer?.ordersCount ?? 0) + 1,
    rewardsUsed: (customer?.rewardsUsed ?? 0) + Number(discount > 0),
    discountTotal: (customer?.discountTotal ?? 0) + discount,
    createdAt: customer?.createdAt ?? createdAt,
    updatedAt: createdAt,
  } : undefined;

  return { order, updatedCustomer, soldQuantities };
}

const loyaltyFields = ["spent", "lifetime", "ordersCount", "rewardsUsed", "discountTotal"] as const;

export function changeOrderStatus(
  order: SavedOrder,
  status: OrderStatus,
  now: string,
  customer?: CustomerRecord,
) {
  const updatedOrder = { ...order, status, statusUpdatedAt: now };
  const previous = order.status === "cancelled" ? "cancelled" : "new";
  if (status === previous || !customer) return { order: updatedOrder };

  const subtotal = Math.max(0, order.subtotal ?? 0);
  const sign = status === "cancelled" ? -1 : 1;
  const discount = order.loyalty?.discount ?? 0;
  const expected: LoyaltyAdjustment = {
    spent: sign * (subtotal - (order.loyalty?.threshold ?? 0)),
    lifetime: sign * subtotal,
    ordersCount: sign,
    rewardsUsed: discount > 0 ? sign : 0,
    discountTotal: sign * discount,
  };
  const updatedCustomer = { ...customer, updatedAt: now };
  const applied = { ...expected };
  for (const field of loyaltyFields) {
    const delta = order.loyaltyAdjustment ? -(order.loyaltyAdjustment[field] ?? 0) : expected[field];
    updatedCustomer[field] = Math.max(0, customer[field] + delta);
    applied[field] = updatedCustomer[field] - customer[field];
  }
  return { order: { ...updatedOrder, loyaltyAdjustment: applied }, updatedCustomer };
}
