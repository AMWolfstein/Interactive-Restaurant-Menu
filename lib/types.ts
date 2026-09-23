/**
 * نماذج بيانات المتجر المشتركة بين الواجهة والباك إند.
 */

export type SiteLanguage = "ar" | "en";
export type ThemeMode = "dark" | "light";
/**
 * أنواع الطلب المتاحة: المحل مفيهوش طاولات — العميل بيستلم من المحل ويمشي،
 * أو يطلب توصيل لباب البيت. (نوع «من داخل المحل» اتشال لأن مفيش قعدة)
 */
export type OrderType = "delivery" | "pickup";

/**
 * حالة الطلب — بتتحدث من لوحة التحكم.
 * أي طلب جه من الموقع هيتنفذ (توصيل أو استلام من المحل)، فمفيش «مؤكد»
 * ولا «تم التسليم» — الحالة الوحيدة اللي الأدمن بيغيّرها هي «ملغي» لما
 * يلغي الطلب بنفسه (وممكن يرجّعه جديد).
 * الطلبات القديمة المحفوظة بحالة confirmed/delivered بتتعامل كـ «new»
 * تلقائياً عند القراءة (شوف orderStatusOf في lib/format.ts).
 */
export type OrderStatus = "new" | "cancelled";

export interface Category {
  id: string;
  name: string;
  nameEn?: string;
  emoji?: string;
  visible: boolean;
}

export interface MenuVariant {
  id: string;
  label: string;
  price: number;
  oldPrice?: number | null;
  offerEndDay?: number | null;
  offerEndMonth?: number | null;
  offerEndYear?: number | null;
}

export interface Supplier {
  id: string;
  name: string;
  visible: boolean;
}

export interface HeroImage {
  id: string;
  image: string;
  order: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  /** وقت إنشاء المنتج — يستخدم لترتيب «الأحدث» في واجهة العميل */
  createdAt?: string;
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
  /** تاريخ انتهاء العرض — محفوظ كأرقام اليوم والشهر والسنة، ويختاره الأدمن من التقويم */
  offerEndDay?: number | null;
  offerEndMonth?: number | null;
  offerEndYear?: number | null;
  /** عدد مرات طلب المنتج، يُحدّث تلقائياً عند إكمال الطلب */
  salesCount?: number;
  /** رابط صورة أو dataURL مرفوعة من الجهاز */
  image?: string;
  variants?: MenuVariant[];
  available: boolean;
  isNew: boolean;
  /** 0 = عادي (الافتراضي)، 1 = حار، 2 = نباتي */
  // الاسم محفوظ للتوافق مع بيانات المتجر القديمة، ويظهر في اللوحة كـ «الصفة الغذائية».
  spicy: 0 | 1 | 2;
}

export interface BrandSettings {
  storeName: string;
  storeNameEn: string;
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
  heroImages?: HeroImage[];
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
  tiktok: string;
  openingHours: string;
  /** فتح/قفل المحل يدوياً من الأدمين */
  isOpen: boolean;
  /** لما يكون مفعّل، حالة المحل بتتحسب أوتوماتيك من weeklySchedule */
  autoSchedule: boolean;
  /** جدول مواعيد العمل الأسبوعي — 7 أيام (0 = الأحد … 6 = السبت) */
  weeklySchedule: WeekDaySchedule[];
  closedMessage: string;
  footerNote: string;
}

/** مواعيد يوم واحد في جدول المحل — وقت "HH:MM" بصيغة 24 ساعة */
export interface WeekDaySchedule {
  /** 0 = الأحد … 6 = السبت (نفس ترتيب Date.getDay) */
  day: number;
  enabled: boolean;
  open: string;
  close: string;
}

