"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { CartLine, OrderType } from "./types";

interface CheckoutBody {
  lines: CartLine[];
  orderType: OrderType;
  customer: { name: string; phone: string; address: string; notes: string };
  zoneId?: string;
  paymentMethod?: string;
}

export interface PendingOrder {
  key: string;
  body: CheckoutBody;
  cartSnapshot: string;
  whatsappNumber: string;
}

export interface OrderReceipt {
  id: string;
  total: number;
  currency: string;
  whatsappNumber: string;
}

const PENDING_KEY = "store-catalog:checkout-pending:v1";
const RECEIPT_KEY = "store-catalog:checkout-receipt:v1";
const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  const serialized = value === null ? null : JSON.stringify(value);
  memory.set(key, serialized);
  try {
    if (serialized === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, serialized);
  } catch {
    // The attempt and receipt still work while navigating within this tab.
  }
  for (const listener of listeners) listener();
}

function parse<T>(value: string | null): T | null {
  try {
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

const getPendingSnapshot = () => read(PENDING_KEY);
const getReceiptSnapshot = () => read(RECEIPT_KEY);
const getServerSnapshot = () => null;
const getReceiptServerSnapshot = () => undefined;

export function usePendingOrder() {
  const value = useSyncExternalStore(subscribe, getPendingSnapshot, getServerSnapshot);
  return useMemo(() => parse<PendingOrder>(value), [value]);
}

export function useOrderReceipt() {
  const value = useSyncExternalStore(subscribe, getReceiptSnapshot, getReceiptServerSnapshot);
  return useMemo(() => value === undefined ? undefined : parse<OrderReceipt>(value), [value]);
}

export function savePendingOrder(order: PendingOrder | null) {
  write(PENDING_KEY, order);
}

export function saveOrderReceipt(receipt: OrderReceipt) {
  write(RECEIPT_KEY, receipt);
}
