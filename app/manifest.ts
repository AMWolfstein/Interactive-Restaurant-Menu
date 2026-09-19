import type { MetadataRoute } from "next";
import { getMenu } from "@/lib/server-database";

// The manifest depends on settings saved by the owner, so it must not be
// frozen at build time or served with an old logo after the brand is updated.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FALLBACK_ICONS: NonNullable<MetadataRoute.Manifest["icons"]> = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let logo = "";
  try {
    logo = (await getMenu()).brand.logo.trim();
  } catch {
    // A storage outage must not make the PWA manifest unavailable.
  }

  const icons: NonNullable<MetadataRoute.Manifest["icons"]> = logo
    ? [
        { src: logo, sizes: "192x192", purpose: "any" },
        { src: logo, sizes: "512x512", purpose: "any" },
        { src: logo, sizes: "512x512", purpose: "maskable" },
      ]
    : FALLBACK_ICONS;

  return {
    name: "قائمة المطعم الذكية",
    short_name: "قائمة المطعم",
    description: "قائمة مطعم تفاعلية للطلب السريع عبر واتساب",
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
