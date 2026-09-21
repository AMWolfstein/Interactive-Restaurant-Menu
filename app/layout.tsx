import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { GOOGLE_FONTS_HREF } from "@/lib/fonts";
import { DEFAULT_DATA } from "@/lib/defaults";
import { getMenu } from "@/lib/server-database";
import { readableOn, safeAccent } from "@/lib/color";
import { MenuProvider } from "@/lib/use-menu";
import { VISITOR_THEME_KEY } from "@/lib/theme";
import type { MenuData } from "@/lib/types";

import { SiteTheme } from "@/components/site-theme";

// إعدادات المحل بتتقري من قاعدة البيانات مع كل زيارة، فالصفحة متتجمّدش
// وقت البناء ومتترسمش ببيانات قديمة.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "كتالوج المتجر الذكي | اطلب على واتساب",
  description:
    "كتالوج متجر متكامل لعرض المنتجات والأسعار واستقبال الطلبات عبر واتساب.",
  applicationName: "Smart Store Catalog",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "كتالوج المتجر",
  },
  openGraph: {
    title: "كتالوج المتجر الذكي",
    description: "اطلب بدقيقتين والطلب يوصلك على باب البيت 🛍️",
    type: "website",
    locale: "ar_EG",
  },
};

export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: safeAccent((await menuForLayout()).brand.accent),
    width: "device-width",
    initialScale: 1,
  };
}

async function menuForLayout(): Promise<MenuData> {
  try {
    return await getMenu();
  } catch {
    // انقطاع مؤقت في قاعدة البيانات ما يمنعش الموقع من الفتح.
    return DEFAULT_DATA;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const menu = await menuForLayout();
  const { brand } = menu;
  const accent = safeAccent(brand.accent);
  const language = brand.language === "en" ? "en" : "ar";

  return (
    <html
      // سكربت الستايل بيعدّل data-theme قبل الهيدريشن حسب اختيار الزائر،
      // فبنسكّت تحذير الاختلاف المقصود ده على الوسم ده بس.
      suppressHydrationWarning
      lang={language}
      dir={language === "en" ? "ltr" : "rtl"}
      // الستايل واللون والخط بيتحطوا من السيرفر على وسم html نفسه —
      // فالزائر بيشوف هوية المحل الحقيقية من أول فريم من غير وميض
      // للشكل الافتراضي القديم.
      data-theme={brand.theme === "light" ? "light" : "dark"}
      data-font={brand.font || "cairo"}
      style={
        {
          "--accent": accent,
          "--accent-contrast": readableOn(accent),
          "--radius": `${brand.radius}px`,
        } as React.CSSProperties
      }
      className="h-full antialiased"
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
        {brand.logo ? (
          <>
            <link rel="icon" href={brand.logo} />
            <link rel="apple-touch-icon" href={brand.logo} />
          </>
        ) : null}
        <script
          // اختيار الزائر للستايل (أسود/أبيض) محفوظ على جهازه — بنطبقه قبل أول
          // رسم للصفحة عشان ما يحصلش وميض من ستايل المحل لستايل الزائر.
          dangerouslySetInnerHTML={{
            __html: `try{if(!location.pathname.startsWith("/admin")){var t=localStorage.getItem("${VISITOR_THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <MenuProvider initialData={menu}>
          <SiteTheme />
          {children}
        </MenuProvider>
      </body>
    </html>
  );
}
