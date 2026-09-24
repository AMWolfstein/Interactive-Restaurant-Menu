# تقرير الـ Full Audit — Interactive Restaurant Menu

**تاريخ الفحص:** 2026-09-23
**الفرع:** `arena/01a0ce07-interactive-restaurant-menu` (من `main` @ `a497dcb`)
**حجم الكود:** ~15,900 سطر عبر 108 ملف (TS/TSX/SQL/CSS/JS)

---

## ١) ملخص سريع — النتيجة العامة

| الفحص | النتيجة |
|---|---|
| `npm ci` | ✅ نجح (335 حزمة) |
| `npx tsc --noEmit` (typecheck) | ✅ **صفر أخطاء** |
| `npx eslint .` | ✅ **صفر errors وصفر warnings** |
| `npm run build` | ✅ نجح — 23 route اتبنوا في ~22 ثانية |
| `npm audit` | ✅ **صفر ثغرات** (info/low/moderate/high/critical كلها صفر) |
| ملفات ناقصة / imports مكسورة | ✅ مفيش |
| exports ميتة / dead code | ⚠️ واحد بس (تفاصيل تحت) |
| TODO / FIXME / `any` / `@ts-ignore` / `console.log` | ✅ **صفر** — الكود نضيف جداً |
| اختبارات آلية | ❌ **مفيش أي اختبارات ولا CI** |

**الخلاصة:** الكود في حالة ممتازة من ناحية الجودة والنظافة والتايب سيفتي. المشاكل الحقيقية اللي لقيتها **مش في الـ syntax أو الـ lint** — هي في **منطق التحقق على السيرفر** (server-side validation) وفي **توثيق ناقص**. أهم حاجة: فيه ٤ إعدادات تجارية بيتم فرضها في المتصفح بس والسيرفر بيتجاهلها تماماً.

---

## ٢) الـ Bugs — مرتبة بالأولوية

### 🔴 P0 — إعدادات تجارية بتتفرض في المتصفح بس (السيرفر بيتجاهلها)

دي أخطر حاجة في المشروع. الملفات: `lib/server-database.ts` (`createOrder`) و `supabase/schema.sql` (دالة `place_order`).

الاتنين بيتحققوا من: نوع الطلب، الكميات، توفّر المنتج، الجدول الأوتوماتيكي (`autoSchedule`)، ومناطق التوصيل. لكن **بيتجاهلوا** الإعدادات دي تماماً:

| الإعداد | مكان الفرض الحالي | نتيجة التجاهل |
|---|---|---|
| `commerce.minimumOrder` | `cart-sheet.tsx` (المتصفح) | العميل يبعت طلب بـ 100 ج والحد الأدنى 1000 ج |
| `contact.isOpen` (القفل اليدوي) | `cart-sheet.tsx` (المتصفح) | طلبات بتتسجّل والمحل مقفول يدوياً |
| `commerce.orderTypes` | `cart-sheet.tsx` (المتصفح) | طلب `delivery` بيعدّي حتى لو الأدمن قافل التوصيل |
| `commerce.enableCart` | `cart-sheet.tsx` (المتصفح) | طلبات بتتسجّل والسلة متقفلة خالص (وضع معرض فقط) |
| `zone.minimumOrder` | `cart-sheet.tsx` (المتصفح) | تخطّي الحد الأدنى للمنطقة |
| `requireName` / `requirePhone` / `requireAddress` | `cart-sheet.tsx` (المتصفح) | طلب توصيل من غير عنوان ولا اسم |

**إثبات عملي** — عملت الاختبار ده فعلاً على السيرفر المحلي:

```jsonc
// الإعدادات: isOpen=false, orderTypes=["pickup"], minimumOrder=1000
POST /api/orders
{"lines":[{"itemId":"i_test1","quantity":1}], "orderType":"delivery",
 "total":125, "customer":{"name":"Attacker","phone":"01099999999"}}

→ HTTP 201  ❌  (المفروض 409 أو 400)
{"order":{"id":"SC-72529","orderType":"delivery","total":125,...}}
```

