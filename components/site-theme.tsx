"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useMenu } from "@/lib/use-menu";
import { pick } from "@/lib/format";
import { visitorTheme } from "@/components/public/theme-toggle";
import { readableOn, safeAccent } from "@/lib/color";

/**
 * يترجم إعدادات الأدمين لـ CSS variables على مستوى الصفحة —
 * علشان لون البراند والحواف والوضع الليلي يطلعوا على الموقع كله فوراً.
 */
export function SiteTheme() {
  const { data, ready } = useMenu();
  const pathname = usePathname();
  const { brand } = data;

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const accent = safeAccent(brand.accent);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-contrast", readableOn(accent));
    root.style.setProperty("--radius", `${brand.radius}px`);
    // لوحة التحكم تعرض اختيار المحل، أما صفحة الكتالوج فتحترم
    // اختيار كل زائر المحفوظ محلياً على جهازه.
    const isAdmin = pathname?.startsWith("/admin");
    root.dataset.theme = isAdmin ? brand.theme : visitorTheme(brand.theme);
    root.dataset.font = brand.font || "cairo";
    root.lang = brand.language;
    root.dir = brand.language === "en" ? "ltr" : "rtl";

    const name = pick(brand.language, brand.storeName, brand.storeNameEn) || "Store Catalog";
    document.title = isAdmin
      ? `لوحة التحكم — ${name}`
      : `${name} — ${pick(brand.language, brand.tagline, brand.taglineEn)}`;

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", accent);

    // Browsers use these links for the tab and iOS home-screen icon. The
    // server routes /icon and /apple-icon already serve the brand logo (or
    // the accent-colored store fallback), so we point at the logo directly
    // when one exists — the tab updates instantly after an admin edit —
    // and back to the generated routes otherwise. Links are never removed.
    const fallbacks = { icon: "/icon", "apple-touch-icon": "/apple-icon" } as const;
    for (const rel of ["icon", "apple-touch-icon"] as const) {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = brand.logo || fallbacks[rel];
    }
  }, [ready, brand, pathname]);

  return null;
}
