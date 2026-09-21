import type { Metadata } from "next";
import { Storefront } from "@/components/public/storefront";
import { DEFAULT_DATA } from "@/lib/defaults";
import { pick } from "@/lib/format";
import { isItemOnOffer } from "@/lib/offers";
import { getMenu } from "@/lib/server-database";
import { absoluteSiteUrl } from "@/lib/site-url";
import type { MenuData } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * نفس لقطة الكتالوج المستخدمة في الـ layout (getMenu متجمّعة بـ React cache)،
 * فالـ SEO والواجهة والهوية كلهم متسقين في نفس الطلب.
 */
async function menuForSeo(): Promise<MenuData> {
  try {
    return await getMenu();
  } catch {
    // لا نجعل مشكلة مؤقتة في قاعدة البيانات تمنع عرض واجهة العميل أو الـ SEO الأساسي.
    return DEFAULT_DATA;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const menu = await menuForSeo();
  const name = pick(menu.brand.language, menu.brand.storeName, menu.brand.storeNameEn).trim() || "كتالوج المتجر";
  const description = pick(menu.brand.language, menu.brand.tagline, menu.brand.taglineEn).trim()
    || "تصفح المنتجات والأسعار واطلب بسهولة عبر واتساب.";
  const canonical = absoluteSiteUrl("/");

  return {
    title: `${name} | اطلب أونلاين`,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title: name,
      description,
      type: "website",
      locale: "ar_EG",
      url: canonical,
      images: menu.brand.logo ? [{ url: menu.brand.logo, alt: name }] : undefined,
    },
  };
}

export default async function HomePage() {
  const menu = await menuForSeo();
  const siteUrl = absoluteSiteUrl("/");
  const name = pick(menu.brand.language, menu.brand.storeName, menu.brand.storeNameEn);
  const offers = menu.items
    .filter((item) => item.available)
    .slice(0, 100)
    .map((item) => ({
      "@type": "Offer",
      price: item.price,
      priceCurrency: menu.commerce.currencyEn || "EGP",
      availability: "https://schema.org/InStock",
      ...(isItemOnOffer(item) && item.oldPrice ? { priceValidUntil: item.offerEndYear && item.offerEndMonth && item.offerEndDay ? `${item.offerEndYear}-${String(item.offerEndMonth).padStart(2, "0")}-${String(item.offerEndDay).padStart(2, "0")}` : undefined } : {}),
      itemOffered: {
        "@type": "Product",
        name: pick(menu.brand.language, item.name, item.nameEn),
        description: pick(menu.brand.language, item.description, item.descriptionEn) || undefined,
        image: item.image || undefined,
        category: menu.categories.find((category) => category.id === item.categoryId)?.name,
      },
    }));
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Store",
    name,
    description: pick(menu.brand.language, menu.brand.tagline, menu.brand.taglineEn),
    telephone: menu.contact.phone || undefined,
    url: siteUrl,
    image: menu.brand.logo || undefined,
    address: menu.contact.address || undefined,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "كتالوج المنتجات",
      itemListElement: offers,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // JSON stringify with < escaped prevents a product name from closing the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <Storefront />
    </>
  );
}
