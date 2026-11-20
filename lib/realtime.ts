import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseBrowser } from "./firebase-browser";

export type StoreSignal = "catalog" | "orders";

/** Realtime يحمل علامة تغيّر بس. بيانات الطلبات بتتحمّل من الـ API بعد التحقق من الصلاحيات. */
export function subscribeRealtime(signal: StoreSignal, onChange: () => void): () => void {
  const client = getFirebaseBrowser();
  if (!client) return () => {};

  let lastVersion: string | undefined;
  return onSnapshot(doc(client.firestore, "store_signals", signal), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    const changedAt = snapshot.get("changedAt");
    const version = changedAt ? `${changedAt.seconds}:${changedAt.nanoseconds}` : "empty";
    if (version === lastVersion) return;
    lastVersion = version;
    onChange();
  }, (error) => {
    console.warn(`[realtime] ${signal} listener unavailable; polling stays active`, error.code);
  });
}
