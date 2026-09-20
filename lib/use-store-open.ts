"use client";

import { useEffect, useMemo, useState } from "react";
import { effectiveStoreOpen } from "./schedule";
import type { ContactSettings } from "./types";

/**
 * حالة المحل الفعلية (يدوي أو جدول أوتوماتيك) — بتتحدث كل دقيقة
 * عشان المحل يقفل/يفتح لحظياً قدام العميل من غير تحديث الصفحة.
 */
export function useStoreOpen(contact: ContactSettings): boolean {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // أول قيمة بعد الوصول (بشكل غير متزامن) لتفادي اختلاف SSR/CSR
    const update = () => setNow(new Date());
    const kick = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, []);

  return useMemo(
    () => effectiveStoreOpen(contact, now ?? new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contact.autoSchedule, contact.isOpen, contact.weeklySchedule, now],
  );
}
