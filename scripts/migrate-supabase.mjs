import { createHash } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { writePayload } from "../lib/firestore-payload.mjs";
import { normalizePhone } from "../lib/loyalty.ts";

const source = process.env.SUPABASE_MIGRATION_URL?.trim().replace(/\/$/, "");
const key = process.env.SUPABASE_MIGRATION_SERVICE_KEY?.trim();
const target = (process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)?.trim();
const apply = process.argv[2] === "--apply";
if (!source || !key || !target) {
  throw new Error("Set SUPABASE_MIGRATION_URL, SUPABASE_MIGRATION_SERVICE_KEY and FIREBASE_PROJECT_ID.");
}
if (process.argv.length > (apply ? 3 : 2)) throw new Error("Usage: npm run firestore:migrate -- [--apply]");
const sourceUrl = new URL(source);
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname);
if (sourceUrl.protocol !== "https:" && !loopback) throw new Error("Use an HTTPS Supabase URL.");
if (sourceUrl.username || sourceUrl.password) throw new Error("The source URL must not include credentials.");

const db = apply ? getFirestore(initializeApp({ projectId: target, credential: applicationDefault() })) : null;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const iso = (value) => new Date(value).toISOString();
const pageSize = 200;
const headers = { apikey: key };
// Legacy service_role keys are JWTs. The gateway handles current secret keys via apikey.
if (key.split(".").length === 3) headers.authorization = `Bearer ${key}`;

async function* pages(table, id) {
  let offset = 0;
  while (true) {
    const url = new URL(`${source}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    url.searchParams.set("order", `${id}.asc`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(pageSize));
    const response = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Couldn't read ${table} (HTTP ${response.status}).`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error(`Invalid response for ${table}.`);
    if (rows.length === 0) break;
    yield rows;
    offset += rows.length;
  }
}

async function importDocuments(table, sourceId, collection, convert) {
  let read = 0;
  let created = 0;
  for await (const rows of pages(table, sourceId)) {
    read += rows.length;
    if (!db) continue;

    const entries = rows.map(convert);
    const writer = db.bulkWriter();
    const results = Promise.allSettled(entries.map(([id, data]) => writer.create(db.collection(collection).doc(id), data)));
    await writer.close();
    for (const result of await results) {
      if (result.status === "fulfilled") created += 1;
      else if (result.reason?.code !== 6) {
        throw new Error(`Couldn't write ${collection} (Firestore code ${result.reason?.code ?? "unknown"}).`);
      }
    }
  }
  console.log(`${table}: ${read} source records${db ? `, ${created} created, ${read - created} already present` : ""}`);
}

async function importPayloads(table, sourceId, collection, convert) {
  let read = 0;
  let created = 0;
  for await (const rows of pages(table, sourceId)) {
    for (const row of rows) {
      const entry = convert(row);
      if (!entry) continue;
      read += 1;
      if (!db) continue;

      const [id, meta, payload] = entry;
      const ref = db.collection(collection).doc(id);
      const inserted = await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return false;
        writePayload(tx, ref, payload);
        tx.create(ref, meta);
        return true;
      });
      if (inserted) created += 1;
    }
  }
  console.log(`${table}: ${read} source records${db ? `, ${created} created, ${read - created} already present` : ""}`);
}

console.log(`${apply ? "Importing to" : "Dry run for"} ${target}${process.env.FIRESTORE_EMULATOR_HOST ? " (emulator)" : ""}`);

await importDocuments("orders", "id", "orders", (row) => {
  const createdAt = iso(row.created_at);
  const data = { ...row.data, id: row.id, createdAt: row.data.createdAt || createdAt };
  return [hash(row.id), { data, createdAt, phoneKey: normalizePhone(data.customer?.phone ?? "") }];
});
await importDocuments("customers", "phone", "customers", (row) => [row.phone, {
  phone: row.phone,
  name: row.name,
  spent: Number(row.spent),
  lifetime: Number(row.lifetime),
  ordersCount: Number(row.orders_count),
  rewardsUsed: Number(row.rewards_used),
  discountTotal: Number(row.discount_total),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
}]);
await importDocuments("item_sales", "item_id", "item_sales", (row) => [hash(row.item_id), {
  itemId: row.item_id,
  count: Number(row.sales_count),
}]);
await importDocuments("push_subscriptions", "endpoint", "push_subscriptions", (row) => [hash(row.endpoint), {
  endpoint: row.endpoint,
  keys: { p256dh: row.p256dh, auth: row.auth },
  updatedAt: iso(row.updated_at),
}]);
await importPayloads("catalog_backups", "id", "catalog_backups", (row) => [row.id, {
  id: row.id,
  createdAt: iso(row.created_at),
  reason: row.reason,
  itemCount: row.data.items?.length ?? 0,
  categoryCount: row.data.categories?.length ?? 0,
}, row.data]);
await importPayloads("catalog_data", "slug", "catalog", (row) => row.slug === "main" ? [
  "main", { updatedAt: iso(row.updated_at) }, row.data,
] : null);

if (db) {
  const batch = db.batch();
  for (const name of ["catalog", "orders"]) {
    batch.set(db.doc(`store_signals/${name}`), { changedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
}
