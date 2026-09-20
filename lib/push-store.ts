import "server-only";

import { rest } from "./supabase-store";

const PUSH_TABLE = "push_subscriptions";

export interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function serviceRoleKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}

function serviceOptions() {
  const key = serviceRoleKey();
  return { apiKey: key, token: key };
}

function assertConfigured() {
  if (!serviceRoleKey()) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
}

export async function savePushSubscription(subscription: StoredPushSubscription): Promise<void> {
  assertConfigured();
  const result = await rest<null>(`${PUSH_TABLE}?on_conflict=endpoint`, {
    method: "POST",
    body: {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updated_at: new Date().toISOString(),
    },
    prefer: "resolution=merge-duplicates,return=minimal",
    ...serviceOptions(),
  });
  if (!result.ok) throw new Error(result.message || "تعذّر حفظ اشتراك الإشعارات");
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  assertConfigured();
  const result = await rest<null>(`${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
    ...serviceOptions(),
  });
  if (!result.ok) throw new Error(result.message || "تعذّر إلغاء اشتراك الإشعارات");
}

export async function listPushSubscriptions(): Promise<StoredPushSubscription[]> {
  assertConfigured();
  const result = await rest<Array<{ endpoint: string; p256dh: string; auth: string }>>(
    `${PUSH_TABLE}?select=endpoint,p256dh,auth&limit=10000`,
    serviceOptions(),
  );
  if (!result.ok) throw new Error(result.message || "تعذّر قراءة اشتراكات الإشعارات");
  return (result.data ?? []).map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
}
