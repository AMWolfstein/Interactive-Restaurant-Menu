import { CART_KEY } from "./defaults";
import type { CartLine } from "./types";

/** سلة الطلبات: مصدر الحقيقة localStorage، والقراءة عن طريق useSyncExternalStore */
export const CART_SERVER_SNAPSHOT: CartLine[] = [];

let snapshot: CartLine[] = CART_SERVER_SNAPSHOT;
let initialized = false;
const listeners = new Set<() => void>();

/** مفتاح فريد لكل سطر: المنتج + الاختيار (variant) لو موجود */
function lineKey(itemId: string, variantId?: string): string {
  return variantId ? `${itemId}::${variantId}` : itemId;
}

function sameLine(line: CartLine, itemId: string, variantId?: string): boolean {
  return line.itemId === itemId && line.variantId === variantId;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function read(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return CART_SERVER_SNAPSHOT;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    // localStorage is user-controlled and can also contain data written by an
    // older app version. Normalize it before exposing it to the UI.
    const quantities = new Map<string, CartLine>();
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const { itemId, variantId, quantity } = value as Partial<CartLine>;
      if (typeof itemId !== "string" || !itemId || itemId.length > 50) continue;
      const normalizedVariantId =
        typeof variantId === "string" && variantId && variantId.length <= 50 ? variantId : undefined;
      const normalizedQuantity = Math.floor(Number(quantity));
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 1) continue;
      const key = lineKey(itemId, normalizedVariantId);
      const existing = quantities.get(key);
      const nextQuantity = Math.min(50, (existing?.quantity ?? 0) + normalizedQuantity);
      quantities.set(key, { itemId, ...(normalizedVariantId ? { variantId: normalizedVariantId } : {}), quantity: nextQuantity });
    }
    return [...quantities.values()];
  } catch {
    return CART_SERVER_SNAPSHOT;
  }
}

function write(next: CartLine[]) {
  snapshot = next;
  try {
    if (next.length) window.localStorage.setItem(CART_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(CART_KEY);
  } catch {
    /* التخزين ممتلئ — السلة تفضل شغالة في الذاكرة */
  }
  emit();
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  snapshot = read();
  window.addEventListener("storage", (event) => {
    if (event.key === CART_KEY) {
      snapshot = read();
      emit();
    }
  });
}

export function subscribeCart(listener: () => void) {
  listeners.add(listener);
  ensureInit();
  return () => {
    listeners.delete(listener);
  };
}

export function getCartSnapshot(): CartLine[] {
  return snapshot;
}

export function addToCart(itemId: string, variantId?: string) {
  const existing = snapshot.find((line) => sameLine(line, itemId, variantId));
  if (existing?.quantity === 50) return;
  write(
    existing
      ? snapshot.map((line) => (sameLine(line, itemId, variantId) ? { ...line, quantity: Math.min(50, line.quantity + 1) } : line))
      : [...snapshot, { itemId, ...(variantId ? { variantId } : {}), quantity: 1 }],
  );
}

export function setCartQuantity(itemId: string, quantity: number, variantId?: string) {
  const normalized = Math.floor(Number(quantity));
  if (!Number.isFinite(normalized) || normalized <= 0) return removeFromCart(itemId, variantId);
  write(snapshot.map((line) => (sameLine(line, itemId, variantId) ? { ...line, quantity: Math.min(50, normalized) } : line)));
}

export function removeFromCart(itemId: string, variantId?: string) {
  write(snapshot.filter((line) => !sameLine(line, itemId, variantId)));
}

export function replaceCart(lines: CartLine[]) {
  const normalized = lines
    .filter((line) => typeof line.itemId === "string" && Number.isFinite(line.quantity) && line.quantity > 0)
    .map((line) => ({
      itemId: line.itemId,
      ...(typeof line.variantId === "string" && line.variantId ? { variantId: line.variantId } : {}),
      quantity: Math.min(50, Math.floor(line.quantity)),
    }));
  write(normalized);
}

export function clearCart() {
  write([]);
}
