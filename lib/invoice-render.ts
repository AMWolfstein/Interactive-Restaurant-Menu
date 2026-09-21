/**
 * توليد الفاتورة كصورة PNG — رسم مباشر على Canvas من غير أي مكتبة خارجية.
 *
 * ليه Canvas مش html2canvas؟
 *   - مفيش dependency جديدة ولا حجم زيادة على الباندل.
 *   - النتيجة متطابقة على كل الأجهزة (مش متأثرة بستايل الصفحة ولا بالخطوط
 *     اللي لسه بتتحمّل)، والمقاس ثابت ومناسب لواتساب.
 *
 * البيانات كلها بتتاخد من لقطة الطلب نفسه (unitPrice و total المحفوظين وقت
 * الطلب) — مفيش أي إعادة حساب من أسعار المنتجات الحالية.
 */

import type { SavedOrder } from "./types";

export interface InvoiceBrandInfo {
  storeName: string;
  logo?: string;
  phone?: string;
  address?: string;
  currency: string;
  /** لون الهوية — بيتستخدم في الهيدر وخط الإجمالي */
  accent: string;
  footerNote?: string;
}

export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceModel {
  orderNumber: string;
  dateLabel: string;
  timeLabel: string;
  lines: InvoiceLine[];
  subtotal: number;
  /** رسوم التوصيل المحفوظة في الطلب (0 = متتعرضش) */
  deliveryFee: number;
  /** رسوم الخدمة المحفوظة في الطلب (0 = متتعرضش) */
  serviceFee: number;
  /** الخصم — موجب يعني بيتخصم */
  discount: number;
  total: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  orderTypeLabel: string;
  paymentMethod: string;
  zoneName: string;
  notes: string;
  statusLabel: string;
}

/**
 * يبني نموذج الفاتورة من الطلب المحفوظ.
 * لو الطلب قديم ومفيهوش subtotal، بنحسبه من سطور الطلب نفسها (مش من المنتجات).
 */
export function invoiceModelFromOrder(
  order: SavedOrder,
  options: { orderTypeLabel: string; statusLabel: string; locale?: string },
): InvoiceModel {
  const lines: InvoiceLine[] = (order.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.unitPrice * line.quantity,
  }));

  const linesTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const subtotal = typeof order.subtotal === "number" ? order.subtotal : linesTotal;
  const deliveryFee = typeof order.deliveryFee === "number" ? order.deliveryFee : 0;
  const serviceFee = typeof order.serviceFee === "number" ? order.serviceFee : 0;
  const total = typeof order.total === "number" ? order.total : subtotal + deliveryFee + serviceFee;
  // فرق موجب بين مجموع البنود والرسوم وبين الإجمالي المحفوظ = خصم
  const discount = Math.max(0, Math.round((subtotal + deliveryFee + serviceFee - total) * 100) / 100);

  const created = new Date(order.createdAt);
  const locale = options.locale ?? "ar-EG";

  return {
    orderNumber: order.id,
    dateLabel: created.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }),
    timeLabel: created.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    lines,
    subtotal,
    deliveryFee,
    serviceFee,
    discount,
    total,
    customerName: order.customer?.name?.trim() || "",
    customerPhone: order.customer?.phone?.trim() || "",
    customerAddress: order.customer?.address?.trim() || "",
    orderTypeLabel: options.orderTypeLabel,
    paymentMethod: order.paymentMethod?.trim() || "",
    zoneName: order.zoneName?.trim() || "",
    notes: order.customer?.notes?.trim() || "",
    statusLabel: options.statusLabel,
  };
}

/* ------------------------------------------------------------------ PNG */

const WIDTH = 820;
const PADDING = 48;
const SCALE = 2; // ريتينا — الصورة تفضل واضحة على واتساب

