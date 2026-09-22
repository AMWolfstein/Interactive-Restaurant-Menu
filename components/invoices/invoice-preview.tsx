"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  LoaderCircle,
  MessageCircle,
  Printer,
  Share2,
  X,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { orderStatusOf, ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, toWhatsappNumber } from "@/lib/format";
import {
  canShareInvoiceFile,
  invoiceFileName,
  invoiceModelFromOrder,
  renderInvoiceCanvas,
  type InvoiceBrandInfo,
} from "@/lib/invoice-render";
import type { SavedOrder } from "@/lib/types";
import { Button } from "@/components/ui";

/**
 * معاينة الفاتورة + أزرار التحميل والطباعة والمشاركة.
 *
 * الرسم كله بيتم في lib/invoice-render.ts (Canvas) — الكمبوننت ده مسؤول
 * عن العرض والتفاعل بس، فنفس المولّد ينفع يتنادى من أي مكان تاني.
 */
export function InvoicePreview({
  order,
  onClose,
}: {
  order: SavedOrder;
  onClose: () => void;
}) {
  const { data } = useMenu();
  const { brand, contact, commerce } = data;

  const holderRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const brandInfo = useMemo<InvoiceBrandInfo>(
    () => ({
      storeName: brand.storeName || brand.storeNameEn || "فاتورة",
      logo: brand.logo || undefined,
      phone: contact.phone || undefined,
      address: contact.address || undefined,
      currency: commerce.currency,
      accent: brand.accent,
      footerNote: contact.footerNote,
    }),
    [brand, contact, commerce.currency],
  );

  const model = useMemo(
    () =>
      invoiceModelFromOrder(order, {
        orderTypeLabel: ORDER_TYPE_LABEL[order.orderType]?.ar ?? order.orderType,
        statusLabel: ORDER_STATUS_LABEL[orderStatusOf(order)].ar,
      }),
    [order],
  );

  // نولّد الفاتورة مرة واحدة لما الطلب يتفتح — نفس الصورة بتتحمّل وتتشارك وتتطبع
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const generate = () => {
      renderInvoiceCanvas(model, brandInfo)
        .then((canvas) => {
          if (cancelled) return;
          // معاينة مرنة داخل الشاشة
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          holderRef.current?.replaceChildren(canvas);
          canvas.toBlob((result) => {
            if (cancelled || !result) return;
            objectUrl = URL.createObjectURL(result);
            setBlob(result);
            setPreviewUrl(objectUrl);
            setStatus("ready");
          }, "image/png");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    };

    // الرسم بيبدأ بعد الرندر — مفيش setState متزامن جوه الـeffect
    const kick = window.setTimeout(generate, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(kick);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [model, brandInfo]);

  const file = useMemo(
    () => (blob ? new File([blob], invoiceFileName(order.id), { type: "image/png" }) : null),
    [blob, order.id],
  );
  const shareSupported = file ? canShareInvoiceFile(file) : false;
  const caption = `فاتورة طلبك رقم ${order.id} من ${brandInfo.storeName}.`;

  const download = () => {
    if (!previewUrl) return;
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = invoiceFileName(order.id);
    link.click();
    setMessage("تم تحميل الفاتورة على الجهاز");
  };

  const print = () => {
    if (!previewUrl) return;
    // نافذة طباعة نظيفة فيها الصورة بس — منها ممكن تختار «حفظ كـ PDF»
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "-10000px";
    frame.style.width = "0";
    frame.style.height = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${order.id}</title><style>@page{margin:10mm}body{margin:0}img{width:100%}</style></head><body><img src="${previewUrl}" alt="" /></body></html>`,
    );
    doc.close();
    const run = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1000);
    };
    if (frame.contentWindow?.document.readyState === "complete") run();
    else frame.onload = run;
  };

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text: caption, title: `فاتورة ${order.id}` });
    } catch (error) {
      // إلغاء المستخدم للمشاركة مش خطأ
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("تعذّرت المشاركة — حمّل الفاتورة وابعتها يدوياً");
    }
  };

  // fallback نصي بس: واتساب مش بيقبل إرفاق صورة من الرابط، فالموظف بيرفقها بنفسه
  const whatsappHref = (() => {
    const number = toWhatsappNumber(order.customer?.phone || contact.whatsapp);
    const text = encodeURIComponent(`فاتورة الطلب ${order.id} جاهزة.`);
    return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
  })();

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm" dir="rtl">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 cursor-default" />

      <div className="relative m-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl2 border border-line bg-bg">
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-black">فاتورة الطلب</p>
            <p dir="ltr" className="truncate font-mono text-xs text-accent">#{order.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الفاتورة"
            className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-surface-2/40 p-3">
          {status === "loading" ? (
            <p className="flex items-center justify-center gap-2 p-12 text-xs font-bold text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> جاري توليد الفاتورة…
            </p>
          ) : null}
          {status === "error" ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-xs font-bold text-red-300">
              تعذّر توليد الفاتورة على المتصفح ده — جرّب متصفح تاني أو استخدم الطباعة.
            </p>
          ) : null}
          <div ref={holderRef} className="overflow-hidden rounded-xl shadow-lg" />
        </div>

        <footer className="space-y-2 border-t border-line bg-bg p-3">
          {message ? <p className="text-center text-[11px] font-bold text-accent">{message}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            {shareSupported ? (
              <Button size="lg" onClick={() => void share()} disabled={status !== "ready"} className="col-span-2">
                <Share2 className="h-4 w-4" /> مشاركة الفاتورة
              </Button>
            ) : null}

            <Button variant="outline" onClick={download} disabled={status !== "ready"}>
              <Download className="h-4 w-4" /> تحميل PNG
            </Button>
            <Button variant="outline" onClick={print} disabled={status !== "ready"}>
              <Printer className="h-4 w-4" /> طباعة / PDF
            </Button>

            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener"
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-400 transition hover:bg-emerald-500/20"
            >
              <MessageCircle className="h-4 w-4" /> فتح واتساب
            </a>
          </div>

          <p className="text-center text-[10px] leading-relaxed text-muted/70">
            {shareSupported
              ? "«مشاركة» بتفتح قائمة المشاركة بتاعة الجهاز — اختار واتساب والعميل من هناك."
              : "الجهاز ده مش بيدعم مشاركة الملفات — حمّل الصورة وارفقها في واتساب يدوياً."}
          </p>
        </footer>
      </div>
    </div>
  );
}