وكمان مع `enableCart=false`:
```
POST /api/orders → HTTP 201 ❌ (السلة مفروض متقفلة خالص)
```

المفارقة إن `autoSchedule` **متحقق منه صح** على السيرفر (سطر 278 في `server-database.ts`)، بينما `isOpen` اليدوي مش متحقق منه — فالحماية نص نص.

> ملحوظة مطمئنة: **الأسعار والإجماليات آمنة تماماً.** السيرفر بيعيد حساب كل حاجة من الكتالوج الحقيقي ويتجاهل `total` الجاي من العميل (`computeServerTotals`)، وخصم كاشك بيتحسب في الداتابيز جوه transaction مع قفل صف العميل (`for update`). التلاعب في الأسعار مستحيل — المشكلة في الإعدادات التجارية بس.

**الإصلاح المقترح:** إضافة التحققات دي في مكانين (عشان السائقين الاتنين):
1. في `createOrder` بـ `lib/server-database.ts` قبل `placeOrder()`
2. في دالة `place_order` في `supabase/schema.sql` (المصدر الحقيقي في الإنتاج)

---

### 🟠 P1 — `rate-limit` في الذاكرة مش شغّال على Vercel

`lib/rate-limit.ts` بيخزّن الـ buckets في `Map` في الذاكرة. الكومنت نفسه في الملف مقرّ بالمشكلة، بس المشروع منشور على Vercel (serverless) — يعني:

- كل lambda instance ليه Map منفصل
- الـ instances بتموت وترجع باستمرار (cold starts)
- فعلياً الحد «5 طلبات/دقيقة» ممكن يبقى 5 × عدد الـ instances

كمان `setInterval` للتنظيف (سطر 11) بيتنفذ في module scope — في serverless ده هدر بسيط ومش مضمون يشتغل.

**التأثير:** حماية ضعيفة ضد spam الطلبات وضد تخمين أرقام الموبايل عبر `/api/loyalty` (اللي معموله rate limit مخصوص عشان كده بالظبط).

**الحل:** Upstash Redis / Vercel KV، أو على الأقل نقل الحد لداخل دالة `place_order` في Postgres (تعتمد على `created_at` في جدول `orders` لنفس الرقم/IP).

---

### 🟠 P1 — `checkInvoiceStaff` مبتفلترش أي دور

```ts
// lib/server-auth.ts:124
export async function checkInvoiceStaff(token: string | null): Promise<AdminCheck> {
  return checkSession(token);   // ← بيرجّع أي مستخدم مسجّل، من غير أي فحص دور
}
```

الاسم والكومنت اللي فوقها بيقولوا «الأدمن أو موظف الفواتير»، لكن الكود بيقبل **أي حساب Supabase مسجّل**. حالياً مش ثغرة خطيرة لأن `roleOf()` بيرجّع `admin` لأي دور غير معروف، فالنتيجة عملياً واحدة. لكن:

- لو حد ضاف دور تالت في المستقبل (`kitchen` مثلاً) هيدخل `/invoices` تلقائياً من غير ما حد ياخد باله
- الفرق بين اسم الدالة وسلوكها فخ للي هيعدّل الكود بعدين

**الحل:** إما تحقق صريح `["admin","invoice_staff"].includes(role)`، أو إعادة تسمية الدالة لـ `checkAnySession` مع تعديل الكومنت.

---

### 🟡 P2 — Regex مكسور في تحويل بيانات Menyu القديمة

```ts
// lib/normalize.ts:155
whatsapp: String(restaurant.phone ?? "").replace(/\\D/g, ""),
```

الـ backslash مزدوج بالغلط. `/\\D/g` معناها «backslash حرفي متبوع بحرف D» — مش «أي حاجة مش رقم» (`/\D/g`).

