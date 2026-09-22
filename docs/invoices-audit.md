# Phase 1 — تقرير فحص المشروع (قبل أي تعديل)

## 1) البنية العامة
- **Next.js 16 (App Router) + React 19 + Tailwind 4 + TypeScript**، منشور على Vercel.
- الصفحات: `/` (الستورفرونت), `/menu` (بوستر للطباعة), `/qr`, `/admin` (لوحة كاملة).
- API Routes تحت `app/api/**` كلها `runtime = "nodejs"` و `dynamic = "force-dynamic"`.

## 2) قاعدة البيانات (Supabase) — `supabase/schema.sql`
| الجدول | الوصف |
|---|---|
| `catalog_data(slug, data jsonb)` | صف واحد `slug='main'` فيه كل الكتالوج والإعدادات (`brand`, `contact`, `commerce`, `items`…) |
| `orders(id text pk, created_at, data jsonb)` | **جدول الطلبات الوحيد** — الطلب كله (بما فيه snapshot الأسعار) في `data` |
| `catalog_backups`, `push_subscriptions` | service_role فقط |

- دوال DB: `place_order(payload jsonb)` (SECURITY DEFINER, متاحة لـ anon) و `update_order_status(order_id, status)` (authenticated فقط).
- **snapshot الأسعار موجود فعلاً**: `data.lines[] = { itemId, name, quantity, unitPrice }` + `total` — يعني الفاتورة تتبني من الطلب نفسه من غير أي إعادة حساب من المنتجات الحالية. ✅
- **Realtime موجود**: `orders` و `catalog_data` مضافين في publication `supabase_realtime` + `replica identity full`، و`lib/realtime.ts` فيه `subscribeRealtime()` جاهز ومستخدم في لوحة الأدمن.

## 3) رقم الطلب (قبل التعديل)
`place_order` كان بيولّد: `ORD-` + 10 حروف من UUID (مثال `ORD-9F3A17B2C4`) — فريد لكنه طويل وصعب القراءة/الإملاء على التليفون. الطلبات القديمة بتفضل كما هي.

## 4) المصادقة والصلاحيات (قبل التعديل)
- **Supabase Auth (إيميل/باسورد)** فقط — `lib/supabase-auth-core.ts` في المتصفح، والتوكن بيتبعت في `Authorization: Bearer` لكل `/api/admin/*`، والسيرفر بيتحقق منه عند `/auth/v1/user` (`lib/server-auth.ts` مع كاش 15 ثانية).
- **مفيش roles إطلاقاً**: أي مستخدم مسجّل = أدمن كامل.
- RLS: `orders` قراءة لأي `authenticated`؛ `catalog_data` **كتابة لأي `authenticated`** ← ده كان هيخلي أي موظف يقدر يعدّل المنتجات/الأسعار مباشرة من Supabase REST لو أداله حساب.

## 5) تدفق إنشاء الطلب الحالي
`CartSheet` → `POST /api/orders` (rate limit 5/دقيقة) → `createOrder()` في `lib/server-database.ts` (تعقيم + فحص مواعيد المحل + مناطق التوصيل + **إعادة حساب الإجمالي على السيرفر**) → `rpc/place_order` → صف في `orders` → ثم كان بيفتح `wa.me` برسالة القالب الكاملة (كل المنتجات والأسعار).
- سائق احتياطي للتطوير المحلي: ملف JSON (`lib/server-database.ts`) بنفس المنطق.

## 6) حالات الطلب الموجودة
كانت `new | confirmed | delivered | cancelled` وقت المراجعة، وبعدها اتبسّطت إلى `new | cancelled` (`lib/types.ts` + `ORDER_STATUS_LABEL` في `lib/format.ts` + `update_order_status` في DB): أي طلب جه من الموقع هيتنفذ (توصيل أو استلام)، ف«مؤكد» و«تم التسليم» اتشالوا، والإجراء الوحيد هو الإلغاء (أو إرجاع الملغي جديد). الطلبات القديمة بحالة confirmed/delivered بتتعامل كـ `new` عند القراءة.

## 7) مكونات UI الموجودة والمعاد استخدامها
`components/ui.tsx` (Button, Panel, TextInput, Segmented, Badge, Toast…)، `lib/use-menu.tsx` (بيانات المحل من السيرفر)، `lib/realtime.ts`، `lib/format.ts` (`formatPrice`, `ORDER_STATUS_LABEL`, `toWhatsappNumber`)، `lib/alerts.ts` (نغمة + وميض عنوان التاب).

## 8) الخلاصة — ما تم إعادة استخدامه vs. ما أُضيف
**أعيد استخدامه:** جدول `orders` نفسه، `place_order`/`update_order_status`, Supabase Auth, Realtime, API الطلبات، حالات الطلب، مكونات الـUI، حساب الأسعار من الـsnapshot.
**أُضيف:** رقم طلب قصير (`BF-7K4P2`)، دور `invoice_staff` في `app_metadata` + فرضه على السيرفر والـRLS، صفحة `/invoices` + API خاص بها، ومولّد فاتورة PNG/طباعة/مشاركة.
