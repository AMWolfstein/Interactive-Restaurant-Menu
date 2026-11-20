import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import { DEFAULT_DATA } from "./defaults";
import { normalizeData } from "./normalize";
import {
  customerMatches,
  fetchCustomer,
  fetchCustomerOrders,
  fetchLatestOrders,
  fetchPublishedMenu,
  placeOrder,
  savePublishedMenu,
  searchCustomers,
  updateOrderStatus,
} from "./firestore-store";
import { firebaseProjectId } from "./firebase-admin";
import { changeOrderStatus, orderNumber, prepareOrder, type PlaceOrderInput } from "./order-write";
import { isValidOrderType, sanitizeText } from "./validation";
import { isUsablePhone, loyaltyStatus, normalizePhone, type LoyaltyStatus } from "./loyalty";
import { assertSameOrderAttempt, missingAttemptOrder, orderAttempt, type OrderAttempt, type SavedOrderAttempt } from "./order-attempt";
import { StoreError } from "./store-error";
import type { AdminOverview, CustomerRecord, MenuData, OrderStatus, SavedOrder } from "./types";

export { StoreError } from "./store-error";

const DATABASE_PATH = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "store.json");
const FILE_ORDER_LIMIT = 500;

interface FileDatabase {
  menu: MenuData;
  orders: SavedOrder[];
  /** عملاء نظام «كاشك» — مفتاحهم رقم الموبايل بصيغة موحّدة */
  customers: CustomerRecord[];
  orderAttempts: Record<string, SavedOrderAttempt>;
}

const freshDatabase = (): FileDatabase => ({
  menu: normalizeData(structuredClone(DEFAULT_DATA)),
  orders: [],
  customers: [],
  orderAttempts: {},
});

let queue = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readFileDatabase(): Promise<FileDatabase> {
  let parsed: Partial<FileDatabase> | undefined;
  try {
    parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ DATABASE_PATH, "utf8"),
    ) as Partial<FileDatabase>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!parsed) {
    const initial = freshDatabase();
    await writeFileDatabase(initial);
    return initial;
  }
  return {
    menu: normalizeData(parsed.menu ?? DEFAULT_DATA),
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    orderAttempts: parsed.orderAttempts ?? {},
  };
}

