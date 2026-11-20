import "server-only";

import { createHash } from "node:crypto";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestoreDb } from "./firebase-admin";
import { decodePayload, payloadChunks, writePayload } from "./firestore-payload.mjs";
import { normalizeData } from "./normalize";
import { isUsablePhone, normalizePhone } from "./loyalty";
import { changeOrderStatus, orderNumber, prepareOrder, type PlaceOrderInput } from "./order-write";
import { assertSameOrderAttempt, missingAttemptOrder, type OrderAttempt, type SavedOrderAttempt } from "./order-attempt";
import { StoreError } from "./store-error";
import type { CustomerRecord, MenuData, OrderStatus, SavedOrder } from "./types";

interface OrderDocument {
  data: SavedOrder;
  createdAt: string;
  phoneKey: string;
  loyaltyTracked?: boolean;
}

function docId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function catalogRef(db = firestoreDb()) {
  return db.doc("catalog/main");
}

function signal(name: "catalog" | "orders") {
  return firestoreDb().doc(`store_signals/${name}`);
}

function customerRef(phoneKey: string) {
  return firestoreDb().collection("customers").doc(phoneKey);
}

async function withFirestore<T>(message: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StoreError) throw error;
    console.error("[firestore]", error);
    throw new StoreError(message, 503);
  }
}

export function fetchPublishedMenu() {
  return withFirestore("تعذّر قراءة الكتالوج", async () => {
    const db = firestoreDb();
    const [catalog, sales] = await Promise.all([
      payloadChunks(catalogRef(db)).get(),
      db.collection("item_sales").select("itemId", "count").get(),
    ]);
    const payload = decodePayload(catalog);
    if (!payload) return null;
    const menu = normalizeData(payload);
    const counts = new Map(sales.docs.map((entry) => [entry.get("itemId"), Number(entry.get("count"))]));
    return {
      ...menu,
      items: menu.items.map((item) => ({
        ...item,
        salesCount: counts.get(item.id) ?? item.salesCount ?? 0,
      })),
    };
  });
}

export function savePublishedMenu(menu: MenuData) {
  return withFirestore("تعذّر حفظ الكتالوج", async () => {
    const db = firestoreDb();
    const ref = catalogRef(db);
    await db.runTransaction(async (tx) => {
      await tx.get(ref);
      const previous = await tx.get(payloadChunks(ref));
      writePayload(tx, ref, menu, previous.docs);
      tx.set(ref, { updatedAt: menu.updatedAt });
      tx.set(signal("catalog"), { changedAt: FieldValue.serverTimestamp() });
    });
    return menu;
  });
}

export function placeOrder(input: PlaceOrderInput, attempt: OrderAttempt | null) {
  return withFirestore("تعذّر تسجيل الطلب", async () => {
    const db = firestoreDb();
    return db.runTransaction(async (tx) => {
      const orders = db.collection("orders");
      const attemptRef = attempt ? db.collection("order_attempts").doc(attempt.id) : null;
      if (attemptRef && attempt) {
        const saved = (await tx.get(attemptRef)).data() as SavedOrderAttempt | undefined;
        if (saved) {
          assertSameOrderAttempt(attempt, saved);
          const record = (await tx.get(orders.doc(docId(saved.orderId)))).data() as OrderDocument | undefined;
          return record?.data ?? missingAttemptOrder();
        }
      }

      const stored = decodePayload(await tx.get(payloadChunks(catalogRef(db))));
      if (!stored) throw new StoreError("الكتالوج غير جاهز لاستقبال الطلبات", 503);
      const menu = normalizeData(stored);
      const phoneKey = normalizePhone(input.customer.phone);
      const customerDoc = menu.commerce.loyalty.enabled && isUsablePhone(input.customer.phone) ? customerRef(phoneKey) : null;
      const customer = customerDoc ? (await tx.get(customerDoc)).data() as CustomerRecord | undefined : undefined;

      let id = orderNumber(menu);
      let orderRef = orders.doc(docId(id));
      for (let attempt = 0; (await tx.get(orderRef)).exists; attempt += 1) {
        if (attempt === 11) throw new StoreError("تعذّر إنشاء رقم طلب فريد، حاول مرة أخرى", 503);
        id = orderNumber(menu);
        orderRef = orders.doc(docId(id));
      }

      const { order, updatedCustomer, soldQuantities } = prepareOrder(
        menu, input, id, new Date().toISOString(), customerDoc ? phoneKey : "", customer,
      );
      const itemIds = [...soldQuantities.keys()];
      const itemRefs = itemIds.map((itemId) => db.collection("item_sales").doc(docId(itemId)));
      const sales = await tx.getAll(...itemRefs);
      const bases = new Map(menu.items.map((item) => [item.id, item.salesCount ?? 0]));

      const document: OrderDocument = { data: order, createdAt: order.createdAt, phoneKey, loyaltyTracked: Boolean(customerDoc) };
      tx.create(orderRef, document);
      if (attemptRef && attempt) tx.set(attemptRef, { orderId: id, fingerprint: attempt.fingerprint });
      if (customerDoc && updatedCustomer) tx.set(customerDoc, updatedCustomer);
      sales.forEach((snapshot, index) => {
        const itemId = itemIds[index];
        const count = Number(snapshot.get("count") ?? bases.get(itemId) ?? 0) + (soldQuantities.get(itemId) ?? 0);
        tx.set(snapshot.ref, { itemId, count });
      });
      tx.set(signal("orders"), { changedAt: FieldValue.serverTimestamp() });
      return order;
    });
  });
}

