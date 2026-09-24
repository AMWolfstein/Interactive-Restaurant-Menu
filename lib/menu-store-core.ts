import { DEFAULT_DATA } from "./defaults";
import { isLegacyMenyuBackup, normalizeData } from "./normalize";
import { subscribeRealtime } from "./realtime";
import { CATALOG_TABLE, PUBLISHED_SLUG } from "./supabase";
import { authenticatedFetch } from "./supabase-auth-core";
import { validateImportedMenu } from "./validation";
import type { Category, MenuData, MenuItem, Supplier } from "./types";

export type SaveState = "idle" | "dirty" | "saved" | "error";

export interface MenuState {
  data: MenuData;
  ready: boolean;
  isCustomized: boolean;
  saveState: SaveState;
  /** رسالة الخطأ القادمة من الباك إند عند فشل الحفظ */
  saveError: string | null;
  storageKb: number;
}

export const MENU_SERVER_STATE: MenuState = {
  data: DEFAULT_DATA,
  ready: false,
  isCustomized: false,
  saveState: "idle",
  saveError: null,
  storageKb: 0,
};

let state = MENU_SERVER_STATE;
const listeners = new Set<() => void>();
let initialized = false;
let persistTimer: number | undefined;
let resetTimer: number | undefined;
let persistRevision = 0;
let persistQueue: Promise<void> = Promise.resolve();

function emit() {
  for (const listener of [...listeners]) listener();
}
function set(patch: Partial<MenuState>) {
  state = { ...state, ...patch };
  emit();
}
/**
 * حجم الكتالوج بالكيلوبايت — عدّاد بيتعرض في تبويب «البيانات» بس.
 *
 * `new Blob([...])` كانت بتعمل نسخة تانية كاملة من الـ JSON في الذاكرة عشان
 * رقم تقريبي. TextEncoder بيعدّ البايتات من غير ما يبني Blob، وبيدّي نفس
 * النتيجة بالظبط لأن الاتنين UTF-8.
 */
const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const sizeOf = (data: MenuData) => {
  const json = JSON.stringify(data);
  const bytes = encoder ? encoder.encode(json).length : json.length;
  return Math.round(bytes / 1024);
};
const clone = (value: MenuData): MenuData => structuredClone(value);
const newId = () => crypto.randomUUID().slice(0, 8);

async function errorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload?.error ?? null;
  } catch {
    return null;
  }
}

/** قراءة الكتالوج من الباك إند */
export async function refreshMenu() {
  try {
    const response = await authenticatedFetch("/api/menu", { cache: "no-store" });
    if (!response.ok) throw new Error((await errorMessage(response)) ?? "تعذّر قراءة الكتالوج من الباك إند");
    const data = normalizeData(await response.json());
    // A refresh can finish after the admin has started editing. Never replace
    // unsaved local changes with a stale response that was already in flight.
    if (state.saveState === "dirty") return;
    set({ data, ready: true, isCustomized: true, storageKb: sizeOf(data), saveState: "idle", saveError: null });
  } catch (error) {
    // لا نستبدل لقطة السيرفر الصحيحة ببيانات الـ seed عند انقطاع الشبكة.
    // إبقاء ready=false يجعل useMenu يعرض initialData التي جاءت مع الصفحة؛
    // وكان الاستبدال بـ DEFAULT_DATA هو سبب ظهور البراند القديم بشكل متقطع.
    set({
      saveState: "error",
      saveError: error instanceof Error && error.message ? error.message : "تعذّر الاتصال بالباك إند",
    });
  }
}

/**
 * تحديث لحظي من قاعدة البيانات.
 * بيتجاهل أي تغيير أثناء تعديل الأدمن المحلي (saveState = dirty) عشان
 * تعديلات الأدمن ما تتمسحش برسالة قادمة من السيرفر — بتتطبق بعد ما يخلص الحفظ.
 */