**النتيجة:** رقم الواتساب بيتنقل من الـ backup القديم بمسافاته و `+` بتاعته، مثال `"+20 101 234 5678"` بيفضل زي ما هو بدل ما يبقى `"201012345678"`.

اختبرته:
```js
"+20 101 234".replace(/\\D/g,"")  →  "+20 101 234"   ❌
"+20 101 234".replace(/\D/g,"")   →  "20101234"      ✅
```

كل الأماكن التانية في المشروع (`format.ts:276`, `loyalty.ts:33`) مكتوبة صح — دي حالة واحدة شاذة. التأثير محدود (بيأثر على استيراد Menyu بس) و`toWhatsappNumber` بيصلّحها جزئياً وقت العرض، بس الداتا المخزّنة بتبقى متسخة.

---

### 🟡 P2 — عكس أثر كاشك عند الإلغاء فيه اختلاف بين السائقين

في `update_order_status` (SQL, سطر 596) وفي `setOrderStatus` (TS, سطر 491):

```sql
rewards_used = greatest(0, rewards_used + case
                 when v_loyalty is null then 0
                 when p_status = 'cancelled' then -1 else 1 end),
discount_total = greatest(0, discount_total
                 + case when p_status='cancelled' then -1 else 1 end
                 * coalesce((v_loyalty ->> 'discount')::numeric, 0)),
```

استخدام `greatest(0, ...)` بيمنع القيم السالبة، بس كمان **بيخفي عدم الاتساق**: لو الأدمن لغى طلب ورجّعه «جديد» أكتر من مرة، أو لغى طلبات بترتيب مختلف عن ترتيب تسجيلها، الرصيد ممكن ينحرف عن القيمة الصحيحة من غير أي إنذار.

نفس المنطق في `nextBalance` مقابل `computeLoyaltyDiscount`: لما العميل يصرف مكافأة، `balanceAfter = (balance - threshold) + subtotal`. عند الإلغاء `delta = subtotal - threshold` — ده صح رياضياً، بس بيفترض إن `threshold` ما اتغيّرش من يوم الطلب. لو الأدمن غيّر العتبة من ٥٠٠٠ لـ ٣٠٠٠، الإلغاء هيرجّع ٥٠٠٠ (المحفوظة في الـ snapshot) — ده صح فعلاً، بس الـ snapshot موجود في الطلبات الجديدة بس.

**الحل المقترح:** بدل الحساب التفاضلي (incremental)، عمل دالة `recompute_customer_balance(phone)` بتعيد حساب الرصيد من كل الطلبات غير الملغية للعميل. تتنادى بعد كل تغيير حالة. أبطأ شوية لكن مستحيل تنحرف.

---

### 🟡 P2 — Service Worker بيكاش الصفحة الرئيسية لكل مسار

```js
// public/sw.js:43-54
if (request.mode === "navigate") {
  event.respondWith(fetch(request)
    .then((response) => { ...cache.put("/", copy); })   // ← دايماً بيحفظ تحت "/"
    .catch(() => caches.match("/")));                    // ← دايماً بيرجّع "/"
}
```

المفتاح ثابت `"/"` مهما كان المسار المطلوب. يعني:
- الزائر يفتح `/menu` وهو أونلاين → الـ HTML بتاع `/menu` بيتخزّن تحت المفتاح `"/"` ويستبدل الصفحة الرئيسية المخزّنة
- بعدين ينقطع النت ويفتح `/` → هيشوف صفحة `/menu` (البوستر) بدل الستورفرونت

`/admin` و `/api/` مستثنيين (سطر 39) بس `/menu` و `/qr` و `/invoices` لأ.

**الحل:** مفتاح كاش منفصل لكل مسار، أو استثناء `/menu` و `/qr` و `/invoices` من الـ navigate caching زي `/admin` بالظبط.

---

