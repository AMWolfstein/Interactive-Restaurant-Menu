import "server-only";

import webpush from "web-push";
import { isItemOnOffer, offerPercent } from "./offers";
import { listPushSubscriptions, removePushSubscription } from "./push-store";
import type { MenuData, MenuItem } from "./types";

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  image?: string;
}

function config() {
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function safeImage(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** يرسل على دفعات صغيرة ولا يجعل فشل إشعار واحد يفشل حفظ الكتالوج. */
export async function sendPushNotification(message: PushMessage): Promise<{ sent: number; removed: number }> {
  const vapid = config();
  if (!vapid) return { sent: 0, removed: 0 };

  const subscriptions = await listPushSubscriptions();
  if (!subscriptions.length) return { sent: 0, removed: 0 };
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const payload = JSON.stringify({
    title: message.title.slice(0, 80),
    body: message.body.slice(0, 180),
    url: message.url ?? "/",
    image: safeImage(message.image),
  });

  let sent = 0;
  let removed = 0;
  for (let start = 0; start < subscriptions.length; start += 25) {
    const results = await Promise.allSettled(
      subscriptions.slice(start, start + 25).map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 12 });
          sent += 1;
        } catch (error) {
          const status = typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
          // الاشتراك انتهى أو تغيّر؛ نحذفه بهدوء حتى لا نعيد محاولة إرساله.
          if (status === 404 || status === 410) {
            await removePushSubscription(subscription.endpoint).catch(() => undefined);
            removed += 1;
          }
        }
      }),
    );
    void results;
  }
  return { sent, removed };
}

function notificationForNewItem(item: MenuItem, currency: string): PushMessage {
  return {
    title: "وصل جديد 🆕",
    body: `${item.name} متاح الآن بسعر ${item.price.toLocaleString("ar-EG")} ${currency}`,
    image: item.image,
  };
}

function notificationForOffer(item: MenuItem, currency: string): PushMessage {
  const percent = offerPercent(item.price, item.oldPrice);
  return {
    title: "عرض جديد 🔥",
    body: `خصم ${percent}% على ${item.name} — الآن ${item.price.toLocaleString("ar-EG")} ${currency}`,
    image: item.image,
  };
}

/**
 * يختار إشعارات ذات قيمة فقط: منتج أضيف حديثاً أو عرض بدأ/تغير.
 * الحد الأقصى 3 رسائل يمنع إغراق العملاء عند الاستيراد أو تعديل قائمة كبيرة.
 */
export async function notifyCatalogChanges(before: MenuData, after: MenuData): Promise<void> {
  const oldById = new Map(before.items.map((item) => [item.id, item]));
  const messages: PushMessage[] = [];

  for (const item of after.items) {
    const previous = oldById.get(item.id);
    if (!previous) {
      messages.push(notificationForNewItem(item, after.commerce.currency));
      continue;
    }
    const wasOnOffer = isItemOnOffer(previous);
    const nowOnOffer = isItemOnOffer(item);
    const changedOffer = previous.price !== item.price || previous.oldPrice !== item.oldPrice
      || previous.offerEndDay !== item.offerEndDay || previous.offerEndMonth !== item.offerEndMonth || previous.offerEndYear !== item.offerEndYear;
    if (nowOnOffer && (!wasOnOffer || changedOffer)) messages.push(notificationForOffer(item, after.commerce.currency));
  }

  for (const message of messages.slice(0, 3)) {
    try {
      await sendPushNotification(message);
    } catch (error) {
      // الإشعارات تحسين اختياري؛ نحتفظ بسجل مفيد من دون تعطيل حفظ الأدمن.
      console.error("[push] notification failed", error instanceof Error ? error.message : error);
    }
  }
}
