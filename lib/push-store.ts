import "server-only";

import { createHash } from "node:crypto";
import { firestoreDb } from "./firebase-admin";

export interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function subscriptions() {
  return firestoreDb().collection("push_subscriptions");
}

function subscriptionId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function savePushSubscription(subscription: StoredPushSubscription): Promise<void> {
  await subscriptions().doc(subscriptionId(subscription.endpoint))
    .set({ ...subscription, updatedAt: new Date().toISOString() });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await subscriptions().doc(subscriptionId(endpoint)).delete();
}

export async function listPushSubscriptions(): Promise<StoredPushSubscription[]> {
  const snapshot = await subscriptions().select("endpoint", "keys").limit(10_000).get();
  return snapshot.docs.map((doc) => doc.data() as StoredPushSubscription);
}