### 🟡 P2 — `catalog_data` بيتحدّث مع كل طلب (كتابة زيادة)

```sql
-- schema.sql:537 — جوه place_order
update public.catalog_data
  set data = jsonb_set(v_menu, '{updatedAt}', to_jsonb(v_now_iso)), updated_at = v_now
  where slug = 'main';
```

كل طلب بيعيد كتابة **صف الكتالوج بالكامل** (كل المنتجات + كل الإعدادات + كل الصور لو dataURL) عشان يحدّث `salesCount` و `updatedAt`. والصف ده معمول له `select ... for update` في أول الدالة، يعني **قفل على الكتالوج كله طول مدة تسجيل أي طلب**.

التأثير:
1. **Serialization:** طلبين في نفس اللحظة بيتصفّوا ورا بعض — ما ينفعش يتنفذوا بالتوازي
2. **حجم الكتابة:** كتالوج ٢٠٠ منتج ممكن يبقى مئات الكيلوبايتات بتتعاد كتابتها مع كل طلب
3. **عاصفة Realtime:** الجدول في publication الـ realtime مع `replica identity full`، فكل طلب بيبعت **الكتالوج كله** لكل متصفح مفتوح. الكود عنده حماية (`SELF_ECHO_GUARD_MS` في `menu-store-core.ts`) بس الحمولة بتتبعت على الشبكة برضه

**الحل:** نقل `salesCount` لجدول منفصل (`item_sales(item_id, count)`) مع `UPSERT` بسيط، أو حسابه بـ view من جدول `orders` عند الطلب بدل ما يكون denormalized في الكتالوج.

---

### 🔵 P3 — نقط صغيرة

| # | الملاحظة | الملف |
|---|---|---|
| 1 | `export const CUSTOMERS_TABLE = "customers"` مش مستخدم في أي مكان — dead export | `lib/supabase.ts:30` |
| 2 | القيمة `driverCache` مالهاش invalidation صريح؛ لو schema اتنفذت والسيرفر شغال، بياخد لحد 60 ثانية عشان يعرف | `lib/server-database.ts:66` |
| 3 | حد الـ 500 طلب في سائق الملف بيقطع من الأول (`slice(-500)`) من غير أي تحذير للمستخدم | `lib/server-database.ts:444` |
| 4 | `void results;` سطر مالوش لازمة — `Promise.allSettled` نتيجته مش مستخدمة أصلاً | `lib/push-notifications.ts:67` |
| 5 | `getOrdersForInvoices` بيجيب **كل** حقول `AdminOverview` (بما فيها `storage`) وبعدين يرمي اللي مش محتاجه — استعلام زيادة | `lib/server-database.ts:509` |
| 6 | رسالة الخطأ بترجع للعميل مباشرة من `place_order` (السطر `error?.message` لو `status < 500`) — ممكن تسرّب نصوص داخلية من Postgres | `lib/supabase-store.ts:98` |

---

## ٣) الحاجات الناقصة (اللي مبقاش موجود / مكنش موجود أصلاً)

### ❌ مفيش أي اختبارات آلية — صفر
مفيش `vitest` ولا `jest` ولا `playwright` ولا حتى ملف `*.test.ts` واحد. ده أخطر نقص في المشروع لأن فيه **منطق مالي حسّاس مكرر في مكانين** (TypeScript + PL/pgSQL) لازم يفضلوا متطابقين:

- `computeServerTotals` (TS) ↔ حساب الإجمالي جوه `place_order` (SQL)
- `computeLoyaltyDiscount` / `nextBalance` (TS) ↔ منطق كاشك في `place_order` (SQL)
- `normalizePhone` (TS) ↔ `normalize_phone` (SQL)
- `generateOrderNumber` / `orderPrefixFrom` (TS) ↔ `generate_order_number` / `order_prefix_from_menu` (SQL)