function refreshFromRemote() {
  if (state.saveState === "dirty") return;
  void refreshMenu();
}

/** فترة آخر حفظ محلي (ms) — بنطنش صدى الحفظ بتاعنا الجاي من الـ Realtime */
let lastLocalWriteAt = 0;
/** مدة تجاهل صدى الكتابة المحلية */
const SELF_ECHO_GUARD_MS = 4000;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  void refreshMenu();
  window.addEventListener("focus", refreshFromRemote);

  // تحديث لحظي فوري: أي تعديل من الأدمن يوصل لكل الأجهزة
  subscribeRealtime(
    "realtime:menu",
    [{ table: CATALOG_TABLE, event: "UPDATE", filter: `slug=eq.${PUBLISHED_SLUG}` }],
    () => {
      if (Date.now() - lastLocalWriteAt < SELF_ECHO_GUARD_MS) return;
      refreshFromRemote();
    },
  );

  // شبكة أمان لو الـ Realtime مش متاح (جداول مش مضافة للـ publication).
  // بيقف لما التاب يكون مخفي: من غير كده أي تاب سايبه المستخدم مفتوح بيفضل
  // بيجيب الكتالوج كامل كل دقيقة للأبد.
  const tick = () => {
    if (!document.hidden) refreshFromRemote();
  };
  window.setInterval(tick, 60_000);
  // أول ما التاب يرجع يبان، حدّث حالاً بدل ما تستنى الدورة الجاية
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshFromRemote();
  });
}

export function subscribeMenu(listener: () => void) {
  listeners.add(listener);
  ensureInit();
  return () => listeners.delete(listener);
}
export function getMenuSnapshot() {
  return state;
}

/** حفظ التعديل في الباك إند (PUT /api/menu بتوكن الأدمن) */
function schedulePersist(value: MenuData) {
  if (typeof window === "undefined") return;
  lastLocalWriteAt = Date.now();
  const revision = ++persistRevision;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    // Keep writes ordered. Without this queue, two slow requests can finish in
    // reverse order and an older menu snapshot can overwrite the latest edit.
    persistQueue = persistQueue.then(async () => {
      try {
        const response = await authenticatedFetch("/api/menu", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        });
        if (!response.ok) throw new Error((await errorMessage(response)) ?? "تعذّر حفظ التعديلات");
        const data = normalizeData(await response.json());
        // A newer edit may have been made while this request was running. Its
        // local snapshot must remain visible until the newer save completes.
        if (revision !== persistRevision) return;
        set({ data, saveState: "saved", saveError: null, isCustomized: true, storageKb: sizeOf(data) });
      } catch (error) {
        if (revision !== persistRevision) return;
        set({
          saveState: "error",
          saveError: error instanceof Error && error.message ? error.message : "تعذّر حفظ التعديلات",
        });
      }
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        if (state.saveState === "saved" && revision === persistRevision) set({ saveState: "idle" });
      }, 1500);
    });
  }, 220);
}

function commit(next: MenuData) {
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  set({ data: stamped, saveState: "dirty" });
  schedulePersist(stamped);
}

export function updateMenu(recipe: (draft: MenuData) => void) {
  const draft = clone(state.data);
  recipe(draft);
  commit(draft);
}

const patchSection =
  <K extends "brand" | "contact" | "commerce">(key: K) =>
  (patch: Partial<MenuData[K]>) =>
    updateMenu((draft) => {
      Object.assign(draft[key], patch);
    });

export const patchBrand = patchSection("brand");
export const patchContact = patchSection("contact");
export const patchCommerce = patchSection("commerce");

