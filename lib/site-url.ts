/** رابط الموقع المنشور للـ canonical و sitemap. لا نستخدم localhost أو دومين المعاينة. */
export function getSiteUrl(): URL | null {
  const value = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function absoluteSiteUrl(path = "/"): string | undefined {
  const base = getSiteUrl();
  return base ? new URL(path, base).toString() : undefined;
}
