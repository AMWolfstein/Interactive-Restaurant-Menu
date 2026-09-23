import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // بيئة Node عشان الاختبارات دي كلها منطق نقي (حسابات، قواعد، تواريخ)
    // ومش محتاجة DOM. أي اختبار كمبوننت بعدين هيحتاج environment: "jsdom".
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // التوقيت ثابت عشان اختبارات الجدول الأسبوعي ما تفشلش على ماكينة CI
    // بتوقيت مختلف عن توقيت المحل.
    env: { TZ: "Africa/Cairo" },
  },
});
