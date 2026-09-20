import { CART_KEY } from "./defaults";
import type { CartLine } from "./types";

/** سلة الطلبات: مصدر الحقيقة localStorage، والقراءة عن طريق useSyncExternalStore */
export const CART_SERVER_SNAPSHOT: CartLine[] = [];

let snapshot: CartLine[] = CART_SERVER_SNAPSHOT;
let initialized = false;
const listeners = new Set<() => void>();

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
    const quantities = new Map<string, number>();
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const { itemId, quantity } = value as Partial<CartLine>;
      if (typeof itemId !== "string" || !itemId || itemId.length > 50) continue;
      const normalizedQuantity = Math.floor(Number(quantity));
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 1) continue;
      quantities.set(itemId, Math.min(50, (quantities.get(itemId) ?? 0) + normalizedQuantity));
    }
    return [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }));
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
  const existing = snapshot.find((line) => line.itemId === itemId && line.variantId === variantId);
  if (existing?.quantity === 50) return;
  write(
    existing
      ? snapshot.map((line) => (line.itemId === itemId ? { ...line, quantity: Math.min(50, line.quantity + 1) } : line))
      : [...snapshot, { itemId, quantity: 1 }],
  );
}

export function setCartQuantity(itemId: string, quantity: number) {
  const normalized = Math.floor(Number(quantity));
  if (!Number.isFinite(normalized) || normalized <= 0) return removeFromCart(itemId);
  write(snapshot.map((line) => (line.itemId === itemId ? { ...line, quantity: Math.min(50, normalized) } : line)));
}

export function removeFromCart(itemId: string) {
  write(snapshot.filter((line) => line.itemId !== itemId));
}

export function replaceCart(lines: CartLine[]) {
  const normalized = lines
    .filter((line) => typeof line.itemId === "string" && Number.isFinite(line.quantity) && line.quantity > 0)
    .map((line) => ({ itemId: line.itemId, quantity: Math.min(50, Math.floor(line.quantity)) }));
  write(normalized);
}

export function clearCart() {
  write([]);
}