أي تعديل في جنب من غير الجنب التاني = اختلاف صامت في الفواتير بين التطوير والإنتاج. مفيش حاجة حالياً بتمسك ده.

**الحد الأدنى المقترح:** Vitest + اختبارات وحدة لـ `format.ts`, `loyalty.ts`, `schedule.ts`, `offers.ts`, `order-number.ts`, `normalize.ts`, `validation.ts`. دي كلها دوال نقية (pure) — سهلة جداً في الاختبار ومفيهاش mocking.

### ❌ مفيش CI/CD
مفيش مجلد `.github/` خالص. يعني `lint` و `typecheck` و `build` بيتنفذوا يدوياً بس. أي PR ممكن يتدمج وهو مكسور.

**المقترح:** `.github/workflows/ci.yml` بسيط يشغّل `npm ci && npm run lint && npm run typecheck && npm run build` على كل push و PR.

### ✅ [اتحل] مفيش migration لآخر التغييرات في `schema.sql`
مجلد `supabase/migrations/` فيه ٣ ملفات:
- `2026-09-invoices.sql`
- `2026-09-loyalty-kashak.sql`
- `2026-09-simplify-order-status.sql`

لكن `schema.sql` فيه نسخة من `update_order_status` **أحدث** من اللي في `2026-09-simplify-order-status.sql` (النسخة اللي في schema بتعكس أثر كاشك عند الإلغاء، واللي في الـ migration لأ). أي حد عنده قاعدة بيانات شغالة ونفّذ الـ migrations بالترتيب **هيفضل عنده النسخة القديمة** اللي مش بتصحّح رصيد العميل عند الإلغاء.

**الحل المنفّذ:** مجلد `migrations/` اتشال بالكامل ودمجناه في `schema.sql` واحد idempotent — فمصدر الـdrift ده مبقاش موجود أصلاً. التفاصيل في قسم ٧ من [تقرير التنفيذ](fixes-2026-09.md).

### ⚠️ توثيق ناقص في README
جدول الـ API في `README.md` (سطور 50-60) فيه ٩ endpoints بس. الموجود فعلياً ١٤. الناقصين:

| Endpoint | موجود في الكود | في README |
|---|---|---|
| `POST /api/loyalty` | ✅ | ❌ |
| `GET /api/admin/customers` | ✅ | ❌ |
| `GET /api/admin/backups` | ✅ | ❌ |
| `POST /api/admin/backups` | ✅ | ❌ |
| `POST /api/push-subscription` | ✅ | ❌ |
| `DELETE /api/push-subscription` | ✅ | ❌ |

كمان `docs/invoices-audit.md` بيقول في القسم ٣ إن رقم الطلب هو `ORD-` + 10 حروف — ده **وصف للحالة قبل التعديل** والملف نفسه بيوضح ده بعدين، بس ممكن يلخبط اللي بيقرا بسرعة.

### ⚠️ مفيش `data/` seed ولا `.gitkeep`
سائق الملف المحلي بيكتب في `data/store.json`، والمجلد مش موجود في الريبو (بيتعمل تلقائياً بـ `fs.mkdir`). ده شغال صح فعلاً، بس `.gitignore` بيغطي `/data/*.json` و `/data/*.tmp` بس — لو حد حط أي ملف تاني هناك هيتعمله commit بالغلط.

---

## ٤) الـ Optimizations المقترحة

### 🚀 كبيرة الأثر

**1. إلغاء تحديث `catalog_data` مع كل طلب** (متفصّل فوق في P2)
أكبر مكسب أداء ممكن في المشروع. بيشيل قفل على الكتالوج + كتابة ضخمة + بث realtime زيادة، مع كل طلب.

