import type { DocumentReference, Query, QueryDocumentSnapshot, QuerySnapshot, Transaction, WriteBatch } from "firebase-admin/firestore";

export function payloadChunks(ref: DocumentReference): Query;
export function decodePayload(snapshot: QuerySnapshot): unknown;
export function writePayload(
  writer: Transaction | WriteBatch,
  ref: DocumentReference,
  value: unknown,
  previousChunks?: QueryDocumentSnapshot[],
): void;
