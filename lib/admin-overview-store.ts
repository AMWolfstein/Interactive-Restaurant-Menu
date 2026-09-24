"use client";

import { authenticatedFetch } from "./supabase-auth-core";
import { subscribeRealtime } from "./realtime";
import { ORDERS_TABLE } from "./supabase";
import type { AdminOverview, SavedOrder } from "./types";

/**
 * مصدر واحد لبيانات `/api/admin/overview`.
 *
 * قبل كده كان فيه **تلات لوبات منفصلة** بتضرب نفس النقطة:
 *   - تبويب اللوحة      كل ٣٠ ثانية
 *   - تبويب الطلبات     كل ٣٠ ثانية
 *   - تنبيهات الأدمن    كل ٦٠ ثانية
 * وكل واحد منهم له اشتراك Realtime لوحده. يعني أدمن فاتح تبويب الطلبات كان
 * بيولّد ٣ نداءات متداخلة لنفس البيانات، وكل نداء بيرجّع الطلبات بالـ JSON
 * بتاعها كامل.
 *
 * الستور ده بيوحّدهم: اشتراك Realtime واحد، مؤقّت واحد، وطلب شبكة واحد
 * بيتشارك فيه كل المشتركين. الكمبوننتات بتقرا منه بـ`useSyncExternalStore`.
 */

export interface AdminOverviewState {
  orders: SavedOrder[];
  storage: AdminOverview["storage"];
  error: string | null;
  /** لسه بيحمّل أول مرة (مش بيتحط تاني في التحديثات اللاحقة) */
  loading: boolean;
  /** وقت آخر تحميل ناجح — 0 يعني لسه ما حصلش */
  loadedAt: number;
}

const EMPTY_STORAGE: AdminOverview["storage"] = { driver: "file", persistent: false };

/** لقطة ثابتة للسيرفر — لازم تكون نفس المرجع في كل نداء */
export const ADMIN_OVERVIEW_SERVER_SNAPSHOT: AdminOverviewState = {
  orders: [],
  storage: EMPTY_STORAGE,
  error: null,
  loading: true,
  loadedAt: 0,
};

let state: AdminOverviewState = ADMIN_OVERVIEW_SERVER_SNAPSHOT;

const listeners = new Set<() => void>();
/** بيتنادوا عند كل تحديث ناجح — تنبيهات الطلبات الجديدة بتستخدمه */
const refreshListeners = new Set<(orders: SavedOrder[]) => void>();

/** الفحص الدوري: شبكة أمان لو الـ Realtime انقطع */
const POLL_MS = 30_000;
/**
 * أقل مدة بين نداءين فعليين. من غيرها موجة Realtime (٥ طلبات في ثانية)
 * كانت هتولّد ٥ نداءات كاملة ورا بعض.
 */
const MIN_GAP_MS = 2_000;

let initialized = false;
let pollTimer: number | undefined;
let unsubscribeRealtime: (() => void) | null = null;
/** الطلب الجاري — أي نداء تاني في نفس اللحظة بيستنى نفس الوعد */
let inFlight: Promise<void> | null = null;
let pendingTimer: number | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

function set(patch: Partial<AdminOverviewState>): void {
  state = { ...state, ...patch };
  emit();
}