/** منطقة توصيل برسوم وحد أدنى خاصين بيها */
export interface DeliveryZone {
  id: string;
  name: string;
  fee: number;
  /** حد أدنى للطلب في المنطقة دي — 0 = من غير حد */
  minimumOrder: number;
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
  /** مناطق توصيل برسوم مختلفة — لما تكون مفعّلة العميل يختار منطقته في السلة */
  enableZones: boolean;
  deliveryZones: DeliveryZone[];
  /** طرق الدفع المتاحة — فاضية = الخاصية مقفولة */
  paymentMethods: string[];
  /** شكل عرض المنتجات: قائمة تفصيلية أو شبكة */
  productLayout: "list" | "grid";
  /** عدد أعمدة شبكة المنتجات على شاشات الموبايل: ٢ أو ٣ فقط */
  mobileGridColumns: 2 | 3;
  enableFeatured: boolean;
  featuredLabel: string;
  enableConfetti: boolean;
  showPrices: boolean;
  /** يقفل السلة خالص (معرض فقط بدون طلب) */
  enableCart: boolean;
  /** بادئة رقم الطلب — مثال: BF ← BF-7K4P2. فاضية = تتحسب من اسم المحل */
  orderPrefix: string;
  /** نظام «كاشك» — مكافأة الولاء على إجمالي مشتريات العميل */
  loyalty: LoyaltySettings;
}

/**
 * إعدادات نظام «كاشك»: لما مشتريات العميل توصل `threshold` ياخد خصم
 * `percent`٪ على الفاتورة اللي بعدها، والرصيد يتخصم منه الحد (الزيادة تترحّل).
 */
export interface LoyaltySettings {
  enabled: boolean;
  /** اسم النظام زي ما بيظهر للعميل — «كاشك» */
  label: string;
  /** العتبة بالجنيه (٥٠٠٠) — الرصيد بيتجمّع من قيمة الأصناف فقط */
  threshold: number;
  /** نسبة الخصم (٥٪) */
  percent: number;
}

/** لقطة مكافأة كاشك المسجّلة داخل الطلب — ثابتة زي باقي أسعار الفاتورة */
export interface LoyaltySnapshot {
  /** قيمة الخصم بالجنيه على الطلب ده */
  discount: number;
  percent: number;
  threshold: number;
  /** رصيد العميل قبل الطلب */
  balanceBefore: number;
  /** رصيده بعده (المرحّل + قيمة الطلب ده) */
  balanceAfter: number;
}

/** ملف عميل في نظام كاشك — مفتاحه رقم الموبايل بصيغة موحّدة */
export interface CustomerRecord {
  /** رقم الموبايل منسّق: 01012345678 */
  phone: string;
  name: string;
  /** الرصيد الجاري ناحية العتبة */
  spent: number;
  /** إجمالي كل المشتريات على طول (مش بيتصفّر) */
  lifetime: number;
  ordersCount: number;
  /** عدد مرات استخدام المكافأة */
  rewardsUsed: number;
  /** إجمالي الخصومات اللي اتصرفت */
  discountTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface MenuData {
  version: number;
  updatedAt: string;
  brand: BrandSettings;
  contact: ContactSettings;
  commerce: CommerceSettings;
  categories: Category[];
  suppliers: Supplier[];
  items: MenuItem[];
}

/** طلب مسجّل في الباك إند قبل فتح رسالة واتساب */
export interface SavedOrder {
  id: string;
  createdAt: string;
  customer: { name: string; phone: string; address: string; notes: string };
  orderType: OrderType;
  lines: Array<{ itemId: string; name: string; quantity: number; unitPrice: number }>;
  total: number;
  /** لقطة الحساب وقت الطلب — الفاتورة بتستخدمها بدل إعادة الحساب من الأسعار الحالية */
  subtotal?: number;
  deliveryFee?: number;
  serviceFee?: number;
  /** عملة المحل وقت الطلب */
  currency?: string;
  /** حالة الطلب — الطلبات القديمة (قبل الميزة) بتتعامل كـ "new" */
  status?: OrderStatus;
  statusUpdatedAt?: string;
  /** اسم منطقة التوصيل المختارة (لو الطلب توصيل بمناطق مفعّلة) */
  zoneName?: string;
  /** طريقة الدفع اللي اختارها العميل */
  paymentMethod?: string;
  /** لقطة خصم «كاشك» لو العميل كان مستحق وقت الطلب */
  loyalty?: LoyaltySnapshot;
}

export interface AdminOverview {
  orders: SavedOrder[];
  storage: { driver: "supabase" | "file"; persistent: boolean };
}

/** السلة بتخزّن المعرّف والكمية فقط، وكل حاجة تانية بتتاشتق من البيانات الحالية */
export interface CartLine {
  itemId: string;
  variantId?: string;
  quantity: number;
}
