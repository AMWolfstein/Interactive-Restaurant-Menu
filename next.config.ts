import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // يسمح لبروكسي المعاينة فقط في التطوير 
  ...(isDev
    ? { allowedDevOrigins: ["*.e2b.app", "*.trycloudflare.com", "*.ngrok-free.app"] }
    : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The admin panel embeds the storefront in its same-origin preview iframe.
          // SAMEORIGIN keeps framing blocked on other origins while allowing that preview.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // CSP خفيف — يسمح بالصور المحلية والـ data: والخطوط من Google
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: https: blob:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.cloudinary.com",
              // Match X-Frame-Options: allow only the same-origin admin preview iframe.
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
