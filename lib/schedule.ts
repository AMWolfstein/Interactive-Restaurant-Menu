import type { ContactSettings, WeekDaySchedule } from "./types";

/**
 * جدول الفتح والقفل الأوتوماتيكي.
 *
 * كل الحسابات بتتم بتوقيت المحل (Africa/Cairo افتراضياً) سواء على المتصفح
 * أو على السيرفر — عشان الحالة تتطابق في كل الأجهزة مهما كان توقيت الجهاز.
 */

/** توقيت المحل — كل مواعيد الجدول بتتفسر على التوقيت ده */
export const STORE_TIMEZONE = "Africa/Cairo";

export const WEEK_DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** يحوّل "HH:MM" لعدد دقائق من نص اليوم — null لو الصيغة غلط */
export function parseClock(value: string): number | null {
  const match = TIME_PATTERN.exec((value ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

interface ZonedNow {
  /** 0 = الأحد … 6 = السبت */
  day: number;
  /** دقائق من نص اليوم بالتوقيت المحلي للمحل */
  minutes: number;
}

/** الوقت الحالي بتوقيت المحل (بدون اعتماد على توقيت جهاز العميل) */
export function zonedNow(date = new Date(), timeZone = STORE_TIMEZONE): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minutes = parseClock(`${get("hour")}:${get("minute")}`) ?? 0;
  return { day: dayIndex < 0 ? 0 : dayIndex, minutes };
}

function windowOf(schedule: WeekDaySchedule[], day: number) {
  const entry = schedule.find((slot) => slot.day === day);
  if (!entry || !entry.enabled) return null;
  const open = parseClock(entry.open);
  const close = parseClock(entry.close);
  if (open === null || close === null) return null;
  // close <= open معناه الفترة بتعدي نص الليل (مثال: 18:00 → 02:00)
  const overnight = close <= open;
  return { open, close, overnight };
}

/** هل المحل مفتوح دلوقتي حسب الجدول؟ */
export function isStoreOpenBySchedule(
  schedule: WeekDaySchedule[],
  date = new Date(),
  timeZone = STORE_TIMEZONE,
): boolean {
  const { day, minutes } = zonedNow(date, timeZone);
  const today = windowOf(schedule, day);
  if (today) {
    if (today.overnight) {
      // من وقت الفتح لحد 24:00
      if (minutes >= today.open) return true;
    } else if (minutes >= today.open && minutes < today.close) {
      return true;
    }
  }
  // فترة امبارح اللي بتعدي نص الليل: من 00:00 لحد وقت القفل
  const yesterday = windowOf(schedule, (day + 6) % 7);
  if (yesterday?.overnight && minutes < yesterday.close) return true;
  return false;
}

export interface NextOpening {
  /** يوم الفتح القادم (0 = الأحد …) */
  day: number;
  /** وقت الفتح "HH:MM" */
  open: string;
  /** كم ساعة وفاضلة (تقريبي) */
  inHours: number;
}

/** أقرب موعد فتح جاي — null لو مفيش يوم مفتوح في الجدول كله */
export function findNextOpening(
  schedule: WeekDaySchedule[],
  date = new Date(),
  timeZone = STORE_TIMEZONE,
): NextOpening | null {
  const start = zonedNow(date, timeZone);
  for (let step = 0; step < 8; step += 1) {
    const day = (start.day + step) % 7;
    const window = windowOf(schedule, day);
    if (!window) continue;
    const dayOffsetMinutes = step * 24 * 60;
    const opensAt = window.open + dayOffsetMinutes;
    if (opensAt > start.minutes) {
      return { day, open: schedule.find((s) => s.day === day)?.open ?? "", inHours: (opensAt - start.minutes) / 60 };
    }
  }
  return null;
}

/** وصف موعد الفتح القادم بالعربي للعرض في الواجهة */
export function describeNextOpening(
  schedule: WeekDaySchedule[],
  date = new Date(),
  timeZone = STORE_TIMEZONE,
): string {
  const next = findNextOpening(schedule, date, timeZone);
  if (!next) return "";
  const hours = Math.max(1, Math.round(next.inHours));
  const dayLabel = hours <= 20 ? `النهارده` : WEEK_DAYS_AR[next.day];
  return `يفتح ${dayLabel} الساعة ${next.open} (بعد ~${hours} ساعة)`;
}

/** الحالة الفعلية للمحل: يدوية أو أوتوماتيك حسب الجدول */
export function effectiveStoreOpen(contact: ContactSettings, date = new Date()): boolean {
  if (contact.autoSchedule) return isStoreOpenBySchedule(contact.weeklySchedule ?? [], date);
  return contact.isOpen;
}
