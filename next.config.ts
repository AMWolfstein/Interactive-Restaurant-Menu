import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // يسمح لبروكسي المعاينة فقط في التطوير 
  ...(isDev
    ? { allowedDevOrigins: ["*.e2b.app", "*.trycloudflare.com", "*.ngrok-free.app"] }
    : {}),
  images: {
    // الصور المرفوعة بتروح Cloudinary. من غير السطر ده next/image بيرفض أي
    // رابط خارجي، فكل الصور كانت مضطرة تستخدم <img> عادي — يعني من غير
    // تحويل WebP/AVIF ولا أحجام متعددة ولا حجز مساحة يمنع القفز في التخطيط.
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/**" },
    ],
    // أحجام مناسبة لشبكة المنتجات على الموبايل (٢–٣ أعمدة) وللكروت الكبيرة
    imageSizes: [64, 96, 128, 200, 256, 384],
    // الصور المرفوعة مش بتتغير على نفس الرابط — كاش طويل آمن
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // ملحوظة: X-XSS-Protection اتشال عن قصد — الهيدر مهجور، وكل
          // المتصفحات الحديثة شايلاه، وفي حالات معينة كان بيفتح ثغرات
          // بنفسه. الحماية الفعلية من الـ CSP تحت.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
          // CSP خفيف — يسمح بالصور المحلية والـ data: والخطوط من Google
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: https: blob:",
              // تصدير المنيو PNG بيقرا الصور والخطوط بـ fetch قبل ما يحوّلها data:
              // فلازم تكون مصادر الصور/الخطوط مسموحة هنا كمان مش في img-src/font-src بس.
              [
                "connect-src 'self' data: blob:",
                "https://*.supabase.co",
                "wss://*.supabase.co",
                "https://api.cloudinary.com",
                "https://res.cloudinary.com",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ].join(" "),
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