export function addCategory(input: Omit<Category, "id">) {
  updateMenu((d) => d.categories.push({ ...input, id: `c_${newId()}` }));
}
export function updateCategory(id: string, patch: Partial<Category>) {
  updateMenu((d) => {
    const row = d.categories.find((x) => x.id === id);
    if (row) Object.assign(row, patch);
  });
}
export function deleteCategory(id: string) {
  updateMenu((d) => {
    if (d.categories.length <= 1) return;
    const i = d.categories.findIndex((x) => x.id === id);
    if (i < 0) return;
    d.categories.splice(i, 1);
    d.items.forEach((x) => {
      if (x.categoryId === id) x.categoryId = d.categories[0].id;
    });
  });
}
export function moveCategory(id: string, dir: -1 | 1) {
  updateMenu((d) => {
    const i = d.categories.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i >= 0 && j >= 0 && j < d.categories.length) [d.categories[i], d.categories[j]] = [d.categories[j], d.categories[i]];
  });
}
export function addSupplier(input: Omit<Supplier, "id">) {
  const id = `s_${newId()}`;
  updateMenu((d) => d.suppliers.push({ ...input, id }));
  return id;
}
export function updateSupplier(id: string, patch: Partial<Supplier>) {
  updateMenu((d) => {
    const row = d.suppliers.find((supplier) => supplier.id === id);
    if (!row) return;
    const previousName = row.name;
    Object.assign(row, patch);
    if (patch.name !== undefined && patch.name !== previousName) {
      d.items.forEach((item) => {
        if (item.supplier === previousName) item.supplier = patch.name ?? "";
      });
    }
  });
}
export function deleteSupplier(id: string) {
  updateMenu((d) => {
    const row = d.suppliers.find((supplier) => supplier.id === id);
    if (!row) return;
    d.suppliers = d.suppliers.filter((supplier) => supplier.id !== id);
    // المنتجات لا تفضلش مربوطة باسم مورد اتحذف.
    d.items.forEach((item) => {
      if (item.supplier === row.name) item.supplier = "";
    });
  });
}

export function addItem(input: Omit<MenuItem, "id">) {
  const id = `i_${newId()}`;
  updateMenu((d) => d.items.push({ ...input, id, createdAt: input.createdAt ?? new Date().toISOString() }));
  return id;
}
export function updateItem(id: string, patch: Partial<MenuItem>) {
  updateMenu((d) => {
    const row = d.items.find((x) => x.id === id);
    if (row) Object.assign(row, patch);
  });
}
export function deleteItem(id: string) {
  updateMenu((d) => {
    d.items = d.items.filter((x) => x.id !== id);
  });
}
export function duplicateItem(id: string) {
  updateMenu((d) => {
    const row = d.items.find((x) => x.id === id);
    if (!row) return;
    d.items.push({ ...row, id: `i_${newId()}`, name: `${row.name} (نسخة)`, salesCount: 0, createdAt: new Date().toISOString() });
  });
}
export function setCategoryAvailability(categoryId: string, available: boolean) {
  updateMenu((d) =>
    d.items.forEach((x) => {
      if (x.categoryId === categoryId) x.available = available;
    }),
  );
}

/** نسخة احتياطية من البيانات المحفوظة في الباك إند */
export function exportJson() {
  return JSON.stringify(state.data, null, 2);
}

/** استيراد نسخة احتياطية — يقبل أيضاً Backup مشروع Menyu القديم ويحوله قبل التحقق والحفظ. */
export function importJson(text: string) {
  try {
    if (text.length > 5_000_000) return { ok: false as const, error: "حجم الملف كبير جداً (الحد 5MB)" };
    const parsed = JSON.parse(text);
    const legacy = isLegacyMenyuBackup(parsed);
    // نطبع الملف أولاً حتى تتطبق قواعد تحويل Firebase القديمة قبل تحقق الشكل الجديد.
    const normalized = normalizeData(parsed);
    const validation = validateImportedMenu(normalized);
    if (!validation.ok) return { ok: false as const, error: validation.error };
    commit(normalized);
    return { ok: true as const, legacy };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "ملف غير صالح" };
  }
}

export function resetToDefaults() {
  commit(clone(DEFAULT_DATA));
}
