import "server-only";

import { randomUUID } from "node:crypto";
import { firestoreDb } from "./firebase-admin";
import { decodePayload, payloadChunks, writePayload } from "./firestore-payload.mjs";
import type { MenuData } from "./types";

const RETENTION_COUNT = 30;
export type BackupReason = "scheduled" | "manual";

export interface CatalogBackupSummary {
  id: string;
  createdAt: string;
  reason: BackupReason;
  itemCount: number;
  categoryCount: number;
}

export async function createCatalogBackup(menu: MenuData, reason: BackupReason): Promise<CatalogBackupSummary> {
  const db = firestoreDb();
  const backups = db.collection("catalog_backups");
  const ref = backups.doc(randomUUID());
  const summary: CatalogBackupSummary = {
    id: ref.id,
    createdAt: new Date().toISOString(),
    reason,
    itemCount: menu.items.length,
    categoryCount: menu.categories.length,
  };
  const batch = db.batch();
  batch.create(ref, summary);
  writePayload(batch, ref, menu);
  await batch.commit();

  const stale = await backups.orderBy("createdAt", "desc").offset(RETENTION_COUNT).select().get();
  for (const snapshot of stale.docs) {
    await db.runTransaction(async (tx) => {
      const chunks = await tx.get(payloadChunks(snapshot.ref));
      for (const chunk of chunks.docs) tx.delete(chunk.ref);
      tx.delete(snapshot.ref);
    });
  }
  return summary;
}

export async function listCatalogBackups(limit = 15): Promise<CatalogBackupSummary[]> {
  const safeLimit = Math.min(Math.max(1, limit), RETENTION_COUNT);
  const backups = await firestoreDb().collection("catalog_backups").orderBy("createdAt", "desc")
    .limit(safeLimit).get();
  return backups.docs.map((backup) => backup.data() as CatalogBackupSummary);
}

export async function getCatalogBackup(id: string): Promise<MenuData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const backup = firestoreDb().collection("catalog_backups").doc(id);
  return decodePayload(await payloadChunks(backup).get()) as MenuData | null;
}