**2. `/api/menu` GET بينده Supabase مرتين بالباطل**
```ts
// app/api/menu/route.ts:12-15
const token = bearerToken(request);
const check = await checkAdmin(token);          // ← نداء شبكة لـ Supabase
return NextResponse.json(await getMenu(check.ok ? token : null), ...);
```
الـ endpoint ده **عام** وبيتنده من كل زائر. لو الزائر مش معاه توكن، `bearerToken` بيرجّع `null` و`checkAdmin` بيرجّع فوراً — تمام. بس أي زائر يبعت أي هيدر `Authorization: Bearer xxx.yyy.zzz` شكله صح هيجبر السيرفر يعمل نداء شبكة لـ `/auth/v1/user`. الكاش السلبي (5 ثواني) بيخفّف بس مش بيمنع.

**الحل:** تخطّي `checkAdmin` خالص لو `token === null` (تعديل سطر واحد). التوكن مطلوب بس في حالة نادرة جداً (زرع بيانات البداية لأول مرة).

**3. تقليل الـ polling الزيادة**
فيه ٥ تايمرات شغالة بالتوازي في لوحة الأدمن:
| المكان | الفترة | الـ endpoint |
|---|---|---|
| `menu-store-core.ts:111` | 60 ث | `/api/menu` |
| `panel-dashboard.tsx:82` | 30 ث | `/api/admin/overview` |
| `panel-orders.tsx:100` | 30 ث | `/api/admin/overview` |
| `admin-app.tsx:313` | 60 ث | `/api/admin/overview` |
| `invoices-app.tsx:248` | 120 ث | `/api/invoices/orders` |

يعني لوحة الأدمن المفتوحة على تبويب الطلبات بتنده `/api/admin/overview` **٣ مرات كل ٣٠-٦٠ ثانية** من ٣ كمبوننتات مختلفة، وكل نداء بيجيب ٥٠٠ طلب كاملين. ودي كلها «شبكة أمان» للـ Realtime اللي شغّال أصلاً.

**الحل:** ستور مشترك واحد للـ overview (زي `menu-store-core` بالظبط) تقرا منه الكمبوننتات الـ ٣، مع تايمر واحد. أو على الأقل تعطيل الـ polling لما الـ Realtime channel حالته `SUBSCRIBED`.

**4. الطلبات: `limit=500` مالهاش pagination**
```ts
// lib/supabase-store.ts
`${ORDERS_TABLE}?select=id,created_at,data&order=created_at.desc&limit=500`
```
كل نداء لـ `/api/admin/overview` بيجيب ٥٠٠ طلب بكل الـ JSON بتاعهم (كل سطور المنتجات، بيانات العميل، snapshot الأسعار). محل بـ ٥٠ طلب/يوم = المحتوى ده بيتبعت كل ٣٠ ثانية × ٣ كمبوننتات.

**الحل:** pagination حقيقي (cursor على `created_at`)، أو نسخة مختصرة للقوائم (`id, created_at, customer->name, total, status` بس) والتفاصيل الكاملة عند فتح الطلب.

### 🚀 متوسطة

**5. `<img>` بدل `next/image` في ٧ أماكن**
كل واحدة معمولها `eslint-disable-next-line @next/next/no-img-element`. ده قرار واعي (الصور من Cloudinary ومن dataURL)، بس النتيجة إن المشروع بيضيّع: الـ lazy loading الذكي، وتحويل WebP/AVIF التلقائي، و`srcset` المتجاوب، وحجز المساحة (منع الـ layout shift).

**الحل:** إعداد `images.remotePatterns` لـ `res.cloudinary.com` في `next.config.ts` واستخدام `next/image` لصور المنتجات والـ hero على الأقل. الـ `<img>` يفضل للوجو والـ dataURL بس.

**6. `sizeOf()` بيعمل `Blob` + `JSON.stringify` مع كل تعديل**
```ts
// lib/menu-store-core.ts:109
const sizeOf = (data: MenuData) => Math.round(new Blob([JSON.stringify(data)]).size / 1024);
```
بيتنادى في كل `refreshMenu` وكل حفظ ناجح. مع كتالوج فيه صور dataURL ده ممكن يبقى megabytes بتتـstringify في الـ main thread. القيمة مستخدمة للعرض بس (`storageKb` في تبويب البيانات).

