import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_DATA } from "./defaults";
import { normalizeData } from "./normalize";
import {
  fetchAdminOverview,
  fetchPublishedMenu,
  isSupabaseStoreConfigured,
  placeOrder,
  probeSupabaseStore,
  savePublishedMenu,
  updateOrderStatus,
  type PlaceOrderInput,
} from "./supabase-store";
import { isStoreOpenBySchedule } from "./schedule";
import { isValidOrderType, sanitizeText } from "./validation";
import type { AdminOverview, MenuData, OrderStatus, SavedOrder } from "./types";

/**
 * طبقة الباك إند لحفظ بيانات المتجر والكتالوج والطلبات.
 *
 * السائق الأساسي هو Supabase (Postgres) — هو اللي بيشتغل على Vercel وبيحفظ
 * البيانات بشكل دائم. ولو Supabase غير مُعدّ (تطوير محلي من غير مفاتيح) بيتم
 * استخدام ملف JSON محلي، وتظهر الحالة في لوحة التحكم.
 */

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

export interface StorageStatus {
  driver: "supabase" | "file";
  /** هل البيانات محفوظة بشكل دائم (Supabase) ولا في ملف مؤقت (تطوير محلي) */
  persistent: boolean;
  /** Supabase مُعدّ لكن الجداول لسه مش جاهزة */
  needsSchema: boolean;
}

const DATABASE_PATH = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "store.json");
const DRIVER_TTL = 60_000;
let driverCache: { status: StorageStatus; at: number } | null = null;

async function storageStatus(force = false): Promise<StorageStatus> {
  if (!force && driverCache && Date.now() - driverCache.at < DRIVER_TTL) return driverCache.status;

  let status: StorageStatus = { driver: "file", persistent: false, needsSchema: false };
  if (isSupabaseStoreConfigured()) {
    status = (await probeSupabaseStore())
      ? { driver: "supabase", persistent: true, needsSchema: false }
      : { driver: "file", persistent: false, needsSchema: true };
    if (status.needsSchema) {
      console.error(
        "[store] جداول Supabase غير جاهزة — نفّذ supabase/schema.sql في SQL Editor عشان الحفظ يبقى دائم.",
      );
    }
  }
  driverCache = { status, at: Date.now() };
  return status;
}

/* ------------------------------------------------------------------ */
/* ملف التطوير المحلي                                                  */
/* ------------------------------------------------------------------ */

interface FileDatabase {
  menu: MenuData;
  orders: SavedOrder[];
}

const freshDatabase = (): FileDatabase => ({
  menu: normalizeData(structuredClone(DEFAULT_DATA)),
  orders: [],
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
  };
}