async function fetchOverview(): Promise<void> {
  try {
    const response = await authenticatedFetch("/api/admin/overview", { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      set({ error: payload?.error ?? "تعذّر قراءة بيانات اللوحة", loading: false });
      return;
    }
    const result = (await response.json()) as AdminOverview;
    const orders = result.orders ?? [];
    set({
      orders,
      storage: result.storage ?? EMPTY_STORAGE,
      error: null,
      loading: false,
      loadedAt: Date.now(),
    });
    for (const listener of refreshListeners) listener(orders);
  } catch {
    set({ error: "تعذّر الاتصال بالباك إند", loading: false });
  }
}

/**
 * تحديث البيانات.
 *
 * بيدمج النداءات المتزامنة في طلب واحد، وبيأجّل النداء لو لسه فيه واحد
 * خلص من أقل من `MIN_GAP_MS` (إلا لو `force`).
 */
export function refreshAdminOverview(force = false): Promise<void> {
  if (inFlight) return inFlight;

  const since = Date.now() - state.loadedAt;
  if (!force && state.loadedAt > 0 && since < MIN_GAP_MS) {
    // بدل ما نرمي التحديث، نجدوله بعد ما المهلة تعدي — آخر حدث بيكسب
    if (pendingTimer === undefined && typeof window !== "undefined") {
      pendingTimer = window.setTimeout(() => {
        pendingTimer = undefined;
        void refreshAdminOverview(true);
      }, MIN_GAP_MS - since);
    }
    return Promise.resolve();
  }

  inFlight = fetchOverview().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function startPolling(): void {
  if (pollTimer !== undefined || typeof window === "undefined") return;
  pollTimer = window.setInterval(() => {
    if (!document.hidden) void refreshAdminOverview();
  }, POLL_MS);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function onVisibilityChange(): void {
  if (document.hidden) {
    stopPolling();
  } else {
    // التاب رجع: حدّث حالاً بدل ما تستنى دورة كاملة
    void refreshAdminOverview();
    startPolling();
  }
}

function ensureInit(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // اشتراك Realtime واحد لكل اللوحة بدل تلاتة
  unsubscribeRealtime = subscribeRealtime(
    "realtime:admin-overview",
    [
      { table: ORDERS_TABLE, event: "INSERT" },
      { table: ORDERS_TABLE, event: "UPDATE" },
    ],
    () => void refreshAdminOverview(),
  );

  document.addEventListener("visibilitychange", onVisibilityChange);
  if (!document.hidden) startPolling();
  void refreshAdminOverview(true);
}

function teardown(): void {
  if (!initialized) return;
  initialized = false;
  stopPolling();
  if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
}

/** اشتراك على حالة اللوحة (للاستخدام مع useSyncExternalStore) */
export function subscribeAdminOverview(listener: () => void): () => void {
  listeners.add(listener);
  ensureInit();
  return () => {
    listeners.delete(listener);
    // آخر مشترك خرج → وقّف المؤقّت والـRealtime بدل ما يفضلوا شغالين
    if (listeners.size === 0 && refreshListeners.size === 0) teardown();
  };
}

/** اشتراك على «وصلت بيانات جديدة» — للتنبيهات بالصوت */
export function subscribeOverviewRefresh(listener: (orders: SavedOrder[]) => void): () => void {
  refreshListeners.add(listener);
  ensureInit();
  return () => {
    refreshListeners.delete(listener);
    if (listeners.size === 0 && refreshListeners.size === 0) teardown();
  };
}

export function getAdminOverviewSnapshot(): AdminOverviewState {
  return state;
}

export function getAdminOverviewServerSnapshot(): AdminOverviewState {
  return ADMIN_OVERVIEW_SERVER_SNAPSHOT;
}

/**
 * تحديث تفاؤلي لطلب واحد بعد تغيير حالته.
 *
 * بيستبدل الطلب في اللقطة المشتركة فوراً عشان الواجهة ترد بسرعة من غير ما
 * تستنى نداء شبكة كامل — وكل المشتركين (اللوحة والطلبات) بيشوفوا التغيير
 * في نفس اللحظة. الـRealtime هيأكّد نفس التغيير بعدها.
 */
export function applyOrderUpdate(order: SavedOrder): void {
  const index = state.orders.findIndex((candidate) => candidate.id === order.id);
  if (index === -1) return;
  const orders = [...state.orders];
  orders[index] = order;
  set({ orders });
}

/** للاختبارات — بيرجّع الستور لحالته الأولى */
export function resetAdminOverviewStore(): void {
  teardown();
  listeners.clear();
  refreshListeners.clear();
  inFlight = null;
  state = ADMIN_OVERVIEW_SERVER_SNAPSHOT;
}
