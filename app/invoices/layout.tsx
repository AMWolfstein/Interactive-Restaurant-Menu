import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "الفواتير",
  // شاشة داخلية للموظفين — متتفهرستش في جوجل
  robots: { index: false, follow: false },
};

export default function InvoicesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
