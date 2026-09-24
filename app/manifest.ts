import type { MetadataRoute } from "next";
import { getMenu } from "@/lib/server-database";
import { DEFAULT_DATA } from "@/lib/defaults";
import { safeAccent } from "@/lib/color";

// الملف بيعتمد على إعدادات صاحب المحل، فما ينفعش يتجمّد وقت البناء.
// بس كمان ما ينفعش يقرا من قاعدة البيانات مع كل طلب: المتصفحات بتطلبه
// كتير، وكل طلب كان بيبقى استعلام كامل على الكتالوج. دقيقتين كاش بتحل
// الاتنين — أي تغيير في اللوجو بيظهر خلالهم.
export const revalidate = 120;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let logo = "";
  let storeName = "كتالوج المتجر";
  // الشاشة الافتتاحية للتطبيق لازم تطلع بلون المحل وستايله، مش باللون
  // الافتراضي — وإلا التطبيق المثبّت يفتح بشكل مختلف عن الموقع.
  let accent = safeAccent(DEFAULT_DATA.brand.accent);
  let background = "#08090b";
  let language = DEFAULT_DATA.brand.language;
  try {
    const menu = await getMenu();
    logo = menu.brand.logo.trim();
    storeName = menu.brand.storeName.trim() || storeName;
    accent = safeAccent(menu.brand.accent);
    background = menu.brand.theme === "light" ? "#ffffff" : "#08090b";
    language = menu.brand.language;
  } catch {
    // A storage outage must not make the PWA manifest unavailable.
  }

  // مع وجود لوجو بنستخدمه مباشرة، ومن غيره في أيقونة متجر بلون الأكسنت
  // بتتولد من /icon — فالتطبيق دايماً قابل للتثبيت بأيقونة على البراند.
  const icons: MetadataRoute.Manifest["icons"] = logo
    ? [
        { src: logo, sizes: "192x192", purpose: "any" },
        { src: logo, sizes: "512x512", purpose: "any" },
        { src: logo, sizes: "512x512", purpose: "maskable" },
      ]
    : [
        { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ];

  return {
    name: storeName,
    short_name: storeName.slice(0, 24),
    description: "كتالوج منتجات تفاعلي للطلب السريع عبر واتساب",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: background,
    theme_color: accent,
    lang: language,
    dir: language === "en" ? "ltr" : "rtl",
    icons,
  };
}