export function updateOrderStatus(id: string, status: OrderStatus) {
  return withFirestore("تعذّر تحديث حالة الطلب", async () => {
    const db = firestoreDb();
    const ref = db.collection("orders").doc(docId(id));
    return db.runTransaction(async (tx) => {
      const document = (await tx.get(ref)).data() as OrderDocument | undefined;
      if (!document) throw new StoreError("الطلب غير موجود", 404);
      const phoneKey = document.phoneKey;
      const customerDoc = document.loyaltyTracked !== false && phoneKey.length >= 8 ? customerRef(phoneKey) : null;
      const customer = customerDoc ? (await tx.get(customerDoc)).data() as CustomerRecord | undefined : undefined;
      const result = changeOrderStatus(document.data, status, new Date().toISOString(), customer);
      tx.update(ref, { data: result.order });
      if (customerDoc && result.updatedCustomer) tx.set(customerDoc, result.updatedCustomer);
      tx.set(signal("orders"), { changedAt: FieldValue.serverTimestamp() });
      return result.order;
    });
  });
}

function ordersFrom(documents: QueryDocumentSnapshot[]) {
  return documents.map((document) => (document.data() as OrderDocument).data);
}

export function fetchLatestOrders() {
  return withFirestore("تعذّر قراءة بيانات اللوحة", async () => {
    const orders = await firestoreDb().collection("orders").orderBy("createdAt", "desc").limit(200).get();
    return ordersFrom(orders.docs);
  });
}

export function fetchCustomerOrders(phoneKey: string, limit: number) {
  return withFirestore("تعذّر قراءة طلبات العميل", async () => {
    const orders = await firestoreDb().collection("orders").where("phoneKey", "==", phoneKey)
      .orderBy("createdAt", "desc").limit(limit).get();
    return ordersFrom(orders.docs);
  });
}

export function fetchCustomer(phoneKey: string) {
  return withFirestore("تعذّر قراءة رصيد العميل", async () => {
    return (await customerRef(phoneKey).get()).data() as CustomerRecord | undefined;
  });
}

export function customerMatches(customer: CustomerRecord, needle: string, digits: string) {
  return !needle || customer.name.toLowerCase().includes(needle) || Boolean(digits && customer.phone.includes(digits));
}

export function searchCustomers(search: string, limit: number) {
  return withFirestore("تعذّر قراءة العملاء", async () => {
    const query = firestoreDb().collection("customers").orderBy("updatedAt", "desc");
    const needle = search.toLowerCase();
    const digits = normalizePhone(search);
    if (!needle) return (await query.limit(limit).get()).docs.map((doc) => doc.data() as CustomerRecord);

    // Firestore has no substring query. Scan in bounded pages, stopping once the requested results are found.
    const matches: CustomerRecord[] = [];
    const pageSize = 200;
    let page = await query.limit(pageSize).get();
    while (!page.empty) {
      for (const doc of page.docs) {
        const customer = doc.data() as CustomerRecord;
        if (customerMatches(customer, needle, digits)) matches.push(customer);
        if (matches.length === limit) return matches;
      }
      if (page.size < pageSize) break;
      page = await query.startAfter(page.docs[page.docs.length - 1]).limit(pageSize).get();
    }
    return matches;
  });
}