function money(value: number, currency: string): string {
  const rounded = Math.round(value * 100) / 100;
  const text = rounded.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${text} ${currency}`.trim();
}

async function loadLogo(source?: string): Promise<HTMLImageElement | null> {
  if (!source) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    // اللوجو مش شرط — لو الرفع فشل (CORS مثلاً) الفاتورة بتتولد من غيره
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

/** يرسم الفاتورة على canvas ويرجّعها — المقاس بيتحسب حسب عدد المنتجات */
export async function renderInvoiceCanvas(
  model: InvoiceModel,
  brand: InvoiceBrandInfo,
): Promise<HTMLCanvasElement> {
  const logo = await loadLogo(brand.logo);

  const rowHeight = 46;
  // بنرسم على كانفس طويل بالزيادة وبعدين نقص عند آخر محتوى بالظبط، فالفاتورة
  // بتطلع مضبوطة مهما كان عدد المنتجات وطول الملاحظات — من غير فراغ تحت.
  const maxHeight =
    520 + model.lines.length * rowHeight + 4 * 38 + (model.notes ? 140 : 0) + 260;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = Math.ceil(maxHeight) * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("المتصفح ده مش بيدعم توليد الصور");
  ctx.scale(SCALE, SCALE);
  const height = maxHeight;

  const accent = brand.accent || "#0ea5e9";
  const ink = "#0f172a";
  const muted = "#64748b";
  const line = "#e2e8f0";
  const font = (size: number, weight = "400") =>
    `${weight} ${size}px "Cairo", "Segoe UI", system-ui, -apple-system, sans-serif`;

  // خلفية بيضاء — الفاتورة لازم تطبع وتتقري على واتساب في الوضعين
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  // شريط الهوية
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, WIDTH, 8);

  let y = 56;

  // الهيدر: اللوجو + اسم المحل
  if (logo) {
    const size = 76;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PADDING, y - 8, size, size, 18);
    ctx.clip();
    ctx.drawImage(logo, PADDING, y - 8, size, size);
    ctx.restore();
  }

  const headerX = logo ? PADDING + 96 : PADDING;
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = font(34, "800");
  ctx.fillText(brand.storeName, headerX, y + 26);

  const contactBits = [brand.phone, brand.address].filter(Boolean).join(" • ");
  if (contactBits) {
    ctx.fillStyle = muted;
    ctx.font = font(15);
    ctx.fillText(truncate(ctx, contactBits, WIDTH - headerX - PADDING), headerX, y + 52);
  }

  // رقم الفاتورة والتاريخ (يمين)
  ctx.textAlign = "right";
  ctx.fillStyle = accent;
  ctx.font = font(24, "800");
  ctx.fillText(`#${model.orderNumber}`, WIDTH - PADDING, y + 4);
  ctx.fillStyle = muted;
  ctx.font = font(15);
  ctx.fillText(`${model.dateLabel} — ${model.timeLabel}`, WIDTH - PADDING, y + 30);
  ctx.fillText(`${model.orderTypeLabel} • ${model.statusLabel}`, WIDTH - PADDING, y + 54);

  y += 108;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(WIDTH - PADDING, y);
  ctx.stroke();
  y += 30;

  // بيانات العميل
  const hasCustomerBlock = Boolean(model.customerName || model.customerPhone || model.customerAddress || model.zoneName || model.paymentMethod);
  if (hasCustomerBlock) {
    ctx.textAlign = "left";
    ctx.fillStyle = muted;
    ctx.font = font(14, "700");
    ctx.fillText("بيانات العميل", PADDING, y);
    y += 26;
    ctx.fillStyle = ink;
    ctx.font = font(17, "600");
    const parts = [model.customerName, model.customerPhone].filter(Boolean).join("  •  ");
    if (parts) {
      ctx.fillText(truncate(ctx, parts, WIDTH - PADDING * 2), PADDING, y);
      y += 26;
    }
    if (model.customerAddress) {
      ctx.fillStyle = muted;
      ctx.font = font(15);
      ctx.fillText(truncate(ctx, model.customerAddress, WIDTH - PADDING * 2), PADDING, y);
      y += 24;
    }
    const meta = [model.zoneName, model.paymentMethod].filter(Boolean).join("  •  ");
    if (meta) {
      ctx.fillStyle = muted;
      ctx.font = font(15);
      ctx.fillText(meta, PADDING, y);
      y += 24;
    }
    y += 12;
  }

  // ترويسة الجدول
  const colQty = WIDTH - PADDING - 250;
  const colUnit = WIDTH - PADDING - 130;
  const colTotal = WIDTH - PADDING;

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(PADDING, y - 4, WIDTH - PADDING * 2, 44);
  ctx.fillStyle = muted;
  ctx.font = font(14, "700");
  ctx.textAlign = "left";
  ctx.fillText("المنتج", PADDING + 14, y + 24);
  ctx.textAlign = "right";
  ctx.fillText("الكمية", colQty, y + 24);
  ctx.fillText("سعر الوحدة", colUnit, y + 24);
  ctx.fillText("الإجمالي", colTotal - 14, y + 24);
  y += 62;

  // سطور المنتجات
  for (const item of model.lines) {
    ctx.fillStyle = ink;
    ctx.font = font(17, "600");
    ctx.textAlign = "left";
    ctx.fillText(truncate(ctx, item.name, colQty - PADDING - 80), PADDING + 14, y);

    ctx.textAlign = "right";
    ctx.font = font(16);
    ctx.fillStyle = muted;
    ctx.fillText(`×${item.quantity}`, colQty, y);
    ctx.fillText(money(item.unitPrice, brand.currency), colUnit, y);
    ctx.fillStyle = ink;
    ctx.font = font(17, "700");
    ctx.fillText(money(item.lineTotal, brand.currency), colTotal - 14, y);

    y += 14;
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(PADDING + 14, y);
    ctx.lineTo(WIDTH - PADDING - 14, y);
    ctx.stroke();
    y += rowHeight - 14;
  }

  y += 10;

  // المجاميع
  const totalsRow = (label: string, value: string, options: { strong?: boolean; tone?: string } = {}) => {
    ctx.textAlign = "right";
    ctx.fillStyle = options.tone ?? muted;
    ctx.font = font(options.strong ? 18 : 16, options.strong ? "700" : "600");
    ctx.fillText(label, colUnit, y);
    ctx.fillStyle = options.tone ?? (options.strong ? ink : muted);
    ctx.font = font(options.strong ? 18 : 16, "700");
    ctx.fillText(value, colTotal - 14, y);
    y += 38;
  };

  totalsRow("المجموع", money(model.subtotal, brand.currency));
  if (model.deliveryFee > 0) totalsRow("التوصيل", money(model.deliveryFee, brand.currency));
  if (model.serviceFee > 0) totalsRow("الخدمة", money(model.serviceFee, brand.currency));
  if (model.discount > 0) totalsRow("الخصم", `- ${money(model.discount, brand.currency)}`, { tone: "#059669" });

  y += 6;
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  ctx.roundRect(PADDING, y - 8, WIDTH - PADDING * 2, 62, 16);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = font(22, "800");
  ctx.fillText("الإجمالي", PADDING + 20, y + 32);
  ctx.textAlign = "right";
  ctx.fillStyle = accent;
  ctx.font = font(26, "800");
  ctx.fillText(money(model.total, brand.currency), WIDTH - PADDING - 20, y + 32);
  y += 92;

  // الملاحظات
  if (model.notes) {
    ctx.textAlign = "left";
    ctx.fillStyle = muted;
    ctx.font = font(14, "700");
    ctx.fillText("ملاحظات", PADDING, y);
    y += 24;
    ctx.fillStyle = ink;
    ctx.font = font(15);
    y = wrapText(ctx, model.notes, PADDING, y, WIDTH - PADDING * 2, 22, 2);
    y += 18;
  }

  // الفوتر بيتحط بعد آخر محتوى مباشرةً، والارتفاع النهائي بيتحدد منه
  const footerY = y + 34;
  const finalHeight = Math.ceil(footerY + 46);

  ctx.textAlign = "center";
  ctx.fillStyle = muted;
  ctx.font = font(16, "600");
  ctx.fillText(brand.footerNote?.trim() || "شكراً لتعاملكم معنا 🙏", WIDTH / 2, footerY);

  ctx.fillStyle = accent;
  ctx.fillRect(0, finalHeight - 8, WIDTH, 8);

  // القص على الارتفاع الحقيقي
  const output = document.createElement("canvas");
  output.width = WIDTH * SCALE;
  output.height = finalHeight * SCALE;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) throw new Error("المتصفح ده مش بيدعم توليد الصور");
  outputCtx.drawImage(
    canvas,
    0,
    0,
    WIDTH * SCALE,
    finalHeight * SCALE,
    0,
    0,
    WIDTH * SCALE,
    finalHeight * SCALE,
  );

  return output;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const words = text.split(/\s+/);
  let current = "";
  let lines = 0;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      ctx.fillText(current, x, y);
      y += lineHeight;
      lines += 1;
      current = word;
      if (lines >= maxLines) {
        ctx.fillText(truncate(ctx, current, maxWidth), x, y);
        return y + lineHeight;
      }
    } else {
      current = candidate;
    }
  }
  if (current) {
    ctx.fillText(truncate(ctx, current, maxWidth), x, y);
    y += lineHeight;
  }
  return y;
}

/** يحوّل الفاتورة لـ Blob صورة PNG */
export async function renderInvoicePng(
  model: InvoiceModel,
  brand: InvoiceBrandInfo,
): Promise<Blob> {
  const canvas = await renderInvoiceCanvas(model, brand);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("تعذّر توليد صورة الفاتورة"));
    }, "image/png");
  });
}

export function invoiceFileName(orderNumber: string): string {
  return `invoice-${orderNumber.replace(/[^A-Za-z0-9-]/g, "")}.png`;
}

/** هل المتصفح يقدر يشارك ملف الصورة نفسه؟ (أندرويد غالباً أيوه، ديسكتوب غالباً لأ) */
export function canShareInvoiceFile(file: File): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
