import type { MenuData } from "./types";

/**
 * بيانات البداية (seed) اللي بتتحط في قاعدة البيانات أول مرة بس.
 * بعد كده مصدر الحقيقة هو الباك إند: أي تعديل من لوحة التحكم بيتحفظ في
 * جدول Supabase (أو ملف التطوير المحلي) ومنه بيقرأ كل العملاء.
 */
export const DEFAULT_DATA: MenuData = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  brand: {
    storeName: "محل البركة",
    storeNameEn: "El Baraka Store",
    tagline: "أفضل المنتجات بأحسن سعر",
    taglineEn: "Best products at the best price",
    logo: "",
    accent: "#f59e0b",
    theme: "dark",
    radius: 16,
    font: "cairo",
    language: "ar",
    showHero: true,
    heroImage: "/images/catalog/hero.jpg",
    heroImages: [],
    heroTitle: "كل اللي محتاجه… في مكان واحد 🛒",
    heroSubtitle: "اختار منتجاتك واطلبها في دقيقتين — وهتوصلك لباب البيت",
    announcementEnabled: true,
    announcementText: "🚚 توصيل مجاني للطلبات فوق ٣٠٠ ج.م — الكود: BARAKA",
  },
  contact: {
    whatsapp: "201000000000",
    phone: "0100 000 0000",
    address: "٢٧ شارع التسعين، التجمع الخامس، القاهرة",
    mapUrl: "https://maps.google.com/?q=Tasheen+St+Cairo",
    instagram: "https://instagram.com/",
    facebook: "",
    openingHours: "يومياً من ١٠ صباحاً حتى ١٢ منتصف الليل",
    isOpen: true,
    closedMessage: "المحل مقفل حالياً.. اطلب بكرة الصبح 🌙",
    footerNote: "كل منتجاتنا مختارة بعناية وجودتها مضمونة — نورتنا 🛍️",
  },
  commerce: {
    currency: "ج.م",
    currencyEn: "EGP",
    deliveryFee: 25,
    freeDeliveryOver: 300,
    minimumOrder: 80,
    serviceChargePercent: 0,
    orderTypes: ["delivery", "pickup", "instore"],
    requireName: true,
    requirePhone: true,
    requireAddress: true,
    enableNotes: true,
    enableSearch: true,
    productLayout: "list",
    enableFeatured: true,
    featuredLabel: "الأكثر مبيعاً ⭐",
    enableConfetti: true,
    showPrices: true,
    enableCart: true,
    orderTemplate: [
      "*طلب جديد — {storeName}* 🛍️",
      "",
      "👤 *العميل:* {name}",
      "📞 *الموبايل:* {phone}",
      "🧾 *نوع الطلب:* {orderType}",
      "{addressLine}",
      "",
      "*تفاصيل الطلب:*",
      "{items}",
      "",
      "📝 *ملاحظات:* {notes}",
      "💰 *الإجمالي:* {total}",
    ].join("\n"),
  },
  categories: [],
  suppliers: [],
  items: [],
};

/** مفتاح سلة العميل في متصفح الزائر — السلة بتتحول لطلب مسجّل في الباك إند */
export const CART_KEY = "store-catalog:cart:v1";
