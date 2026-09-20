import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { GOOGLE_FONTS_HREF } from "@/lib/fonts";

import { SiteTheme } from "@/components/site-theme";

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

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" data-theme="dark" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body className="flex min-h-full flex-col">
        <SiteTheme />
        {children}
      </body>
    </html>
  );
}
