"use client";

import { History } from "lucide-react";
import type { CartLine, SiteLanguage } from "@/lib/types";

export const PREVIOUS_ORDER_KEY = "restaurant-menu:previous-order:v1";

export function PreviousOrderButton({
  language,
  validItemIds,
  onRestore,
  onOpenCart,
}: {
  language: SiteLanguage;
  validItemIds: Set<string>;
  onRestore: (lines: CartLine[]) => void;
  onOpenCart: () => void;
}) {
  const en = language === "en";
  const restore = () => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(PREVIOUS_ORDER_KEY) ?? "[]") as CartLine[];
      const lines = Array.isArray(parsed) ? parsed.filter((line) => validItemIds.has(line.itemId)) : [];
      if (!lines.length) {
        window.alert(en ? "No previous order was found." : "مفيش طلب سابق محفوظ على الجهاز ده.");
        return;
      }
      onRestore(lines);
      onOpenCart();
    } catch {
      window.alert(en ? "Could not restore the previous order." : "تعذّر استرجاع الطلب السابق.");
    }
  };

  return (
    <button
      type="button"
      onClick={restore}
      title={en ? "Reorder" : "إعادة الطلب السابق"}
      aria-label={en ? "Reorder" : "إعادة الطلب السابق"}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition hover:border-accent/60 hover:text-accent"
    >
      <History className="h-4 w-4" />
    </button>
  );
}
