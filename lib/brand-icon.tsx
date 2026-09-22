import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getMenu } from "./server-database";
import { DEFAULT_DATA } from "./defaults";
import { readableOn, safeAccent } from "./color";

/**
 * أيقونة الموقع/التطبيق بتتولد من هوية المحل المحفوظة في قاعدة البيانات —
 * نفس اللوجو اللي بيستخدمه manifest الـ PWA، فالتاب والشاشة الرئيسية
 * والإشعارات كلهم بيطلعوا بنفس البراند من غير صور ثابتة في الريبو.
 * ولو الأدمن لسه ما رفعش لوجو بنرسم أيقونة متجر بلون الأكسنت (نفس البديل
 * اللي بيظهر في هيدر الموقع) — فمفيش أبداً 404 على /favicon.ico أو /icon.
 */

// اللوجو بيتغير من لوحة التحكم، فما ينفعش المتصفح يعلّق على نسخة قديمة.
const CACHE_CONTROL = "public, max-age=0, must-revalidate";

const EXTENSION_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

async function loadLogoBytes(logo: string): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  // لوجو مرفوع كـ data URL (وضع التطوير المحلي من غير Cloudinary)
  if (logo.startsWith("data:image/")) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(logo);
    if (!match) return null;
    try {
      return { body: new Uint8Array(Buffer.from(match[2], "base64")), contentType: match[1].toLowerCase() };
    } catch {
      return null;
    }
  }

  // لوجو مرفوع على Cloudinary أو أي رابط مباشر
  if (/^https?:\/\//i.test(logo)) {
    try {
      const response = await fetch(logo, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!response.ok || !contentType.startsWith("image/")) return null;
      return { body: new Uint8Array(await response.arrayBuffer()), contentType };
    } catch {
      return null;
    }
  }

  // مسار نسبي = ملف جوه مجلد public (زي /images/...)
  if (logo.startsWith("/") && !logo.startsWith("//")) {
    try {
      const publicDir = path.join(process.cwd(), "public");
      const filePath = path.normalize(path.join(publicDir, decodeURIComponent(logo.split("?")[0])));
      if (!filePath.startsWith(publicDir + path.sep)) return null;
      const contentType = EXTENSION_TYPES[path.extname(filePath).toLowerCase()];
      if (!contentType) return null;
      return { body: new Uint8Array(await fs.readFile(filePath)), contentType };
    } catch {
      return null;
    }
  }

  return null;
}

function fallbackIcon(accent: string, size: number): ImageResponse {
  const contrast = readableOn(accent);
  const glyph = Math.round(size * 0.56);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: accent,
        }}
      >
        {/* نفس أيقونة lucide "store" المستخدمة كبديل للوجو في هيدر الموقع */}
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke={contrast}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" />
          <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
          <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": CACHE_CONTROL } },
  );
}

/** بيرجع لوجو المحل كصورة، أو أيقونة المتجر بلون الأكسنت لو مفيش لوجو */
export async function brandIconResponse(size: number): Promise<Response> {
  let logo = "";
  let accent = safeAccent(DEFAULT_DATA.brand.accent);
  try {
    const menu = await getMenu();
    logo = menu.brand.logo.trim();
    accent = safeAccent(menu.brand.accent);
  } catch {
    // انقطاع قاعدة البيانات ما يمنعش وجود أيقونة — بنرجع البديل بلون الأكسنت.
  }

  if (logo) {
    const bytes = await loadLogoBytes(logo);
    if (bytes) {
      return new Response(bytes.body, {
        headers: { "Content-Type": bytes.contentType, "Cache-Control": CACHE_CONTROL },
      });
    }
  }

  return fallbackIcon(accent, size);
}
