# 🛍️ Interactive Store Catalog — Full Stack (Next.js + Supabase)

تطبيق كتالوج منتجات لمحل، عربي **Full Stack**: واجهة عملاء RTL + لوحة تحكم + باك إند حقيقي يحفظ
الكتالوج والطلبات في قاعدة بيانات Supabase (Postgres).

## المميزات

- كتالوج RTL سريع ومتجاوب: بحث، أقسام، سلة، وإرسال الطلب على واتساب برقم طلب حقيقي.
- **دخول لوحة التحكم حصرياً بـ Supabase Auth (إيميل + باسورد)** من الحساب الموجود في
  `Authentication → Users`. مفيش أي دخول محلي أو رقم سري في المشروع.
- كل API خاص بالأدمن بيتحقق من **Supabase access token على السيرفر** — أي طلب من غير توكن صالح بيرجع `401`.
- رفع صور المنتجات إلى Cloudinary مع الاسم والوصف والسعر والوزن والمورد.
- سعر قديم وجديد مع حساب نسبة الخصم تلقائياً وعداد اختياري يُدخل باليوم والشهر والسنة.
- قسم «الأكثر مبيعاً» يُرتّب تلقائياً من بيانات الطلبات الفعلية، بدون ترتيب يدوي.
- واجهة وإعدادات عربية فقط، مع مفضلة محفوظة على جهاز الزائر وإمكانية إعادة آخر طلب بضغطة واحدة.
- اختيار من لوحة التحكم بين العرض التفصيلي الحالي أو شبكة من 3 منتجات، مع تصفية كل منتجات المورد بالضغط على اسمه.
- تسجيل الطلب قبل فتح رسالة واتساب، مع سجل للطلبات داخل لوحة التحكم.
- حفظ لحظي مركزي: تعديل الأدمن يظهر لكل العملاء على كل الأجهزة.

## الباك إند

| المسار | الوصف | الصلاحيات |
| --- | --- | --- |
| `GET /api/menu` | قراءة الكتالوج | عام |
| `PUT /api/menu` | حفظ الكتالوج | أدمن (Supabase token) |
| `POST /api/orders` | تسجيل الطلب قبل فتح رسالة واتساب | عام |
| `GET /api/admin/overview` | سجل الطلبات + حالة التخزين | أدمن (Supabase token) |
| `GET /api/admin/session` | التحقق من جلسة الأدمن على السيرفر | أدمن (Supabase token) |

التحقق من التوكن بيتم في `lib/server-auth.ts` بمخاطبة `SUPABASE_URL/auth/v1/user`،
والبيانات بتتحفظ عن طريق `lib/server-database.ts`.

## قاعدة البيانات

نفّذ [`supabase/schema.sql`](supabase/schema.sql) مرة واحدة في Supabase → SQL Editor.
الملف بينشئ:

- `catalog_data` — الكتالوج (قراءة عامة، كتابة للأدمن).
- `orders` — الطلبات (قراءة للأدمن).
- `place_order(payload jsonb)` — دالة `SECURITY DEFINER` تتحقق من المنتجات والأسعار وتسجّل الطلب بدون أي متابعة للمخزون.
- تفعيل **Supabase Realtime** على الجداول (`alter publication supabase_realtime add table ...`)
  عشان التحديث اللحظي يوصل فوراً لكل الأجهزة عبر WebSocket.

> **بداية ببيانات فارغة:** بيانات البداية لا تحتوي على أي أقسام أو منتجات — أدخل أقسامك ومنتجاتك من لوحة التحكم.

> **التحديث اللحظي:** تعديلات الكتالوج والطلبات الجديدة بتوصل فوراً عن طريق Supabase Realtime، مع فحص دوري احتياطي لو الاتصال انقطع.

> لحد ما تنفّذ الملف، الموقع بيشتغل على ملف مؤقت للتطوير، وتظهر لك لافتة حمراء في لوحة
> التحكم تطلب تنفيذ الـ schema.

## متغيرات البيئة

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=store-catalog
```

القيم متظبطة في **Vercel → Project Settings → Environment Variables**.
المشروع بيستخدم مفتاح `anon` العام فقط — **مفيش `service_role` في أي مكان في الكود**.

### إعداد Cloudinary للصور

1. من Cloudinary افتح **Settings → Upload → Upload presets**.
2. أنشئ preset من نوع **Unsigned** ويفضّل تقييده بملفات الصور وبحد أقصى 5MB.
3. أضف اسم الـ cloud والـ preset في متغيرات البيئة الموضحة فوق.
4. أعد نشر المشروع. بعدها رفع اللوجو وصورة الغلاف وصور المنتجات من لوحة التحكم
   يرفعها مباشرةً إلى Cloudinary ويحفظ رابط `https` فقط بدل تخزين الصورة داخل بيانات الكتالوج.

> اسم الـ cloud والـ unsigned preset قيم عامة مصممة للاستخدام من المتصفح؛ لا تضف
> `API Secret` أو `API Key` إلى متغيرات تبدأ بـ `NEXT_PUBLIC_`.

## التشغيل محلياً

```bash
npm install
cp .env.example .env.local   # وحط قيم مشروعك في Supabase
npm run dev
```

- الموقع: `http://localhost:3000`
- لوحة التحكم: `http://localhost:3000/admin` — بالإيميل والباسورد بتوع يوزر Supabase.

## التحقق

```bash
npm run lint
npm run build
```