**الحل:** حسابه عند فتح تبويب «البيانات» بس، أو استخدام `TextEncoder().encode(...).length` (أسرع من `Blob`)، أو `debounce`.

**7. `getCustomerOrders` بتعمل full scan**
```sql
-- schema.sql
select * from public.orders
 where public.normalize_phone(data #>> '{customer,phone}') = public.normalize_phone(p_phone)
```
`normalize_phone` دالة على العمود ← أي index عادي مش هيشتغل. مع نمو جدول `orders` ده بيبقى sequential scan.

**الحل:** functional index:
```sql
create index if not exists orders_phone_idx
  on public.orders (public.normalize_phone(data #>> '{customer,phone}'));
```
(الدالة `immutable` بالفعل فده مسموح).

**8. `pruneCatalogBackups` بتتنادى بعد كل نسخة**
`createCatalogBackup` بتعمل `SELECT` لـ 100 صف + `DELETE` في كل مرة. مع نسخة واحدة يومياً ده مقبول، بس مع النسخ اليدوية بيبقى شغل زيادة. ممكن تتنادى كل ١٠ نسخ، أو تتحوّل لـ trigger في الداتابيز.

### 🚀 صغيرة / صيانة

**9. تحديثات الحزم المتاحة:**
```
next                      16.3.5 → 16.3.6
@next/eslint-plugin-next  16.3.5 → 16.3.6
@supabase/supabase-js     2.116.0 → 2.117.1
```
كلها patch/minor. صفر ثغرات أمنية حالياً، فالتحديث اختياري بس مفضّل.

**10. إعداد TypeScript غير تقليدي**
```json
"typescript": "npm:@typescript/typescript6@^6.0.2",
"@typescript/native": "npm:typescript@^7.0.2"
```
الأسماء متبادلة (alias معكوس): حزمة `typescript` فيها TS 6، وحزمة `@typescript/native` فيها TS 7. ده شغال تمام (typecheck بينجح)، بس مربك جداً لأي مطور جديد أو لأي أداة بتقرا الـ manifest. يستاهل كومنت في `package.json` أو في README.

**11. `target: "ES2017"` في `tsconfig.json`**
قديم شوية مع Next 16 + React 19 (اللي مطلوبهم Node 18+ ومتصفحات حديثة). الترقية لـ `ES2022` بتقلل الـ polyfills والـ downleveling وبالتالي حجم الباندل.

**12. CSP فيها `'unsafe-inline'` على الـ scripts**
```
script-src 'self' 'unsafe-inline'
```
مطلوبة حالياً للسكربت في `app/layout.tsx:92` (اختيار الثيم قبل الهيدريشن) وللـ JSON-LD في `app/page.tsx`. ده بيضعف الحماية من XSS بشكل ملحوظ. الحل الصح: nonce-based CSP (Next 16 بيدعمها عبر middleware).

**13. `X-XSS-Protection` مهجورة**
الهيدر ده deprecated وكل المتصفحات الحديثة شالته (وفي حالات معينة كان بيسبب ثغرات). مع وجود CSP قوية مش محتاجينه — ممكن يتشال.

**14. صفحة `/menu` مش في الـ sitemap بشرط**
`app/sitemap.ts` بيضيف `/menu` دايماً، بس الصفحة دي بوستر للطباعة مش محتوى مخصص للبحث. ممكن يتشال من الـ sitemap أو يتحطله `priority` أقل (هو دلوقتي 0.6 — مقبول فعلاً).

---

## ٥) الحاجات الشغالة صح (للتوثيق — متتغيرش)

عشان الصورة تبقى كاملة، دي الحاجات اللي فحصتها ولقيتها مطبّقة بشكل ممتاز:

