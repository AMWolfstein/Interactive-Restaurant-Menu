import type { Metadata } from "next";
import { OrderConfirmation } from "@/components/public/order-confirmation";

export const metadata: Metadata = {
  title: "تأكيد الطلب",
  robots: { index: false, follow: false },
};

export default function OrderConfirmationPage() {
  return <OrderConfirmation />;
}
