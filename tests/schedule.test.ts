import { describe, expect, it } from "vitest";

import { effectiveStoreOpen, isStoreOpenBySchedule, parseClock } from "../lib/schedule";
import { contact, weeklySchedule } from "./helpers";

/**
 * مواعيد المحل بتوقيت القاهرة مهما كان توقيت السيرفر أو جهاز الزائر.
 * الحالة الصعبة هنا هي الفترات اللي بتعدي نص الليل (مثال ٦ مساءً → ٢ صباحاً).
 */

/** 23 سبتمبر 2026 يوم أربع (day = 3) */
const cairoAt = (iso: string) => new Date(iso);

describe("parseClock", () => {
  it("بيحوّل HH:MM لدقايق", () => {
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("23:59")).toBe(1439);
  });

  it("بيرجّع null للقيم الغلط", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("خمسة")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
  });
});

describe("isStoreOpenBySchedule — مواعيد عادية", () => {
  const schedule = weeklySchedule("09:00", "17:00");

  it("مفتوح جوه المواعيد", () => {
    // 10:00 UTC = 13:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T10:00:00Z"))).toBe(true);
  });

  it("مقفول قبل الفتح", () => {
    // 05:00 UTC = 08:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T05:00:00Z"))).toBe(false);
  });

  it("مقفول بعد القفل", () => {
    // 15:00 UTC = 18:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T15:00:00Z"))).toBe(false);
  });

  it("مقفول عند وقت القفل بالظبط", () => {
    // 14:00 UTC = 17:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T14:00:00Z"))).toBe(false);
  });

  it("مفتوح عند وقت الفتح بالظبط", () => {
    // 06:00 UTC = 09:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T06:00:00Z"))).toBe(true);
  });

  it("مقفول في اليوم المعطّل", () => {
    expect(isStoreOpenBySchedule(weeklySchedule("09:00", "17:00", false), cairoAt("2026-09-23T10:00:00Z"))).toBe(
      false,
    );
  });
});

describe("isStoreOpenBySchedule — فترة بتعدي نص الليل", () => {
  // ٦ مساءً → ٢ صباحاً: الحالة الطبيعية لمطعم
  const schedule = weeklySchedule("18:00", "02:00");

  it("مفتوح بالليل قبل نص الليل", () => {
    // 18:00 UTC = 21:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T18:00:00Z"))).toBe(true);
  });

  it("مفتوح بعد نص الليل (فترة امبارح)", () => {
    // 22:00 UTC = 01:00 القاهرة اليوم اللي بعده
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T22:00:00Z"))).toBe(true);
  });

  it("مقفول بعد وقت القفل بالليل", () => {
    // 01:00 UTC = 04:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T01:00:00Z"))).toBe(false);
  });

  it("مقفول بالنهار", () => {
    // 09:00 UTC = 12:00 القاهرة
    expect(isStoreOpenBySchedule(schedule, cairoAt("2026-09-23T09:00:00Z"))).toBe(false);
  });
});

describe("effectiveStoreOpen — المفتاح اليدوي مقابل الجدول", () => {
  it("المفتاح اليدوي هو الحاكم لما autoSchedule مقفول", () => {
    const closed = contact({ isOpen: false, autoSchedule: false, weeklySchedule: weeklySchedule("00:00", "23:59") });
    expect(effectiveStoreOpen(closed, cairoAt("2026-09-23T10:00:00Z"))).toBe(false);
  });

  it("الجدول هو الحاكم لما autoSchedule مفعّل", () => {
    // isOpen = false بس الجدول بيقول مفتوح → الجدول بيكسب
    const auto = contact({ isOpen: false, autoSchedule: true, weeklySchedule: weeklySchedule("09:00", "17:00") });
    expect(effectiveStoreOpen(auto, cairoAt("2026-09-23T10:00:00Z"))).toBe(true);
  });

  it("الجدول بيقفل المحل حتى لو isOpen = true", () => {
    const auto = contact({ isOpen: true, autoSchedule: true, weeklySchedule: weeklySchedule("09:00", "17:00") });
    expect(effectiveStoreOpen(auto, cairoAt("2026-09-23T20:00:00Z"))).toBe(false);
  });
});
