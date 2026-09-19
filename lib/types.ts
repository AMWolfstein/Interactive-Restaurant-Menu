/**
 * نماذج بيانات المطعم المشتركة بين الواجهة والباك إند.
 */

export type SiteLanguage = "ar" | "en";
export type ThemeMode = "dark" | "light";
export type OrderType = "delivery" | "takeaway" | "dinein";

export interface Category {
  id: string;
  name: string;
  nameEn?: string;
  emoji?: string;
  visible: boolean;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  /** الوزن أو حجم العبوة، مثال: 1 كجم */
  weight?: string;
  /** اسم المورد المصري */
  supplier?: string;
  price: number;
  /** السعر قبل الخصم — لو موجود يظهر مشطوب مع نسبة توفير */
  oldPrice?: number | null;
  /** تاريخ انتهاء العرض — يُدخل كاليوم والشهر والسنة */
  offerEndDay?: number | null;
  offerEndMonth?: number | null;
  offerEndYear?: number | null;
  /** عدد مرات طلب المنتج، يُحدّث تلقائياً عند إكمال الطلب */
  salesCount?: number;
  /** رابط صورة أو dataURL مرفوعة من الجهاز */
  image?: string;
  available: boolean;
  isNew: boolean;
  /** 0 = بارد (الافتراضي)، 1 = حار */
  spicy: 0 | 1;
}

export interface BrandSettings {
  restaurantName: string;
  restaurantNameEn: string;
  tagline: string;
  taglineEn: string;
  logo: string;
  accent: string;
  theme: ThemeMode;
  /** انحناء الحواف بالبيكسل */
  radius: number;
  /** مفتاح الخط من FONT_OPTIONS */
  font: string;
  language: SiteLanguage;
  showHero: boolean;
  heroImage: string;
  heroTitle: string;
  heroSubtitle: string;
  announcementEnabled: boolean;
  announcementText: string;
}

export interface ContactSettings {
  whatsapp: string;
  phone: string;
  address: string;
  mapUrl: string;
  instagram: string;
  facebook: string;
  openingHours: string;
  /** فتح/قفل المطعم يدوياً من الأدمين */
  isOpen: boolean;
  closedMessage: string;
  footerNote: string;
}

export interface CommerceSettings {
  currency: string;
  currencyEn: string;
  deliveryFee: number;
  /** صفر = ملغيش (التوصيل المجاني معطّل) */
  freeDeliveryOver: number;
  /** صفر = من غير حد أدنى للطلب */
  minimumOrder: number;
  serviceChargePercent: number;
  orderTypes: OrderType[];
  requireName: boolean;
  requirePhone: boolean;
  requireAddress: boolean;
  enableNotes: boolean;
  enableSearch: boolean;
  /** شكل عرض المنتجات: قائمة تفصيلية أو شبكة من 3 أعمدة */
  productLayout: "list" | "grid";
  enableFeatured: boolean;
  featuredLabel: string;
  enableConfetti: boolean;
  showPrices: boolean;
  /** يقفل السلة خالص (معرض فقط بدون طلب) */
  enableCart: boolean;
  /** قالب رسالة واتساب */
  orderTemplate: string;
}

export interface MenuData {
  version: number;
  updatedAt: string;
  brand: BrandSettings;
  contact: ContactSettings;
  commerce: CommerceSettings;
  categories: Category[];
  items: MenuItem[];
}

/** طلب مسجّل في الباك إند قبل فتح رسالة واتساب */
export interface SavedOrder {
  id: string;
  createdAt: string;
  customer: { name: string; phone: string; address: string; table: string; notes: string };
  orderType: OrderType;
  lines: Array<{ itemId: string; name: string; quantity: number; unitPrice: number }>;
  total: number;
}

export interface AdminOverview {
  orders: SavedOrder[];
  storage: { driver: "supabase" | "file"; persistent: boolean };
}

/** السلة بتخزّن المعرّف والكمية فقط، وكل حاجة تانية بتتاشتق من البيانات الحالية */
export interface CartLine {
  itemId: string;
  quantity: number;
}

export interface Totals {
  subtotal: number;
  delivery: number;
  service: number;
  total: number;
  itemCount: number;
}
