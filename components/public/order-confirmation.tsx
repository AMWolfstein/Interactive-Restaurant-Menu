"use client";

import Link from "next/link";
import { CircleCheck, Send } from "lucide-react";
import { useOrderReceipt } from "@/lib/checkout-session";
import { formatPrice, pick } from "@/lib/format";
import { useMenu } from "@/lib/use-menu";

export function OrderConfirmation() {
  const receipt = useOrderReceipt();
  const { data: { brand, commerce } } = useMenu();
  const lang = brand.language;
  const en = lang === "en";
  const saved = typeof receipt?.id === "string" && Number.isFinite(receipt.total);
  const number = typeof receipt?.whatsappNumber === "string" ? receipt.whatsappNumber.replace(/\D/g, "") : "";
  const message = en
    ? `Order number: ${receipt?.id}\nPlease confirm my order with ${pick(lang, brand.storeName, brand.storeNameEn)}.`
    : `رقم الطلب: ${receipt?.id}\nيرجى تأكيد طلبي مع ${brand.storeName}.`;

  return (
    <main className="flex flex-1 items-center justify-center bg-bg px-4 py-10 text-ink">
      <section className="w-full max-w-md space-y-5 rounded-card border border-line bg-surface p-5 text-center sm:p-7">
        {saved && receipt ? (
          <>
            <CircleCheck aria-hidden="true" className="mx-auto h-10 w-10 text-emerald-500" />
            <h1 className="text-xl font-black">{en ? "Order saved" : "تم تسجيل طلبك"}</h1>
            <dl className="space-y-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{en ? "Order number" : "رقم الطلب"}</dt>
                <dd className="font-mono font-black" dir="ltr">{receipt.id}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{en ? "Total" : "الإجمالي"}</dt>
                <dd className="font-black">
                  {formatPrice(receipt.total, lang, { ...commerce, currency: receipt.currency || commerce.currency })}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted">
              {en ? "Send the order number to the store on WhatsApp to confirm it." : "ابعت رقم الطلب للمحل على واتساب عشان تأكده."}
            </p>
            {number ? (
              <a
                href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500"
              >
                <Send aria-hidden="true" className="h-4 w-4" />
                {en ? "Open WhatsApp" : "افتح واتساب"}
              </a>
            ) : null}
          </>
        ) : (
          <h1 className="text-lg font-black">
            {receipt === undefined
              ? (en ? "Order confirmation" : "تأكيد الطلب")
              : (en ? "No order confirmation in this tab" : "مفيش تأكيد طلب في التبويب ده")}
          </h1>
        )}
        <Link href="/" className="inline-block rounded-xl px-4 py-2 text-sm font-bold text-accent hover:underline">
          {en ? "Back to the catalog" : "الرجوع للكتالوج"}
        </Link>
      </section>
    </main>
  );
}
