import type { Metadata } from "next";
import { MenuPoster } from "@/components/public/menu-poster";

export const metadata: Metadata = {
  title: "الكتالوج القابل للطباعة",
  description: "قائمة منتجات وأسعار قابلة للطباعة أو الحفظ PDF.",
};

export default function MenuPage() {
  return <MenuPoster />;
}
