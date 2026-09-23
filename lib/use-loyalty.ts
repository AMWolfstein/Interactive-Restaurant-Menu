"use client";

import { useEffect, useState } from "react";
import { computeLoyaltyDiscount, isUsablePhone, normalizePhone, projectLoyalty } from "./loyalty";
import type { LoyaltySettings, LoyaltySnapshot } from "./types";

/**
 * رصيد «كاشك» للعميل اللي بيكتب رقمه في السلة.
 *
 * بيستنى شوية بعد ما العميل يبطّل كتابة (debounce) قبل ما يسأل السيرفر، عشان
 * ميبعتش نداء مع كل حرف. الرد بيتخزن مؤقتاً لنفس الرقم.
 *
 * ⚠️ القيم دي للعرض بس. الخصم الحقيقي بيتحسب في قاعدة البيانات وقت تسجيل
 * الطلب، فأي تلاعب هنا مش بيغيّر الفاتورة.
 */
export interface LoyaltyView {
  /** هل نعرض حاجة أصلاً */
  show: boolean;
  balance: number;
  threshold: number;
  percent: number;
  /** العميل مستحق خصم على الطلب ده */
  eligible: boolean;
  remaining: number;
  progress: number;
  loading: boolean;
}

const EMPTY: LoyaltyView = {
  show: false,
  balance: 0,
  threshold: 0,
  percent: 0,
  eligible: false,
  remaining: 0,
  progress: 0,
  loading: false,
};

/** الرد الخام من السيرفر لرقم معيّن */
interface Fetched {
  key: string;
  balance: number;
  threshold: number;
  percent: number;
  eligible: boolean;
  remaining: number;
  progress: number;
}

export function useLoyalty(phone: string, settings: LoyaltySettings): LoyaltyView {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [loading, setLoading] = useState(false);
  const key = normalizePhone(phone);
  const active = settings.enabled && isUsablePhone(phone);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    // نستنى نص ثانية بعد آخر تعديل — العميل بيكتب ١١ رقم، مش عايزين ١١ نداء
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/loyalty", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: key }),
        });
        if (!response.ok) throw new Error("failed");
        const data = (await response.json()) as Omit<Fetched, "key"> & { enabled: boolean };
        if (cancelled) return;
        setFetched(data.enabled ? { ...data, key } : null);
      } catch {
        // فشل الشبكة ميعطلش الطلب — بنخفي الشريط وخلاص
        if (!cancelled) setFetched(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, active]);

  // النتيجة بتتشتق من الحالة — لو الرقم اتغيّر بنتجاهل رد الرقم القديم
  // من غير ما نضطر نستدعي setState جوه الـ effect.
  if (!active || !fetched || fetched.key !== key) {
    return { ...EMPTY, loading: active && loading };
  }

  return {
    show: true,
    balance: fetched.balance ?? 0,
    threshold: fetched.threshold ?? settings.threshold,
    percent: fetched.percent ?? settings.percent,
    eligible: Boolean(fetched.eligible),
    remaining: fetched.remaining ?? 0,
    progress: fetched.progress ?? 0,
    loading,
  };
}

/** قيمة خصم كاشك المتوقّعة للعرض في ملخّص السلة */
export function previewDiscount(
  view: LoyaltyView,
  settings: LoyaltySettings,
  subtotal: number,
): LoyaltySnapshot | null {
  if (!view.show || !view.eligible) return null;
  return computeLoyaltyDiscount(settings, subtotal, view.balance);
}

export interface LoyaltyProgress {
  /** الباقي على المكافأة بعد احتساب اللي في السلة دلوقتي */
  remaining: number;
  progress: number;
  /** الطلب اللي في السلة هو اللي هيوصّل العميل للعتبة */
  unlocksReward: boolean;
}

/**
 * تقدّم العميل ناحية المكافأة **شامل الطلب اللي في السلة**.
 *
 * `view.remaining` الجاي من السيرفر محسوب على الطلبات القديمة بس، فلو عرضناه
 * زي ما هو العميل اللي حاطط بـ ٢٠٠ في السلة هيقرا «فاضل ٥٠٠٠» بدل «٤٨٠٠».
 *
 * @param subtotal قيمة الأصناف في السلة قبل التوصيل والخدمة — دي اللي بتتضاف
 *                 لرصيد العميل في place_order.
 */
export function loyaltyProgress(view: LoyaltyView, subtotal: number): LoyaltyProgress {
  const { remaining, progress, unlocksReward } = projectLoyalty(
    { threshold: view.threshold, balance: view.balance },
    subtotal,
  );
  return { remaining, progress, unlocksReward };
}
