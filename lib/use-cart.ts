"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  CART_SERVER_SNAPSHOT,
  addToCart,
  clearCart,
  getCartSnapshot,
  removeFromCart,
  replaceCart,
  setCartQuantity,
  subscribeCart,
} from "./cart-store-core";
import type { CartLine, MenuItem } from "./types";

export interface DetailedLine {
  line: CartLine;
  item: MenuItem;
}

/** سلة العميل — بتتحفظ في المتصفح فمتضيعش لو الصفحة اتقفلت */
export function useCart(menuItems: MenuItem[]) {
  const lines = useSyncExternalStore(subscribeCart, getCartSnapshot, () => CART_SERVER_SNAPSHOT);

  const detailed = useMemo(
    () =>
      lines
        .map((line) => {
          const base = menuItems.find((candidate) => candidate.id === line.itemId);
          if (!base) return null;
          const variant = line.variantId ? base.variants?.find((candidate) => candidate.id === line.variantId) : undefined;
          const item = variant ? { ...base, price: variant.price, oldPrice: variant.oldPrice, weight: variant.label } : base;
          return { line, item };
        })
        .filter((value): value is DetailedLine => value !== null),
    [lines, menuItems],
  );

  const add = useCallback((id: string, variantId?: string) => addToCart(id, variantId), []);
  const setQuantity = useCallback((id: string, quantity: number, variantId?: string) => {
    setCartQuantity(variantId ? `${id}::${variantId}` : id, quantity);
  }, []);
  const remove = useCallback((id: string, variantId?: string) => removeFromCart(variantId ? `${id}::${variantId}` : id), []);
  const clear = useCallback(() => clearCart(), []);
  const restore = useCallback((previous: CartLine[]) => replaceCart(previous), []);
  const quantityOf = useCallback(
    (id: string, variantId?: string) => lines.find((line) => line.itemId === id && line.variantId === variantId)?.quantity ?? 0,
    [lines],
  );

  return { lines: detailed, loaded: true, add, setQuantity, remove, clear, restore, quantityOf };
}
