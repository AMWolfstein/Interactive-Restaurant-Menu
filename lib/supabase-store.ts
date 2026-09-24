import "server-only";

import {
  CATALOG_TABLE,
  ITEM_SALES_TABLE,
  CUSTOMER_LOYALTY_FUNCTION,
  CUSTOMER_ORDERS_FUNCTION,
  ORDERS_TABLE,
  PLACE_ORDER_FUNCTION,
  PUBLISHED_SLUG,
  SEARCH_CUSTOMERS_FUNCTION,
  UPDATE_ORDER_STATUS_FUNCTION,
} from "./supabase";
import { normalizeData } from "./normalize";
import type {
  AdminOverview,
  CartLine,
  CustomerRecord,
  MenuData,
  OrderType,
  SavedOrder,
} from "./types";

/**
 * مخزن البيانات السحابي — Supabase (Postgres) عن طريق REST API.
 *
 * بيستخدم مفتاح anon العام فقط:
 *   - قراءة الكتالوج: مسموحة للجميع (العملاء).
 *   - تعديل الكتالوج وقراءة الطلبات: بتوكن الأدمن (RLS لدور authenticated).
 *   - تسجيل الطلب: عن طريق دالة place_order في قاعدة البيانات.
 */

export const SUPABASE_URL = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
export const SUPABASE_ANON_KEY = () => (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

export function isSupabaseStoreConfigured(): boolean {
  return Boolean(SUPABASE_URL() && SUPABASE_ANON_KEY());
}

export interface RestResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
  code: string;
}

interface RestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  prefer?: string;
  apiKey?: string;
}

export async function rest<T>(path: string, options: RestOptions = {}): Promise<RestResult<T>> {
  const { method = "GET", body, token = null, prefer, apiKey } = options;
  const headers: Record<string, string> = {
    apikey: apiKey ?? SUPABASE_ANON_KEY(),
    authorization: `Bearer ${token ?? SUPABASE_ANON_KEY()}`,
    accept: "application/json",
  };
  if (prefer) headers.prefer = prefer;
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL()}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      code: "NETWORK",
      message: error instanceof Error ? error.message : "تعذّر الاتصال بقاعدة البيانات",
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const error = parsed as { message?: string; code?: string } | null;
    // لا تسرب تفاصيل داخلية للعميل - سجلها في السيرفر فقط
    const isNotReady = NOT_READY_CODES.has(error?.code ?? "");
    // `22023` هو الكود اللي بنرفعه عن قصد من دوال SQL برسايل عربية جاهزة
    // للعرض («المحل مقفل حالياً»، «أقل طلب ١٠٠ ج»…). أي كود تاني رسالته
    // بتبقى تفاصيل داخلية (أسماء أعمدة، قيود، كويري) — دي بتتسجّل في
    // السيرفر بس وبيوصل للعميل رد عام.
    const isIntentional = error?.code === "22023";
    const safeMessage = isNotReady
      ? "قاعدة البيانات غير جاهزة"
      : response.status >= 500
        ? "خطأ في الخادم - حاول مرة أخرى"
        : isIntentional && error?.message
          ? error.message
          : `تعذّر تنفيذ العملية (${response.status})`;
    if (!isIntentional && !isNotReady && response.status < 500 && error?.message) {
      console.error(`[supabase] ${path} rejected:`, error.code, error.message);
    }
    if (response.status >= 500 || isNotReady) {
      console.error(`[supabase] ${path} failed:`, error?.code, error?.message);
    }
    return {
      ok: false,
      status: response.status,
      data: null,
      code: error?.code ?? `HTTP_${response.status}`,
      message: safeMessage,
    };
  }

  return { ok: true, status: response.status, data: parsed as T, message: "", code: "" };
}

/** كود PostgREST لما الجدول/الدالة مش موجودة — معناه إن schema.sql لسه متنفذتش */
const NOT_READY_CODES = new Set(["PGRST205", "PGRST202", "42P01", "42883"]);

interface MenuRow {
  slug: string;
  data: MenuData | null;
  updated_at: string;
}

interface ItemSalesRow {
  item_id: string;
  sales_count: number;
}

