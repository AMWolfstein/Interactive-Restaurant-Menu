import type { MetadataRoute } from "next";
import { getMenu } from "@/lib/server-database";

// The manifest depends on settings saved by the owner, so it must not be
// frozen at build time or served with an old logo after the brand is updated.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let logo = "";
  try {
    logo = (await getMenu()).brand.logo.trim();
  } catch {
    // A storage outage must not make the PWA manifest unavailable.
  }

  const icons: MetadataRoute.Manifest["icons"] = logo
    ? [
        { src: logo, sizes: "192x192", purpose: "any" },
        { src: logo, sizes: "512x512", purpose: "any" },
        { src: logo, sizes: "512x512", purpose: "maskable" },
      ]
    : undefined;

  return {
    name: "كتالوج المتجر الذكي",
    short_name: "كتالوج المتجر",
    description: "كتالوج منتجات تفاعلي للطلب السريع عبر واتساب",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#08090b",
    theme_color: "#f59e0b",
    lang: "ar",
    dir: "rtl",
    icons,
  };
}
