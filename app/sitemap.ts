import type { MetadataRoute } from "next";
import { getMenu } from "@/lib/server-database";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  // بلا رابط منشور حقيقي، لا نضع localhost أو رابط معاينة في Google.
  if (!base) return [];

  let lastModified = new Date();
  try {
    const menu = await getMenu();
    const saved = new Date(menu.updatedAt);
    if (!Number.isNaN(saved.getTime())) lastModified = saved;
  } catch {
    // sitemap أساسي أفضل من خطأ 500 لو قاعدة البيانات غير متاحة مؤقتاً.
  }

  return [
    { url: new URL("/", base).toString(), lastModified, changeFrequency: "daily", priority: 1 },
    { url: new URL("/menu", base).toString(), lastModified, changeFrequency: "weekly", priority: 0.6 },
  ];
}