/**
 * عدّادات المبيعات بقت في جدول `item_sales` مش جوه JSON الكتالوج.
 *
 * بترجع خريطة {itemId: العدد}. لو الجدول لسه مش موجود (الميجريشن متنفذتش)
 * بترجع null بدل ما ترمي خطأ — ساعتها بنستخدم الأرقام القديمة اللي في
 * الكتالوج نفسه، فالموقع بيشتغل عادي قبل وبعد الميجريشن.
 */
async function fetchItemSales(): Promise<Map<string, number> | null> {
  const result = await rest<ItemSalesRow[]>(`${ITEM_SALES_TABLE}?select=item_id,sales_count`);
  if (!result.ok) return null;
  const counts = new Map<string, number>();
  for (const row of result.data ?? []) {
    if (row?.item_id) counts.set(row.item_id, Math.max(0, Number(row.sales_count) || 0));
  }
  return counts;
}

export async function fetchPublishedMenu(): Promise<RestResult<MenuData>> {
  // النداءين مستقلين — بيتنفذوا مع بعض عشان ما نزوّدش زمن الاستجابة
  const [result, sales] = await Promise.all([
    rest<MenuRow[]>(`${CATALOG_TABLE}?slug=eq.${PUBLISHED_SLUG}&select=slug,data,updated_at&limit=1`),
    fetchItemSales(),
  ]);
  if (!result.ok) return { ok: false, status: result.status, data: null, message: result.message, code: result.code };
  const row = result.data?.[0];
  if (!row?.data) return { ok: false, status: 404, data: null, message: "الكتالوج غير محفوظ بعد", code: "EMPTY" };
  return { ok: true, status: 200, data: normalizeData(withItemSales(row.data, sales)), message: "", code: "" };
}

/** بيدمج أرقام `item_sales` جوه المنيو عشان باقي التطبيق ما يحسّش بالتغيير */
function withItemSales(menu: MenuData, sales: Map<string, number> | null): MenuData {
  if (!sales || !Array.isArray(menu.items)) return menu;
  return {
    ...menu,
    items: menu.items.map((item) =>
      sales.has(item.id) ? { ...item, salesCount: sales.get(item.id) } : item,
    ),
  };
}

/** فحص سريع: هل جداول قاعدة البيانات جاهزة؟ */
export async function probeSupabaseStore(): Promise<boolean> {
  if (!isSupabaseStoreConfigured()) return false;
  const result = await rest<Array<{ slug: string }>>(`${CATALOG_TABLE}?slug=eq.${PUBLISHED_SLUG}&select=slug&limit=1`);
  return result.ok || !NOT_READY_CODES.has(result.code);
}

export async function savePublishedMenu(menu: MenuData, token: string): Promise<RestResult<MenuData>> {
  const payload = { slug: PUBLISHED_SLUG, data: menu, updated_at: menu.updatedAt };
  const result = await rest<MenuRow[]>(CATALOG_TABLE, {
    method: "POST",
    body: payload,
    token,
    prefer: "resolution=merge-duplicates,return=representation",
  });
  if (!result.ok) return { ok: false, status: result.status, data: null, message: result.message, code: result.code };
  return { ok: true, status: 200, data: normalizeData(result.data?.[0]?.data ?? menu), message: "", code: "" };
}

export interface PlaceOrderInput {
  lines: CartLine[];
  customer: { name?: string; phone?: string; address?: string; notes?: string };
  orderType: OrderType;
  total: number;
  /** معرّف منطقة التوصيل المختارة (لو مناطق التوصيل مفعّلة) */
  zoneId?: string;
  /** طريقة الدفع المختارة (لو مفعّلة) */
  paymentMethod?: string;
}

interface PlaceOrderResult {
  order: SavedOrder;
}

export async function placeOrder(input: PlaceOrderInput): Promise<RestResult<PlaceOrderResult>> {
  return rest<PlaceOrderResult>(`rpc/${PLACE_ORDER_FUNCTION}`, {
    method: "POST",
    body: { payload: input },
  });
}

interface OrderRow {
  id: string;
  created_at: string;
  data: SavedOrder;
}

/**
 * أقصى عدد طلبات بيترجع في نداء واحد. الرقم ده سقف حماية مش هدف —
 * كل طلب جواه الـ JSON بتاعه كامل (الأصناف + بيانات العميل)، فـ500 طلب
 * ممكن يبقوا ميجابايتات على كل نداء، والنداء ده بيتكرر كل ٣٠ ثانية.
 */
const MAX_OVERVIEW_ORDERS = 500;
const DEFAULT_OVERVIEW_ORDERS = 200;