async function writeFileDatabase(database: FileDatabase) {
  await fs.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
  const temporary = `${DATABASE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(database, null, 2), "utf8");
  await fs.rename(temporary, DATABASE_PATH);
}

/* ------------------------------------------------------------------ */
/* حساب الإجمالي على السيرفر (مكافحة التلاعب)                         */
/* ------------------------------------------------------------------ */

function computeServerTotal(
  lines: { price: number; quantity: number }[],
  commerce: MenuData["commerce"],
  orderType: string,
  zoneFee?: number | null,
): number {
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const isDelivery = orderType === "delivery";
  const qualifiesFree =
    isDelivery && commerce.freeDeliveryOver > 0 && subtotal >= commerce.freeDeliveryOver;
  const baseFee = typeof zoneFee === "number" && zoneFee >= 0 ? zoneFee : commerce.deliveryFee;
  const delivery = isDelivery && !qualifiesFree ? Math.max(0, baseFee) : 0;
  const service =
    commerce.serviceChargePercent > 0
      ? Math.round(((subtotal + delivery) * commerce.serviceChargePercent) / 100)
      : 0;
  return subtotal + delivery + service;
}

const ORDER_STATUSES: OrderStatus[] = ["new", "confirmed", "delivered", "cancelled"];

function isValidStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* الواجهة الموحّدة                                                    */
/* ------------------------------------------------------------------ */

export async function getMenu(token: string | null = null): Promise<MenuData> {
  const status = await storageStatus();
  if (status.driver === "supabase") {
    const result = await fetchPublishedMenu();
    if (result.ok && result.data) return result.data;
    if (result.code === "EMPTY") {
      // أول تشغيل: بيانات البداية بتتحفظ في قاعدة البيانات بأول جلسة أدمن
      const seed = normalizeData(structuredClone(DEFAULT_DATA));
      if (token) {
        const saved = await savePublishedMenu(seed, token);
        if (saved.ok && saved.data) return saved.data;
      }
      return seed;
    }
    throw new StoreError("تعذّر قراءة الكتالوج", result.status === 404 ? 404 : 502);
  }
  return (await readFileDatabase()).menu;
}

export async function replaceMenu(menu: MenuData, token: string | null): Promise<MenuData> {
  const status = await storageStatus();
  // حماية من حمولة كبيرة (DoS عبر JSON ضخم أو صور dataURL كبيرة)
  const size = JSON.stringify(menu).length;
  if (size > 4_000_000) throw new StoreError("البيانات كبيرة جداً (الحد 4MB)", 413);
  const normalized = normalizeData({ ...menu, updatedAt: new Date().toISOString() });

  if (status.driver === "supabase") {
    if (!token) throw new StoreError("غير مصرّح", 401);
    const result = await savePublishedMenu(normalized, token);
    if (!result.ok) throw new StoreError("تعذّر حفظ الكتالوج", result.status || 502);
    return result.data ?? normalized;
  }

  return serialized(async () => {
    const database = await readFileDatabase();
    database.menu = normalized;
    await writeFileDatabase(database);
    return database.menu;
  });
}

export async function createOrder(input: PlaceOrderInput): Promise<{ order: SavedOrder }> {
  // تحقق أساسي من نوع الطلب
  if (!isValidOrderType(input.orderType)) throw new StoreError("نوع الطلب غير صالح", 400);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new StoreError("السلة فارغة", 400);
  if (input.lines.length > 50) throw new StoreError("عدد المنتجات كبير جداً (الحد 50)", 400);

  // تعقيم بيانات العميل
  const sanitizedInput: PlaceOrderInput = {
    ...input,
    customer: {
      name: sanitizeText(input.customer?.name ?? "", 100),
      phone: sanitizeText(input.customer?.phone ?? "", 30),
      address: sanitizeText(input.customer?.address ?? "", 500),
      notes: sanitizeText(input.customer?.notes ?? "", 500),
    },
    orderType: input.orderType,
    lines: input.lines.map((l) => {
      const rawQty = Math.floor(Number(l.quantity) || 0);
      if (rawQty < 1 || rawQty > 50) throw new StoreError("الكمية يجب أن تكون بين 1 و 50", 400);
      return {
        itemId: sanitizeText(l.itemId, 50),
        quantity: rawQty,
      };
    }),
    total: Number(input.total) || 0,
    zoneId: sanitizeText(input.zoneId ?? "", 60) || undefined,
    paymentMethod: sanitizeText(input.paymentMethod ?? "", 40) || undefined,
  };

  const status = await storageStatus();

  if (status.driver === "supabase") {
    // تحقق من مواعيد المحل + مناطق التوصيل + حساب الإجمالي من الكتالوج الحقيقي (مكافحة تلاعب)
    try {
      const menu = await getMenu();
      // المحل مقفل حسب الجدول الأوتوماتيكي؟ مفيش طلبات جديدة
      if (menu.contact.autoSchedule && !isStoreOpenBySchedule(menu.contact.weeklySchedule ?? [])) {
        throw new StoreError("المحل مقفل حالياً — مش ممكن تسجيل طلبات دلوقتي", 409);
      }
      if (sanitizedInput.orderType === "delivery" && menu.commerce.enableZones) {
        const zones = menu.commerce.deliveryZones ?? [];
        if (zones.length > 0) {
          const zone = zones.find((z) => z.id === sanitizedInput.zoneId);
          if (!zone) throw new StoreError("اختار منطقة التوصيل", 400);
        }
      }
      const linesWithPrice = sanitizedInput.lines.map((l) => {
        const item = menu.items.find((m) => m.id === l.itemId);
        return { price: item?.price ?? 0, quantity: l.quantity };
      });
      const zone = (menu.commerce.deliveryZones ?? []).find((z) => z.id === sanitizedInput.zoneId);
      const serverTotal = computeServerTotal(
        linesWithPrice,
        menu.commerce,
        sanitizedInput.orderType,
        zone?.fee,
      );
      // اسمح بفارق بسيط (تقريب) لكن ارفض التلاعب الكبير
      if (Math.abs(serverTotal - sanitizedInput.total) > 5 && sanitizedInput.total < serverTotal * 0.5) {
        console.warn(`[order] total mismatch client=${sanitizedInput.total} server=${serverTotal} - using server total`);
      }
      sanitizedInput.total = serverTotal;
    } catch (error) {
      if (error instanceof StoreError) throw error;
      // لو فشل الحساب، استمر لكن الـ DB سيعيد الحساب أيضاً
    }

    const result = await placeOrder(sanitizedInput);
    if (!result.ok || !result.data) throw new StoreError("تعذّر تسجيل الطلب", result.status || 400);
    return { order: result.data.order };
  }

  const order = await serialized(() => createOrderInFile(sanitizedInput));
  return { order };
}

/** تسجيل الطلب في ملف التطوير المحلي */
async function createOrderInFile(input: PlaceOrderInput) {
  const database = await readFileDatabase();
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new StoreError("السلة فارغة", 400);
  if (input.lines.length > 50) throw new StoreError("عدد المنتجات كبير جداً", 400);

  // الجدول الأوتوماتيكي بيتحقق على السيرفر حتى في وضع الملف
  if (database.menu.contact.autoSchedule && !isStoreOpenBySchedule(database.menu.contact.weeklySchedule ?? [])) {
    throw new StoreError("المحل مقفل حالياً — مش ممكن تسجيل طلبات دلوقتي", 409);
  }

  // منطقة التوصيل لازم تكون موجودة لو المناطق مفعّلة
  const zones = database.menu.commerce.deliveryZones ?? [];
  const zone =
    input.orderType === "delivery" && database.menu.commerce.enableZones && zones.length > 0
      ? zones.find((z) => z.id === input.zoneId)
      : undefined;
  if (input.orderType === "delivery" && database.menu.commerce.enableZones && zones.length > 0 && !zone) {
    throw new StoreError("اختار منطقة التوصيل", 400);
  }

  const orderLines: SavedOrder["lines"] = [];

  for (const line of input.lines) {
    const item = database.menu.items.find((candidate) => candidate.id === line.itemId);
    if (!item || !item.available) throw new StoreError("أحد المنتجات لم يعد متاحاً", 409);

    const rawQty = Math.floor(Number(line.quantity) || 0);
    if (rawQty < 1 || rawQty > 50) throw new StoreError(`الحد الأقصى 50 قطعة للمنتج: ${item.name}`, 400);
    const quantity = rawQty;
    orderLines.push({ itemId: item.id, name: item.name, quantity, unitPrice: item.price });
    item.salesCount = Math.max(0, item.salesCount ?? 0) + quantity;
  }

  // احسب الإجمالي على السيرفر - تجاهل total القادم من العميل
  const serverTotal = computeServerTotal(
    orderLines.map((l) => ({ price: l.unitPrice, quantity: l.quantity })),
    database.menu.commerce,
    input.orderType,
    zone?.fee,
  );

  const order: SavedOrder = {
    id: `ORD-${Date.now().toString(36).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    customer: {
      name: sanitizeText(input.customer?.name ?? "", 100),
      phone: sanitizeText(input.customer?.phone ?? "", 30),
      address: sanitizeText(input.customer?.address ?? "", 500),
      notes: sanitizeText(input.customer?.notes ?? "", 500),
    },
    orderType: input.orderType,
    lines: orderLines,
    total: serverTotal,
    status: "new",
    ...(zone ? { zoneName: zone.name } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
  };

  database.orders.push(order);
  // احتفظ بآخر 500 طلب فقط في وضع الملف (منع تضخم)
  if (database.orders.length > 500) database.orders = database.orders.slice(-500);
  database.menu.updatedAt = new Date().toISOString();
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

  const storage = await storageStatus();

  if (storage.driver === "supabase") {
    if (!token) throw new StoreError("غير مصرّح", 401);
    const result = await updateOrderStatus(id, status, token);
    if (!result.ok || !result.data?.order) {
      throw new StoreError("تعذّر تحديث حالة الطلب", result.status || 502);
    }
    return result.data.order;
  }

  return serialized(async () => {
    const database = await readFileDatabase();
    const order = database.orders.find((candidate) => candidate.id === id);
    if (!order) throw new StoreError("الطلب غير موجود", 404);
    order.status = status;
    order.statusUpdatedAt = new Date().toISOString();
    await writeFileDatabase(database);
    return order;
  });
}

export async function getAdminOverview(token: string | null): Promise<AdminOverview> {
  const status = await storageStatus();

  if (status.driver === "supabase") {
    if (!token) throw new StoreError("غير مصرّح", 401);
    const result = await fetchAdminOverview(token);
    if (!result.ok || !result.data) throw new StoreError("تعذّر قراءة بيانات اللوحة", result.status || 502);
    return result.data;
  }

  const database = await readFileDatabase();
  return {
    orders: database.orders.slice(-500).reverse(),
    storage: { driver: "file", persistent: false },
  };
}
