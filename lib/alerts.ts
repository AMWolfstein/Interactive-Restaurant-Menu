"use client";

/**
 * تنبيهات صاحب المحل بالطلبات الجديدة:
 *  - نغمة "دينج" مولّدة بالـ Web Audio (من غير أي ملف صوتي)
 *  - وميض في عنوان التاب لحد ما الأدمين يرجع للوحة
 *
 * المتصفحات بتمنع الصوت قبل أول تفاعل من المستخدم — بنجهّز الـ AudioContext
 * بأول نقرة داخل اللوحة، وبعدها النغمة بتشتغل حتى لو التاب في الخلفية.
 */

let audioContext: AudioContext | null = null;
let primed = false;

type AudioCtor = new () => AudioContext;

/** تجهيز الصوت بأول تفاعل — بينادى مرة واحدة من listener في اللوحة */
export function primeAlertAudio() {
  if (primed) return;
  primed = true;
  try {
    const ctor: AudioCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!ctor) return;
    audioContext = new ctor();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    audioContext = null;
  }
}

/** نغمة طلب جديد — نوتتين مرحتين متتاليتين */
export function playOrderChime() {
  if (!audioContext) primeAlertAudio();
  const ctx = audioContext;
  if (!ctx || ctx.state === "suspended") {
    void ctx?.resume();
  }
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 880, at: 0, duration: 0.16 }, // A5
      { freq: 1174.66, at: 0.18, duration: 0.28 }, // D6
    ];
    for (const note of notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.exponentialRampToValueAtTime(0.22, now + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(now + note.at);
      oscillator.stop(now + note.at + note.duration + 0.05);
    }
  } catch {
    // الصوت ميزة تحسينية — أي فشل بيتجاهل بصمت
  }
}

/* --------------------------- وميض عنوان التاب --------------------------- */

let flashTimer: number | null = null;
let originalTitle: string | null = null;

/** يخلي عنوان التاب يومض برسالة لحد stopTitleFlash أو تفاعل المستخدم */
export function flashTitle(message: string) {
  if (typeof document === "undefined") return;
  stopTitleFlash();
  originalTitle = document.title;
  let toggle = false;
  const tick = () => {
    toggle = !toggle;
    document.title = toggle ? message : originalTitle ?? "";
  };
  tick();
  flashTimer = window.setInterval(tick, 900);
  // أوقف الوميض تلقائياً بعد 30 ثانية أو بأول تفاعل
  window.setTimeout(() => stopTitleFlash(), 30_000);
  window.addEventListener("pointerdown", stopTitleFlash, { once: true });
  window.addEventListener("visibilitychange", stopTitleFlash, { once: true });
}

/** إرجاع عنوان التاب لطبيعته */
export function stopTitleFlash() {
  if (flashTimer !== null) {
    window.clearInterval(flashTimer);
    flashTimer = null;
  }
  if (originalTitle !== null && typeof document !== "undefined") {
    document.title = originalTitle;
    originalTitle = null;
  }
}