✅ **حساب الأسعار على السيرفر** — `total` الجاي من العميل بيتجاهل تماماً ويتعاد حسابه من الكتالوج الحقيقي
✅ **خصم كاشك ذرّي** — بيتحسب في الداتابيز جوه transaction مع `select ... for update` على صف العميل، فمفيش race condition
✅ **snapshot الأسعار في الطلب** — الفواتير القديمة ما بتتأثرش بتغيير الأسعار
✅ **الأدوار في مكانين مستقلين** — `server-auth.ts` قبل الرد + RLS في الداتابيز (defense in depth)
✅ **`app_metadata` مش `user_metadata`** — المستخدم ما يقدرش يعدّل دوره من المتصفح
✅ **`timingSafeEqual` لـ CRON_SECRET** — حماية من timing attacks
✅ **`service_role` على السيرفر بس** — مفيش أي تسريب للمتصفح، والجداول الحساسة مقفولة بـ RLS من غير policy عامة
✅ **`fail closed` في التحقق** — فشل الشبكة في `verifyToken` = رفض الطلب مش قبوله
✅ **التعامل مع race conditions في الحفظ** — `persistRevision` + `persistQueue` بيمنعوا الحفظ القديم من يدهس الجديد
✅ **تطبيع مدخلات `localStorage`** — `cart-store-core.ts` بيتعامل معاها كمدخلات معادية
✅ **حماية من انفجار `script` في JSON-LD** — `.replace(/</g, "\\u003c")`
✅ **تحقق UUID قبل تركيبه في PostgREST filter** — منع injection في `backup-store.ts`
✅ **`atomic write` في سائق الملف** — كتابة في `.tmp` ثم `rename`
✅ **معالجة `overnight` في جدول المواعيد** — فترة 18:00 → 02:00 محسوبة صح مع فحص يوم امبارح
✅ **LRU + negative caching في token cache** — منع تضخم الذاكرة مع نافذة قصيرة للتوكن الملغي

---

## ٦) خطة عمل مقترحة (بالترتيب)

| # | المهمة | الأولوية | الجهد |
|---|---|---|---|
| 1 | فرض `minimumOrder` / `isOpen` / `orderTypes` / `enableCart` على السيرفر (TS + SQL) | 🔴 P0 | متوسط |
| 2 | إصلاح `/\\D/g` في `normalize.ts:155` | 🟡 P2 | دقيقة |
| 3 | إصلاح مفتاح كاش الـ navigate في `sw.js` | 🟡 P2 | صغير |
| 4 | توضيح `checkInvoiceStaff` (فحص صريح أو إعادة تسمية) | 🟠 P1 | صغير |
| 5 | إضافة Vitest + اختبارات للدوال النقية | ❌ ناقص | متوسط |
| 6 | إضافة GitHub Actions CI | ❌ ناقص | صغير |
| 7 | نقل `rate-limit` لمخزن مشترك (Upstash/KV) | 🟠 P1 | متوسط |
| 8 | نقل `salesCount` بره `catalog_data` | 🚀 أداء | كبير |
| 9 | توحيد polling الأدمن في ستور واحد | 🚀 أداء | متوسط |
| 10 | تحديث جدول الـ API في README (٦ endpoints ناقصين) | ⚠️ توثيق | صغير |
| 11 | migration لـ `update_order_status` المحدّثة | ✅ اتحل — كل ملفات SQL اتدمجت في `schema.sql` واحد، فمصدر الـdrift نفسه اتشال | صغير |
| 12 | `next/image` لصور المنتجات + `remotePatterns` | 🚀 أداء | متوسط |
| 13 | functional index على `normalize_phone` في `orders` | 🚀 أداء | دقيقة |
| 14 | حذف `CUSTOMERS_TABLE` غير المستخدم | 🔵 P3 | دقيقة |
| 15 | تحديث الحزم (next 16.3.6, supabase-js 2.117.1) | 🔵 P3 | صغير |
