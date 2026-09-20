import type { Metadata } from "next";
import { QrStudio } from "@/components/public/qr-studio";

export const metadata: Metadata = {
  title: "كود QR للمتجر",
  robots: { index: false, follow: false },
};

export default function QrPage() {
  return <QrStudio />;
}