export async function fetchAdminOverview(
  token: string,
  limit = DEFAULT_OVERVIEW_ORDERS,
): Promise<RestResult<AdminOverview>> {
  const safeLimit = Math.min(MAX_OVERVIEW_ORDERS, Math.max(1, Math.floor(limit) || DEFAULT_OVERVIEW_ORDERS));
  const orders = await rest<OrderRow[]>(
    `${ORDERS_TABLE}?select=id,created_at,data&order=created_at.desc&limit=${safeLimit}`,
    { token },
  );
  if (!orders.ok) return { ok: false, status: orders.status, data: null, message: orders.message, code: orders.code };

  return {
    ok: true,
    status: 200,
    code: "",
    message: "",
    data: {
      orders: (orders.data ?? []).map((row) => row.data),
      storage: { driver: "supabase", persistent: true },
    },
  };
}

/** تحديث حالة طلب — دالة update_order_status في قاعدة البيانات (أدمن فقط) */
export async function updateOrderStatus(
  orderId: string,
  status: string,
  token: string,
): Promise<RestResult<{ order: SavedOrder }>> {
  return rest<{ order: SavedOrder }>(`rpc/${UPDATE_ORDER_STATUS_FUNCTION}`, {
    method: "POST",
    body: { p_order_id: orderId, p_status: status },
    token,
  });
}

/* ------------------------------------------------------------------ */
/* نظام «كاشك» — العملاء والأرصدة                                     */
/* ------------------------------------------------------------------ */

/** الشكل اللي بترجّعه دالة customer_loyalty في قاعدة البيانات */
export interface LoyaltyLookup {
  enabled: boolean;
  balance: number;
  threshold?: number;
  percent?: number;
  eligible?: boolean;
  remaining?: number;
}

/**
 * رصيد كاشك لعميل — بيتنادى بمفتاح anon (العميل نفسه في السلة).
 * الدالة في قاعدة البيانات بترجّع أرقام الرصيد بس، من غير الاسم أو العنوان
 * أو تاريخ الطلبات، عشان معرفة رقم موبايل متبقاش تسريب لبيانات صاحبه.
 */
export async function fetchCustomerLoyalty(phone: string): Promise<RestResult<LoyaltyLookup>> {
  return rest<LoyaltyLookup>(`rpc/${CUSTOMER_LOYALTY_FUNCTION}`, {
    method: "POST",
    body: { p_phone: phone },
  });
}

interface CustomerRow {
  phone: string;
  name: string;
  spent: number | string;
  lifetime: number | string;
  orders_count: number;
  rewards_used: number;
  discount_total: number | string;
  created_at: string;
  updated_at: string;
}

const toCustomer = (row: CustomerRow): CustomerRecord => ({
  phone: row.phone,
  name: row.name ?? "",
  // Postgres numeric بيرجع كنص في JSON — لازم تحويل صريح
  spent: Number(row.spent) || 0,
  lifetime: Number(row.lifetime) || 0,
  ordersCount: Number(row.orders_count) || 0,
  rewardsUsed: Number(row.rewards_used) || 0,
  discountTotal: Number(row.discount_total) || 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** بحث العملاء — بيتم على السيرفر فمش مقيّد بآخر ٥٠٠ طلب زي البحث القديم */
export async function searchCustomers(
  query: string,
  limit: number,
  token: string,
): Promise<RestResult<CustomerRecord[]>> {
  const result = await rest<CustomerRow[]>(`rpc/${SEARCH_CUSTOMERS_FUNCTION}`, {
    method: "POST",
    body: { p_query: query, p_limit: limit },
    token,
  });
  if (!result.ok) return { ...result, data: null };
  return { ...result, data: (result.data ?? []).map(toCustomer) };
}

/** كل طلبات عميل واحد بالموبايل — مش محدودة بصفحة الطلبات الأخيرة */
export async function fetchCustomerOrders(
  phone: string,
  limit: number,
  token: string,
): Promise<RestResult<SavedOrder[]>> {
  const result = await rest<OrderRow[]>(`rpc/${CUSTOMER_ORDERS_FUNCTION}`, {
    method: "POST",
    body: { p_phone: phone, p_limit: limit },
    token,
  });
  if (!result.ok) return { ...result, data: null };
  return { ...result, data: (result.data ?? []).map((row) => row.data) };
}
