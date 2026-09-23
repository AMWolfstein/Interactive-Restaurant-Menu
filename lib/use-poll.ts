"use client";

import { useEffect, useRef } from "react";

/**
 * فحص دوري بيقف لما التاب يكون مخفي.
 *
 * كل اللوحات عندها Realtime شغّال، والفحص الدوري ده شبكة أمان بس لو الـ
 * WebSocket انقطع. المشكلة إنه كان بيفضل شغال حتى والتاب مقفول في الخلفية —
 * يعني تاب أدمن سايبه مفتوح على موبايل بيضرب /api/admin/overview كل ٣٠ ثانية
 * طول اليوم، وكل نداء بيجيب الطلبات بالـ JSON بتاعها كامل.
 *
 * الهوك ده:
 *   - بيوقف المؤقّت لما `document.hidden` يبقى true
 *   - بيعمل تحديث فوري أول ما التاب يرجع يبان (عشان البيانات تلحق نفسها)
 *   - بيمسك آخر نسخة من `callback` في ref فما بيعملش إعادة جدولة كل رندر
 */
export function usePoll(callback: () => void, intervalMs: number, enabled = true): void {
  const saved = useRef(callback);

  // تحديث المرجع في effect مش أثناء الرندر (الرندر لازم يفضل نقي)
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let timer: number | undefined;

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    const start = () => {
      stop();
      timer = window.setInterval(() => saved.current(), intervalMs);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // التاب رجع: حدّث حالاً بدل ما نستنى دورة كاملة
        saved.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
