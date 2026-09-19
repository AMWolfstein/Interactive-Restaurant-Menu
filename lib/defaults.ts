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
    restaurantName: "مطعم البرجر الملكي",
    restaurantNameEn: "Royal Burger",
    tagline: "أسرع ديليفري وأعلى جودة",
    taglineEn: "Fastest delivery, best taste",
    logo: "",
    accent: "#f59e0b",
    theme: "dark",
    radius: 16,
    font: "cairo",
    language: "ar",
    showHero: true,
    heroImage: "/images/menu/hero.jpg",
    heroTitle: "طعم يخلّيك ترجع تاني 🔥",
    heroSubtitle: "اطلب بدقيقتين والطلب هيوصلك على باب البيت",
    announcementEnabled: true,
    announcementText: "🚚 توصيل مجاني للطلبات فوق ٣٠٠ ج.م — الكود: ROYAL",
  },
  contact: {
    whatsapp: "201000000000",
    phone: "0100 000 0000",
    address: "٢٧ شارع التسعين، التجمع الخامس، القاهرة",
    mapUrl: "https://maps.google.com/?q=Tasheen+St+Cairo",
    instagram: "https://instagram.com/",
    facebook: "",
    openingHours: "يومياً من ١٢ ظهراً حتى ٢ بعد منتصف الليل",
    isOpen: true,
    closedMessage: "المطعم مقفل حالياً.. اطلب بكرة الصبح 🌙",
    footerNote: "جميع الأصناف طازجة وتُحضّر عند الطلب — بالهنا والشفا 🍔",
  },
  commerce: {
    currency: "ج.م",
    currencyEn: "EGP",
    deliveryFee: 25,
    freeDeliveryOver: 300,
    minimumOrder: 80,
    serviceChargePercent: 0,
    orderTypes: ["delivery", "takeaway", "dinein"],
    requireName: true,
    requirePhone: true,
    requireAddress: true,
    enableNotes: true,
    enableSearch: true,
    enableFeatured: true,
    featuredLabel: "الأكثر طلباً ⭐",
    enableConfetti: true,
    showPrices: true,
    enableCart: true,
    orderTemplate: [
      "*طلب جديد — {restaurantName}* 🍔",
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
  items: [],
};

/** مفتاح سلة العميل في متصفح الزائر — السلة بتتحول لطلب مسجّل في الباك إند */
export const CART_KEY = "royal-menu:cart:v1";
