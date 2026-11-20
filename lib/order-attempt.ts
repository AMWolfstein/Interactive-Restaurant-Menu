import { createHash } from "node:crypto";
import type { PlaceOrderInput } from "./order-write";
import { StoreError } from "./store-error";

export interface OrderAttempt {
  id: string;
  fingerprint: string;
}

export interface SavedOrderAttempt {
  fingerprint: string;
  orderId: string;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function orderAttempt(key: string | null, input: PlaceOrderInput): OrderAttempt | null {
  if (key === null) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new StoreError("مفتاح إعادة محاولة الطلب غير صالح", 400);
  }
  // Bind the attempt to the validated cart and customer details, not the client's estimate.
  return { id: hash(key.toLowerCase()), fingerprint: hash(JSON.stringify(input)) };
}

export function assertSameOrderAttempt(attempt: OrderAttempt, saved: SavedOrderAttempt) {
  if (saved.fingerprint !== attempt.fingerprint) {
    throw new StoreError("محاولة الطلب مرتبطة بتفاصيل مختلفة", 409);
  }
}

export function missingAttemptOrder(): never {
  throw new StoreError("الطلب اتسجّل قبل كده. تواصل مع المحل لاسترجاع تفاصيله", 409);
}