async function writeFileDatabase(database: FileDatabase) {
  await fs.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
  const temporary = `${DATABASE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(database, null, 2), "utf8");
  await fs.rename(temporary, DATABASE_PATH);
}

// حالتان بس: الطلب من الموقع هيتنفذ (توصيل أو استلام)، والملغي هو اللي
// الأدمن لغاه — «مؤكد» و«تم التسليم» اتشالوا.
const ORDER_STATUSES: OrderStatus[] = ["new", "cancelled"];

function isValidStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* الواجهة الموحّدة                                                    */
/* ------------------------------------------------------------------ */

async function readMenu(): Promise<MenuData> {
  if (firebaseProjectId()) {
    return (await fetchPublishedMenu()) ?? normalizeData(structuredClone(DEFAULT_DATA));
  }
  return (await readFileDatabase()).menu;
}

/**
 * قراءة الكتالوج مع تجميع نداءات نفس الطلب في نداء واحد (React cache):
 * الـ layout والصفحة والـ metadata كلهم بيقروا نفس اللقطة — فمفيش اختلاف
 * بين الهيدر والمحتوى، ولا ضغط زيادة على قاعدة البيانات.
 */
export const getMenu = cache(readMenu);

export async function replaceMenu(menu: MenuData, token: string | null): Promise<MenuData> {
  // حماية من حمولة كبيرة (DoS عبر JSON ضخم أو صور dataURL كبيرة)
  const size = JSON.stringify(menu).length;
  if (size > 4_000_000) throw new StoreError("البيانات كبيرة جداً (الحد 4MB)", 413);
  const normalized = normalizeData({ ...menu, updatedAt: new Date().toISOString() });

  if (firebaseProjectId()) {
    if (!token) throw new StoreError("غير مصرّح", 401);
    return savePublishedMenu(normalized);
  }

  return serialized(async () => {
    const database = await readFileDatabase();
    database.menu = normalized;
    await writeFileDatabase(database);
    return database.menu;
  });
}

export async function createOrder(input: Partial<PlaceOrderInput>, key: string | null = null): Promise<{ order: SavedOrder }> {
  // تحقق أساسي من نوع الطلب
  const orderType = input?.orderType;
  if (!orderType || !isValidOrderType(orderType)) throw new StoreError("نوع الطلب غير صالح", 400);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new StoreError("السلة فارغة", 400);
  if (input.lines.length > 50) throw new StoreError("عدد المنتجات كبير جداً (الحد 50)", 400);

  // تعقيم بيانات العميل
  const sanitizedInput: PlaceOrderInput = {
    customer: {
      name: sanitizeText(input.customer?.name ?? "", 100),
      phone: sanitizeText(input.customer?.phone ?? "", 30),
      address: sanitizeText(input.customer?.address ?? "", 500),
      notes: sanitizeText(input.customer?.notes ?? "", 500),
    },
    orderType,
    lines: input.lines.map((l) => {
      if (!l || typeof l.itemId !== "string") throw new StoreError("منتج غير صالح", 400);
      const rawQty = Math.floor(Number(l.quantity) || 0);
      if (rawQty < 1 || rawQty > 50) throw new StoreError("الكمية يجب أن تكون بين 1 و 50", 400);
      const variantId = sanitizeText(l.variantId ?? "", 50);
      return {
        itemId: sanitizeText(l.itemId, 50),
        ...(variantId ? { variantId } : {}),
        quantity: rawQty,
      };
    }),
    zoneId: sanitizeText(input.zoneId ?? "", 60) || undefined,
    paymentMethod: sanitizeText(input.paymentMethod ?? "", 40) || undefined,
  };

  const attempt = orderAttempt(key, sanitizedInput);
  const order = firebaseProjectId()
    ? await placeOrder(sanitizedInput, attempt)
    : await serialized(() => createOrderInFile(sanitizedInput, attempt));
  return { order };
}

async function createOrderInFile(input: PlaceOrderInput, attempt: OrderAttempt | null) {
  const database = await readFileDatabase();
  if (attempt) {
    const saved = database.orderAttempts[attempt.id];
    if (saved) {
      assertSameOrderAttempt(attempt, saved);
      return database.orders.find((order) => order.id === saved.orderId) ?? missingAttemptOrder();
    }
  }
  const phoneKey = database.menu.commerce.loyalty.enabled && isUsablePhone(input.customer.phone)
    ? normalizePhone(input.customer.phone)
    : "";
  const customerIndex = database.customers.findIndex((row) => row.phone === phoneKey);
  const existingIds = new Set(database.orders.map((candidate) => candidate.id));
  const now = new Date().toISOString();
  const { order, updatedCustomer, soldQuantities } = prepareOrder(
    database.menu, input, orderNumber(database.menu, (id) => existingIds.has(id)), now,
    phoneKey, database.customers[customerIndex],
  );

  for (const item of database.menu.items) {
    item.salesCount = Math.max(0, item.salesCount ?? 0) + (soldQuantities.get(item.id) ?? 0);
  }
  if (updatedCustomer) {
    if (customerIndex === -1) database.customers.push(updatedCustomer);
    else database.customers[customerIndex] = updatedCustomer;
  }
  database.orders.push(order);
  if (attempt) database.orderAttempts[attempt.id] = { orderId: order.id, fingerprint: attempt.fingerprint };
  database.orders = database.orders.slice(-FILE_ORDER_LIMIT);
  database.menu.updatedAt = now;
  await writeFileDatabase(database);
  return order;
}

/** تحديث حالة طلب مسجّل — للأدمن فقط */
export async function setOrderStatus(
  orderId: string,
  status: string,
  token: string | null,
): Promise<SavedOrder> {
  const id = sanitizeText(orderId, 40);
  if (!id) throw new StoreError("رقم الطلب مطلوب", 400);
  if (!isValidStatus(status)) throw new StoreError("حالة الطلب غير صالحة", 400);

  if (firebaseProjectId()) {
    if (!token) throw new StoreError("غير مصرّح", 401);
    return updateOrderStatus(id, status);
  }

  return serialized(async () => {
    const database = await readFileDatabase();
    const index = database.orders.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new StoreError("الطلب غير موجود", 404);
    const order = database.orders[index];
    const phoneKey = normalizePhone(order.customer?.phone ?? "");
    const customerIndex = database.customers.findIndex((row) => row.phone === phoneKey);
    const result = changeOrderStatus(order, status, new Date().toISOString(), database.customers[customerIndex]);
    database.orders[index] = result.order;
    if (result.updatedCustomer) database.customers[customerIndex] = result.updatedCustomer;
    await writeFileDatabase(database);
    return result.order;
  });
}

/**
 * الطلبات لصفحة الفواتير — نفس مصدر بيانات الأدمن (جدول orders) بالظبط،
 * لكن الرد بيرجّع الطلبات بس من غير حالة التخزين أو أي بيانات إدارية.
 */
export async function getOrdersForInvoices(token: string | null): Promise<SavedOrder[]> {
  const overview = await getAdminOverview(token);
  return overview.orders;
}

export async function getAdminOverview(token: string | null): Promise<AdminOverview> {

  if (firebaseProjectId()) {
    if (!token) throw new StoreError("غير مصرّح", 401);
    return { orders: await fetchLatestOrders(), storage: { driver: "firestore", persistent: true } };
  }

  const database = await readFileDatabase();
  return {
    orders: database.orders.slice(-FILE_ORDER_LIMIT).reverse(),
    storage: { driver: "file", persistent: false },
  };
}

/* ------------------------------------------------------------------ */
/* نظام «كاشك» — أرصدة العملاء                                        */
/* ------------------------------------------------------------------ */

/**
 * رصيد كاشك لعميل بالموبايل — بيتنادى من السلة قبل تسجيل الطلب عشان نعرض
 * للعميل «فاضلك كذا» أو «مبروك، خصم ٥٪ على الطلب ده».
 *
 * ده للعرض بس؛ الخصم الحقيقي بيتحسب في قاعدة البيانات وقت تسجيل الطلب،
 * فحتى لو حد زوّد الرقم ده من المتصفح مش هيغيّر حاجة في الفاتورة.
 */
export async function getLoyaltyStatus(phone: string): Promise<LoyaltyStatus> {
  const menu = await getMenu();
  const settings = menu.commerce.loyalty;
  const off = loyaltyStatus({ ...settings, enabled: false }, 0);
  if (!settings.enabled || !isUsablePhone(phone)) return off;

  const key = normalizePhone(phone);
  const customer = firebaseProjectId()
    ? await fetchCustomer(key)
    : (await readFileDatabase()).customers.find((row) => row.phone === key);
  return loyaltyStatus(settings, customer?.spent ?? 0);
}

/** بحث العملاء للوحة التحكم — بحث على السيرفر مش مقيّد بآخر ٥٠٠ طلب */
export async function listCustomers(
  query: string,
  token: string | null,
  limit = 50,
): Promise<CustomerRecord[]> {
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const search = sanitizeText(query, 60);

  if (firebaseProjectId()) {
    if (!token) throw new StoreError("غير مصرّح", 401);
    return searchCustomers(search, safeLimit);
  }
  const database = await readFileDatabase();
  const needle = search.toLowerCase();
  const digits = normalizePhone(search);
  return database.customers
    .filter((row) => customerMatches(row, needle, digits))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, safeLimit);
}

/** كل طلبات عميل واحد بالموبايل — تاريخ مشترياته الكامل */
export async function getCustomerOrders(
  phone: string,
  token: string | null,
  limit = 100,
): Promise<SavedOrder[]> {
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit) || 100));
  if (!isUsablePhone(phone)) return [];

  const key = normalizePhone(phone);
  if (firebaseProjectId()) {
    if (!token) throw new StoreError("غير مصرّح", 401);
    return fetchCustomerOrders(key, safeLimit);
  }

  const database = await readFileDatabase();
  return database.orders
    .filter((order) => normalizePhone(order.customer?.phone ?? "") === key)
    .reverse()
    .slice(0, safeLimit);
}
