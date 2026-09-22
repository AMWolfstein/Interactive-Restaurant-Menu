"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowRight, Download, Printer, QrCode } from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { ProductImage } from "@/components/public/product-card";

function filePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "store";
}

export function QrStudio() {
  const { data } = useMenu();
  const { brand } = data;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const nextUrl = window.location.origin;
    const frame = window.requestAnimationFrame(() => setUrl(nextUrl));
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, nextUrl, {
        width: 720,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#101827", light: "#ffffff" },
      }).catch(() => window.setTimeout(() => setError("تعذّر إنشاء كود QR. حدّث الصفحة وحاول مرة أخرى."), 0));
    }
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${filePart(brand.storeName)}-qr.png`;
    link.click();
  };

  return (
    <main className="min-h-screen bg-bg px-4 py-8 text-ink sm:py-12" dir="rtl">
      <div className="print:hidden mx-auto mb-4 flex max-w-md items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted transition hover:text-ink">
          <ArrowRight className="h-3.5 w-3.5" /> العودة للصفحة الرئيسية
        </Link>
      </div>

      <section className="mx-auto w-full max-w-md rounded-xl2 border border-line bg-surface p-5 text-center shadow-[0_22px_70px_-45px_rgba(0,0,0,.8)] sm:p-8" id="qr-card">
        <div className="print:hidden mx-auto mb-4 flex w-fit items-center gap-2 rounded-full bg-accent/12 px-3 py-1.5 text-xs font-black text-accent">
          <QrCode className="h-4 w-4" /> كود QR للطباعة
        </div>
        <div className="mx-auto flex w-fit max-w-full items-center justify-center gap-3">
          {brand.logo ? <ProductImage src={brand.logo} alt="" className="h-12 w-12 rounded-xl border border-line" /> : null}
          <div className="text-start">
            <h1 className="text-xl font-black">{brand.storeName}</h1>
            {brand.tagline ? <p className="mt-0.5 text-xs text-muted">{brand.tagline}</p> : null}
          </div>
        </div>
        <p className="mt-5 text-sm font-bold">امسح الكود لتصفح الكتالوج والطلب مباشرة</p>

        <div className="mx-auto mt-5 w-fit rounded-2xl border border-line bg-white p-3 shadow-sm">
          <canvas ref={canvasRef} className="h-56 w-56 max-w-full sm:h-64 sm:w-64" aria-label="رمز QR للمتجر" />
        </div>
        {url ? <p dir="ltr" className="mt-4 break-all text-[11px] text-muted">{url}</p> : null}
        {error ? <p className="mt-3 text-xs font-bold text-red-400">{error}</p> : null}

        <div className="print:hidden mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={download} className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-black text-accent-contrast transition hover:brightness-110">
            <Download className="h-4 w-4" /> تحميل PNG
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-xs font-black text-ink transition hover:border-accent/60">
            <Printer className="h-4 w-4" /> طباعة
          </button>
        </div>
      </section>
      <p className="print:hidden mx-auto mt-5 max-w-md text-center text-[11px] leading-relaxed text-muted">يُنشأ الكود محليًا من رابط الموقع المفتوح الآن؛ لا يتم إرسال الرابط إلى خدمة QR خارجية.</p>
    </main>
  );
}
