-- Interactive Store Catalog — كتالوج منتجات وطلبات واتساب فقط
-- نفّذ الملف في Supabase Dashboard → SQL Editor.

create table if not exists public.catalog_data (
  slug text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- نسخ كاملة من الكتالوج: ينشئها الـ Cron أو الأدمن من خلال API آمن.
-- لا توجد سياسة قراءة عامة: service_role فقط يقرأها ويعيدها بعد التحقق من جلسة الأدمن.
create table if not exists public.catalog_backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reason text not null check (reason in ('scheduled', 'manual')),
  data jsonb not null
);
create index if not exists catalog_backups_created_at_idx on public.catalog_backups (created_at desc);

-- اشتراكات Web Push لا تُقرأ أو تُعدّل مباشرةً من المتصفح.
create table if not exists public.push_subscriptions (
  endpoint text primary key check (length(endpoint) between 20 and 2000),
  p256dh text not null check (length(p256dh) between 20 and 400),
  auth text not null check (length(auth) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- الأدوار (Roles)
--
-- الدور بيتخزن في Supabase Auth نفسه داخل `app_metadata.role` — المستخدم
-- مش بيقدر يعدّله من المتصفح (على عكس user_metadata)، والـ JWT بيحمله معاه
-- فالـ RLS والسيرفر الاتنين بيشوفوه.
--
--   admin          → لوحة التحكم الكاملة /admin (الافتراضي لأي حساب قديم)
--   invoice_staff  → صفحة الفواتير /invoices فقط
--
-- لإنشاء موظف فواتير (من Supabase Dashboard → SQL Editor بعد إنشاء اليوزر):
--   update auth.users
--      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--                              || '{"role":"invoice_staff"}'::jsonb
--    where email = 'staff@your-store.example';
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_app_role()
returns text
language sql
stable
set search_path = public, pg_temp
as $function$
  -- نفس منطق roleOf في lib/server-auth.ts:
  --   مفيش دور متسجّل → admin (توافق مع الحسابات القديمة)
  --   دور معروف       → نفسه
  --   قيمة غريبة      → 'unknown' وما بتفتحش أي policy
  -- ملاحظة: `case x when null then …` عمره ما بيطابق في SQL، فالحالة الفاضية
  -- بتتحوّل لـ 'admin' بـ nullif + coalesce قبل الـ case.
  select case coalesce(
      nullif(
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
          #>> '{app_metadata,role}',
        ''
      ),
      'admin'
    )
    when 'invoice_staff' then 'invoice_staff'
    when 'admin' then 'admin'
    else 'unknown'
  end;
$function$;

alter table public.catalog_data enable row level security;
alter table public.orders enable row level security;
alter table public.catalog_backups enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "catalog_public_read" on public.catalog_data;
create policy "catalog_public_read" on public.catalog_data for select using (true);

-- الكتابة على الكتالوج (منتجات/أسعار/إعدادات) للأدمن فقط —
-- موظف الفواتير ممنوع حتى لو نادى Supabase REST مباشرةً بالتوكن بتاعه.
drop policy if exists "catalog_owner_write" on public.catalog_data;
create policy "catalog_owner_write" on public.catalog_data
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- قراءة الطلبات متاحة للأدمن ولموظف الفواتير (ده شغلهم الأساسي) — وبس.
-- `using (true)` كانت بتدّي أي مستخدم مسجّل في المشروع كل الطلبات ببيانات
-- عملائها، حتى لو مالوش أي علاقة بلوحة التحكم.
drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_owner_read" on public.orders
  for select to authenticated
  using (public.current_app_role() in ('admin', 'invoice_staff'));

grant usage on schema public to anon, authenticated;
grant select on public.catalog_data to anon, authenticated;
grant insert, update, delete on public.catalog_data to authenticated;
grant select on public.orders to authenticated;
-- هذان الجدولان مقفولان بـ RLS بدون policy عامة. API السيرفر فقط يستخدم service_role
-- (المفتاح لا يصل إطلاقاً للمتصفح) لإنشاء النسخ وإرسال الإشعارات.
grant all on public.catalog_backups to service_role;
grant all on public.push_subscriptions to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- رقم الطلب القصير: BF-7K4P2
--   - بادئة من إعدادات المحل (commerce.orderPrefix) أو من أوائل حروف اسم المحل.
--   - 5 رموز عشوائية من أبجدية بدون حروف متشابهة (0/O/1/I) — سهل القراءة
--     والإملاء على التليفون، ومش تسلسلي فمش ممكن تخمين أرقام طلبات غيرك.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.order_code_alphabet()
returns text language sql immutable as $function$ select '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' $function$;

create or replace function public.generate_order_number(p_prefix text default 'ORD')
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $function$
declare
  v_alphabet text := public.order_code_alphabet();
  v_prefix text := upper(regexp_replace(coalesce(nullif(btrim(p_prefix), ''), 'ORD'), '[^A-Za-z0-9]', '', 'g'));
  v_code text;
  v_candidate text;
  v_attempt integer := 0;
begin
  if v_prefix = '' then v_prefix := 'ORD'; end if;
  v_prefix := left(v_prefix, 4);

  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    v_candidate := v_prefix || '-' || v_code;
    exit when not exists (select 1 from public.orders where id = v_candidate);
    -- بعد 12 محاولة (احتمال ضئيل جداً) بنطوّل الكود بدل ما ندور للأبد
    if v_attempt > 12 then
      v_candidate := v_prefix || '-' || v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      exit;
    end if;
  end loop;

  return v_candidate;
end;
$function$;

-- بادئة رقم الطلب من إعدادات المحل: commerce.orderPrefix، وإلا أوائل حروف
-- الاسم الإنجليزي (Blue Freeze → BF)، وإلا ORD.
create or replace function public.order_prefix_from_menu(p_menu jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_configured text := btrim(coalesce(p_menu #>> '{commerce,orderPrefix}', ''));
  v_name text := btrim(coalesce(p_menu #>> '{brand,storeNameEn}', ''));
  v_initials text := '';
  v_word text;
begin
  if v_configured <> '' then return v_configured; end if;
  if v_name = '' then return 'ORD'; end if;
  foreach v_word in array regexp_split_to_array(v_name, '\s+') loop
    if v_word ~ '^[A-Za-z]' then v_initials := v_initials || upper(left(v_word, 1)); end if;
  end loop;
  if length(v_initials) < 2 then v_initials := upper(left(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g'), 3)); end if;
  if v_initials = '' then return 'ORD'; end if;
  return left(v_initials, 4);
end;
$function$;

-- الدوال المساعدة دي بتتنادى من جوه place_order (security definer) بس —
-- مفيش داعي إن anon يقدر يناديها مباشرةً.
revoke all on function public.generate_order_number(text) from public, anon;
revoke all on function public.order_prefix_from_menu(jsonb) from public, anon;
revoke all on function public.order_code_alphabet() from public, anon;

-- ── جدول العملاء ────────────────────────────────────────────────────────────
-- مفتاح العميل هو رقم الموبايل بصيغة موحّدة. الجدول ده كمان بيحل مشكلة
-- البحث: بقى فيه كيان «عميل» حقيقي بدل تفتيش نصّي في آخر ٥٠٠ طلب.
create table if not exists public.customers (
  phone          text primary key,
  name           text not null default '',
  -- الرصيد الجاري ناحية العتبة (بيتصفّر/يترحّل عند صرف المكافأة)
  spent          numeric not null default 0 check (spent >= 0),
  -- إجمالي كل المشتريات على طول — للإحصائيات، مش بيتصفّر أبداً
  lifetime       numeric not null default 0 check (lifetime >= 0),
  orders_count   integer not null default 0 check (orders_count >= 0),
  rewards_used   integer not null default 0 check (rewards_used >= 0),
  discount_total numeric not null default 0 check (discount_total >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists customers_spent_idx on public.customers (spent desc);
create index if not exists customers_updated_at_idx on public.customers (updated_at desc);

alter table public.customers enable row level security;

-- بيانات العملاء مالهاش قراءة عامة خالص — الأدمن وموظف الفواتير بس.
-- العميل نفسه بيشوف رصيده من خلال دالة آمنة (customer_loyalty) مش من الجدول.
drop policy if exists "customers_staff_read" on public.customers;
create policy "customers_staff_read" on public.customers
  for select to authenticated
  using (public.current_app_role() in ('admin', 'invoice_staff'));

drop policy if exists "customers_admin_write" on public.customers;
create policy "customers_admin_write" on public.customers
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ── توحيد صيغة رقم الموبايل ─────────────────────────────────────────────────
-- من غير ده «+201012345678» و«0101 234 5678» هيبقوا عميلين مختلفين.
-- نفس منطق normalizePhone في lib/loyalty.ts بالظبط.
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v text;
begin
  v := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v = '' then return ''; end if;
  if left(v, 2) = '00' then v := substr(v, 3); end if;
  if left(v, 2) = '20' and length(v) >= 11 then v := '0' || substr(v, 3); end if;
  if length(v) = 10 and left(v, 1) = '1' then v := '0' || v; end if;
  return left(v, 20);
end;
$function$;

-- ── ملخّص النسخ الاحتياطية من غير تنزيل الكتالوج كامل ───────────────────────
-- قائمة النسخ كانت بتجيب عمود `data` بالكامل لكل نسخة (كتالوج كامل، ممكن
-- يبقى ميجابايتات) عشان تعرض عدد المنتجات والأقسام بس. العدّ بيحصل في
-- قاعدة البيانات دلوقتي، والرد بقى أرقام صغيرة.
create or replace function public.list_catalog_backups(p_limit integer default 15)
returns table (
  id uuid,
  created_at timestamptz,
  reason text,
  item_count integer,
  category_count integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    b.id,
    b.created_at,
    b.reason,
    coalesce(jsonb_array_length(b.data -> 'items'), 0)::integer,
    coalesce(jsonb_array_length(b.data -> 'categories'), 0)::integer
  from public.catalog_backups b
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 15), 1), 100);
$function$;

revoke all on function public.list_catalog_backups(integer) from public, anon, authenticated;
grant execute on function public.list_catalog_backups(integer) to service_role;

-- ── هل المحل بيستقبل طلبات دلوقتي؟ ──────────────────────────────────────────
-- نفس منطق `effectiveStoreOpen` في lib/schedule.ts بالظبط:
--   - autoSchedule = false → المفتاح اليدوي isOpen
--   - autoSchedule = true  → الجدول الأسبوعي بتوقيت المحل (Africa/Cairo)
-- بيدعم الفترات اللي بتعدي نص الليل (مثال 18:00 → 02:00) بفحص يوم امبارح.
create or replace function public.store_is_open(p_contact jsonb)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  v_tz constant text := 'Africa/Cairo';
  v_now timestamptz := now();
  v_day integer;
  v_minutes integer;
  v_slot jsonb;
  v_open integer;
  v_close integer;
begin
  -- القفل اليدوي هو الحاكم لما الجدول الأوتوماتيكي يكون مقفول
  if coalesce((p_contact ->> 'autoSchedule')::boolean, false) = false then
    return coalesce((p_contact ->> 'isOpen')::boolean, true);
  end if;

  v_day := extract(dow from v_now at time zone v_tz)::integer;          -- 0 = الأحد
  v_minutes := extract(hour from v_now at time zone v_tz)::integer * 60
             + extract(minute from v_now at time zone v_tz)::integer;

  -- فترة النهارده
  select elem into v_slot
    from jsonb_array_elements(coalesce(p_contact -> 'weeklySchedule', '[]'::jsonb)) as elem
   where (elem ->> 'day')::integer = v_day
     and coalesce((elem ->> 'enabled')::boolean, false) = true
   limit 1;

  if v_slot is not null then
    v_open  := split_part(v_slot ->> 'open',  ':', 1)::integer * 60
             + split_part(v_slot ->> 'open',  ':', 2)::integer;
    v_close := split_part(v_slot ->> 'close', ':', 1)::integer * 60
             + split_part(v_slot ->> 'close', ':', 2)::integer;
    if v_close <= v_open then
      -- بتعدي نص الليل: من وقت الفتح لحد 24:00
      if v_minutes >= v_open then return true; end if;
    elsif v_minutes >= v_open and v_minutes < v_close then
      return true;
    end if;
  end if;

  -- فترة امبارح اللي بتعدي نص الليل: من 00:00 لحد وقت القفل
  select elem into v_slot
    from jsonb_array_elements(coalesce(p_contact -> 'weeklySchedule', '[]'::jsonb)) as elem
   where (elem ->> 'day')::integer = (v_day + 6) % 7
     and coalesce((elem ->> 'enabled')::boolean, false) = true
   limit 1;

  if v_slot is not null then
    v_open  := split_part(v_slot ->> 'open',  ':', 1)::integer * 60
             + split_part(v_slot ->> 'open',  ':', 2)::integer;
    v_close := split_part(v_slot ->> 'close', ':', 1)::integer * 60
             + split_part(v_slot ->> 'close', ':', 2)::integer;
    if v_close <= v_open and v_minutes < v_close then return true; end if;
  end if;

  return false;
end;
$function$;

revoke all on function public.store_is_open(jsonb) from public, anon;

-- ── رصيد العميل للعرض في السلة ──────────────────────────────────────────────
-- دالة آمنة بترجّع الرصيد ونسبة التقدّم بس — من غير الاسم ولا عدد الطلبات ولا
-- أي بيانات شخصية، عشان حد يعرف رقم موبايل متيجيش تسريب بيانات.
create or replace function public.customer_loyalty(p_phone text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $function$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_spent numeric := 0;
  v_menu jsonb;
  v_loyalty jsonb;
  v_threshold numeric;
begin
  if length(v_phone) < 8 then
    return jsonb_build_object('enabled', false, 'balance', 0);
  end if;

  select data -> 'commerce' -> 'loyalty' into v_loyalty
    from public.catalog_data where slug = 'main';

  if coalesce((v_loyalty ->> 'enabled')::boolean, false) = false then
    return jsonb_build_object('enabled', false, 'balance', 0);
  end if;

  v_threshold := greatest(1, coalesce((v_loyalty ->> 'threshold')::numeric, 5000));
  select spent into v_spent from public.customers where phone = v_phone;
  v_spent := coalesce(v_spent, 0);

  return jsonb_build_object(
    'enabled', true,
    'balance', v_spent,
    'threshold', v_threshold,
    'percent', greatest(0, coalesce((v_loyalty ->> 'percent')::numeric, 5)),
    'eligible', v_spent >= v_threshold,
    'remaining', greatest(0, v_threshold - v_spent)
  );
end;
$function$;

revoke all on function public.customer_loyalty(text) from public;
grant execute on function public.customer_loyalty(text) to anon, authenticated;

-- ── بحث العملاء للأدمن ──────────────────────────────────────────────────────
-- بحث على السيرفر (مش مقيّد بآخر ٥٠٠ طلب زي البحث القديم في المتصفح).
create or replace function public.search_customers(p_query text default '', p_limit integer default 50)
returns setof public.customers
language sql
stable
set search_path = public, pg_temp
as $function$
  select * from public.customers
   where p_query is null or btrim(p_query) = ''
      or phone like '%' || public.normalize_phone(p_query) || '%'
      or name ilike '%' || btrim(p_query) || '%'
   order by updated_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

revoke all on function public.search_customers(text, integer) from public, anon;
grant execute on function public.search_customers(text, integer) to authenticated;

-- فهرس على رقم موبايل العميل المُوحّد داخل الطلب.
-- من غيره `customer_orders` بتعمل sequential scan على كل الطلبات وبتنادي
-- normalize_phone على كل صف — يبقى أبطأ وأبطأ كل ما الطلبات تزيد.
create index if not exists orders_customer_phone_idx
  on public.orders (public.normalize_phone(data #>> '{customer,phone}'));

-- ── كل طلبات عميل واحد ──────────────────────────────────────────────────────
create or replace function public.customer_orders(p_phone text, p_limit integer default 100)
returns setof public.orders
language sql
stable
set search_path = public, pg_temp
as $function$
  select * from public.orders
   where public.normalize_phone(data #>> '{customer,phone}') = public.normalize_phone(p_phone)
   order by created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

revoke all on function public.customer_orders(text, integer) from public, anon;
grant execute on function public.customer_orders(text, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- place_order — النسخة الجديدة بخصم كاشك
-- التغييرات عن النسخة السابقة:
--   1. بعد حساب subtotal بنجيب رصيد العميل ونشوف هل مستحق خصم
--   2. الخصم بيتحسب على الأصناف فقط (مش على التوصيل والخدمة)
--   3. رسوم الخدمة بتتحسب بعد الخصم (العميل بيستفيد بالكامل)
--   4. رصيد العميل بيتحدّث ذرّياً في نفس الـ transaction
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_menu jsonb;
  v_items jsonb;
  v_lines jsonb := coalesce(payload -> 'lines', '[]'::jsonb);
  v_line jsonb;
  v_item jsonb;
  v_variant jsonb;
  v_item_id text;
  v_item_name text;
  v_item_price numeric;
  v_quantity integer;
  /** خريطة {itemId: الكمية} بتتجمّع في اللوب وبتتطبّق مرة واحدة بعده */
  v_sales jsonb := '{}'::jsonb;
  v_order_lines jsonb := '[]'::jsonb;
  v_order jsonb;
  v_order_id text;
  v_now timestamptz := now();
  v_now_iso text;
  v_subtotal numeric := 0;
  v_delivery numeric := 0;
  v_service numeric := 0;
  v_total numeric := 0;
  v_commerce jsonb;
  v_contact jsonb;
  v_order_type text;
  v_free_over numeric;
  v_fee numeric;
  v_pct numeric;
  v_min_order numeric := 0;
  v_zone_min numeric := 0;
  v_zone jsonb;
  v_zone_id text;
  v_zone_name text := '';
  v_payment text := '';
  -- كاشك
  v_loyalty_cfg jsonb;
  v_loyalty_on boolean := false;
  v_threshold numeric := 0;
  v_reward_pct numeric := 0;
  v_phone_raw text;
  v_phone text := '';
  v_name text;
  v_balance numeric := 0;
  v_discount numeric := 0;
  v_loyalty jsonb := null;
  v_new_balance numeric := 0;
begin
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'السلة فارغة' using errcode = '22023';
  end if;
  if jsonb_array_length(v_lines) > 50 then
    raise exception 'عدد المنتجات كبير جداً (الحد 50)' using errcode = '22023';
  end if;

  select data into v_menu from public.catalog_data where slug = 'main' for update;
  if v_menu is null then
    raise exception 'كتالوج المتجر لسه مش محفوظ' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_item_id := btrim(coalesce(v_line ->> 'itemId', ''));
    v_quantity := floor(coalesce((v_line ->> 'quantity')::numeric, 0))::integer;
    if v_item_id = '' or v_quantity < 1 or v_quantity > 50 then
      raise exception 'بيانات المنتج أو الكمية غير صالحة' using errcode = '22023';
    end if;

    select elem into v_item
      from jsonb_array_elements(v_menu -> 'items') as elem
      where elem ->> 'id' = v_item_id limit 1;
    if v_item is null or coalesce((v_item ->> 'available')::boolean, false) = false then
      raise exception 'أحد المنتجات لم يعد متاحاً' using errcode = '22023';
    end if;

    v_item_name := coalesce(v_item ->> 'name', '');
    v_variant := null;
    if nullif(btrim(coalesce(v_line ->> 'variantId', '')), '') is not null then
      select elem into v_variant from jsonb_array_elements(coalesce(v_item -> 'variants', '[]'::jsonb)) as elem
        where elem ->> 'id' = v_line ->> 'variantId' limit 1;
      if v_variant is null then
        raise exception 'اختيار المنتج غير صالح' using errcode = '22023';
      end if;
    end if;
    v_item_price := greatest(0, coalesce((coalesce(v_variant, v_item) ->> 'price')::numeric, 0));
    v_order_lines := v_order_lines || jsonb_build_object(
      'itemId', v_item_id, 'name', v_item_name,
      'quantity', v_quantity, 'unitPrice', v_item_price
    );

    -- بنجمّع الكميات في خريطة بس، والتطبيق على الكتالوج بيحصل مرة واحدة بعد
    -- اللوب. قبل كده كان كل سطر في الطلب بيعيد بناء مصفوفة المنتجات كلها —
    -- يعني ١٠ أصناف × ٣٠٠ منتج = ٣٠٠٠ عملية، وكل ده والصف متقفول بـ
    -- `for update` فباقي الطلبات مستنية.
    v_sales := jsonb_set(
      v_sales,
      array[v_item_id],
      to_jsonb(coalesce((v_sales ->> v_item_id)::integer, 0) + v_quantity)
    );
  end loop;

  -- تطبيق عدّادات المبيعات في تمريرة واحدة على الكتالوج
  if v_sales <> '{}'::jsonb then
    select jsonb_agg(
      case when v_sales ? (elem ->> 'id')
        then elem || jsonb_build_object(
          'salesCount', greatest(0, coalesce((elem ->> 'salesCount')::integer, 0))
                        + (v_sales ->> (elem ->> 'id'))::integer
        )
        else elem end
      order by ordinality
    ) into v_items
    from jsonb_array_elements(v_menu -> 'items') with ordinality as t(elem, ordinality);
    v_menu := jsonb_set(v_menu, '{items}', v_items);
  end if;

  v_commerce := v_menu -> 'commerce';
  v_contact := v_menu -> 'contact';
  -- المحل تيك-أواي (مفيش طاولات): استلام من المحل أو توصيل بس
  v_order_type := coalesce(payload ->> 'orderType', 'pickup');
  if v_order_type not in ('delivery', 'pickup') then
    raise exception 'نوع الطلب غير صالح' using errcode = '22023';
  end if;

  select coalesce(sum((elem->>'unitPrice')::numeric * (elem->>'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(v_order_lines) as elem;

  -- ══ قواعد قبول الطلب ══════════════════════════════════════════════════════
  -- الإعدادات دي كانت متفروضة في المتصفح بس، فأي POST مباشر على /api/orders
  -- كان بيعدّيها. دي آخر خط دفاع — بتشتغل حتى لو حد نادى Supabase REST مباشرةً.
  -- نفس المنطق في lib/order-rules.ts للسائق المحلي.

  -- (١) السلة مقفولة خالص (وضع «معرض فقط»)
  if coalesce((v_commerce ->> 'enableCart')::boolean, true) = false then
    raise exception 'الطلب من الموقع مقفول حالياً' using errcode = '22023';
  end if;

  -- (٢) المحل مقفول (يدوي أو بالجدول الأوتوماتيكي)
  if not public.store_is_open(v_contact) then
    raise exception 'المحل مقفل حالياً — مش ممكن تسجيل طلبات دلوقتي' using errcode = '22023';
  end if;

  -- (٣) نوع الطلب لازم يكون مفعّل في إعدادات المحل
  if jsonb_array_length(coalesce(v_commerce -> 'orderTypes', '[]'::jsonb)) > 0
     and not (v_commerce -> 'orderTypes' ? v_order_type) then
    raise exception 'نوع الطلب ده مش متاح حالياً' using errcode = '22023';
  end if;

  -- (٤) بيانات العميل المطلوبة حسب إعدادات المحل
  if coalesce((v_commerce ->> 'requireName')::boolean, false)
     and length(btrim(coalesce(payload #>> '{customer,name}', ''))) < 2 then
    raise exception 'اكتب الاسم بالكامل' using errcode = '22023';
  end if;
  if coalesce((v_commerce ->> 'requirePhone')::boolean, false)
     and length(regexp_replace(coalesce(payload #>> '{customer,phone}', ''), '\D', '', 'g')) < 10 then
    raise exception 'رقم الموبايل مش كامل' using errcode = '22023';
  end if;
  if v_order_type = 'delivery'
     and coalesce((v_commerce ->> 'requireAddress')::boolean, false)
     and length(btrim(coalesce(payload #>> '{customer,address}', ''))) < 8 then
    raise exception 'اكتب العنوان بالتفصيل (الشارع، رقم العقار، الدور، الشقة)' using errcode = '22023';
  end if;

  -- (٥) الحد الأدنى للطلب — على قيمة الأصناف قبل التوصيل والخدمة
  v_min_order := greatest(0, coalesce((v_commerce ->> 'minimumOrder')::numeric, 0));
  if v_min_order > 0 and v_subtotal < v_min_order then
    raise exception 'أقل طلب % %', v_min_order, coalesce(v_commerce ->> 'currency', '')
      using errcode = '22023';
  end if;

  -- ── خصم كاشك ──────────────────────────────────────────────────────────────
  -- بيتحسب قبل رسوم الخدمة عشان العميل يستفيد بالخصم كامل، وعلى الأصناف فقط
  -- (التوصيل مش داخل في الخصم ولا في الرصيد).
  v_phone_raw := coalesce(payload #>> '{customer,phone}', '');
  v_phone := public.normalize_phone(v_phone_raw);
  v_name := left(btrim(coalesce(payload #>> '{customer,name}', '')), 100);
  v_loyalty_cfg := v_commerce -> 'loyalty';
  v_loyalty_on := coalesce((v_loyalty_cfg ->> 'enabled')::boolean, false) and length(v_phone) >= 8;

  if v_loyalty_on then
    v_threshold := greatest(1, coalesce((v_loyalty_cfg ->> 'threshold')::numeric, 5000));
    v_reward_pct := greatest(0, least(50, coalesce((v_loyalty_cfg ->> 'percent')::numeric, 5)));

    -- قفل صف العميل: طلبين في نفس اللحظة مينفعش ياخدوا نفس المكافأة مرتين
    select spent into v_balance from public.customers where phone = v_phone for update;
    v_balance := coalesce(v_balance, 0);

    if v_balance >= v_threshold and v_reward_pct > 0 then
      v_discount := round(v_subtotal * v_reward_pct / 100);
      -- الزيادة فوق العتبة بتترحّل للدورة الجديدة + قيمة الطلب الحالي
      v_new_balance := (v_balance - v_threshold) + v_subtotal;
      v_loyalty := jsonb_build_object(
        'discount', v_discount,
        'percent', v_reward_pct,
        'threshold', v_threshold,
        'balanceBefore', v_balance,
        'balanceAfter', v_new_balance
      );
    else
      v_new_balance := v_balance + v_subtotal;
    end if;
  end if;

  if v_order_type = 'delivery' then
    v_free_over := greatest(0, coalesce((v_commerce->>'freeDeliveryOver')::numeric, 0));
    v_fee := greatest(0, coalesce((v_commerce->>'deliveryFee')::numeric, 0));

    -- مناطق التوصيل: لو مفعّلة وفيه مناطق، لازم العميل يختار منطقة صالحة
    -- ورسوم المنطقة بتتحسب بدل الرسوم العامة.
    if coalesce((v_commerce->>'enableZones')::boolean, false)
       and jsonb_array_length(coalesce(v_commerce->'deliveryZones', '[]'::jsonb)) > 0 then
      v_zone_id := btrim(coalesce(payload ->> 'zoneId', ''));
      select elem into v_zone
        from jsonb_array_elements(v_commerce->'deliveryZones') as elem
        where elem ->> 'id' = v_zone_id limit 1;
      if v_zone is null then
        raise exception 'اختار منطقة التوصيل' using errcode = '22023';
      end if;
      v_fee := greatest(0, coalesce((v_zone->>'fee')::numeric, 0));
      v_zone_name := left(btrim(coalesce(v_zone->>'name', '')), 60);

      -- (٦) الحد الأدنى الخاص بالمنطقة — كان متفروض في المتصفح بس
      v_zone_min := greatest(0, coalesce((v_zone ->> 'minimumOrder')::numeric, 0));
      if v_zone_min > 0 and v_subtotal < v_zone_min then
        raise exception 'أقل طلب في % هو % %', v_zone_name, v_zone_min,
          coalesce(v_commerce ->> 'currency', '') using errcode = '22023';
      end if;
    end if;

    -- التوصيل المجاني بيتحسب على قيمة الأصناف قبل الخصم — الخصم مكافأة
    -- مش المفروض تحرم العميل من ميزة تانية استحقها.
    if not (v_free_over > 0 and v_subtotal >= v_free_over) then v_delivery := v_fee; end if;
  end if;

  v_pct := greatest(0, coalesce((v_commerce->>'serviceChargePercent')::numeric, 0));
  if v_pct > 0 then
    v_service := round((v_subtotal - v_discount + v_delivery) * v_pct / 100);
  end if;
  v_total := greatest(0, v_subtotal - v_discount + v_delivery + v_service);

  v_payment := left(btrim(coalesce(payload ->> 'paymentMethod', '')), 40);
  v_now_iso := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  -- رقم طلب قصير سهل القراءة (BF-7K4P2) — فريد ومش تسلسلي
  v_order_id := public.generate_order_number(public.order_prefix_from_menu(v_menu));
  v_order := jsonb_build_object(
    'id', v_order_id, 'createdAt', v_now_iso,
    -- لقطة الأسعار وقت الطلب: الفاتورة بتتبني منها ومش بتتأثر بأي تعديل لاحق
    'subtotal', v_subtotal, 'deliveryFee', v_delivery, 'serviceFee', v_service,
    'currency', coalesce(v_commerce ->> 'currency', ''),
    'customer', jsonb_build_object(
      'name', v_name,
      'phone', left(btrim(v_phone_raw), 30),
      'address', left(btrim(coalesce(payload #>> '{customer,address}', '')), 500),
      'notes', left(btrim(coalesce(payload #>> '{customer,notes}', '')), 500)
    ),
    'orderType', v_order_type, 'lines', v_order_lines, 'total', v_total,
    'status', 'new',
    'zoneName', v_zone_name,
    'paymentMethod', v_payment
  );
  -- لقطة كاشك جوه الطلب: الفاتورة بتعرض الخصم منها ومش بتعيد حسابه
  if v_loyalty is not null then
    v_order := v_order || jsonb_build_object('loyalty', v_loyalty);
  end if;

  insert into public.orders (id, created_at, data) values (v_order_id, v_now, v_order);

  -- تحديث ملف العميل في نفس الـ transaction — لو الـ insert فوق فشل مفيش رصيد بيتزوّد
  if v_loyalty_on then
    insert into public.customers as c
      (phone, name, spent, lifetime, orders_count, rewards_used, discount_total, updated_at)
    values (
      v_phone, v_name, v_new_balance, v_subtotal, 1,
      case when v_discount > 0 then 1 else 0 end, v_discount, v_now
    )
    on conflict (phone) do update set
      name           = case when excluded.name <> '' then excluded.name else c.name end,
      spent          = v_new_balance,
      lifetime       = c.lifetime + v_subtotal,
      orders_count   = c.orders_count + 1,
      rewards_used   = c.rewards_used + case when v_discount > 0 then 1 else 0 end,
      discount_total = c.discount_total + v_discount,
      updated_at     = v_now;
  end if;

  update public.catalog_data
    set data = jsonb_set(v_menu, '{updatedAt}', to_jsonb(v_now_iso)), updated_at = v_now
    where slug = 'main';
  return jsonb_build_object('order', v_order);
end;
$function$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- update_order_status — مع عكس أثر كاشك عند الإلغاء
--
-- من غير ده أي حد يعمل طلبات كبيرة ويلغيها ويجمع رصيد من غير ما يشتري حاجة.
-- الإلغاء بيرجّع: قيمة الطلب تتشال من الرصيد، ولو الطلب كان صرف مكافأة
-- المكافأة بترجع للعميل تاني (العتبة تترد لرصيده).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.update_order_status(p_order_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order jsonb;
  v_was text;
  v_phone text;
  v_subtotal numeric;
  v_loyalty jsonb;
  v_delta numeric;
  -- الفروق اللي هتتطبّق على صف العميل، والقيم قبل التعديل عشان نحسب المطبّق فعلاً
  v_reverse jsonb;
  v_d_spent numeric;
  v_d_lifetime numeric;
  v_d_orders integer;
  v_d_rewards integer;
  v_d_discount numeric;
  v_spent_before numeric := 0;
  v_lifetime_before numeric := 0;
  v_orders_before integer := 0;
  v_rewards_before integer := 0;
  v_discount_before numeric := 0;
begin
  if p_status not in ('new', 'cancelled') then
    raise exception 'حالة الطلب غير صالحة' using errcode = '22023';
  end if;

  select data into v_order from public.orders where id = btrim(coalesce(p_order_id, '')) for update;
  if v_order is null then
    raise exception 'الطلب غير موجود' using errcode = '22023';
  end if;

  -- الحالات القديمة (confirmed/delivered) بتتعامل كـ new زي ما التطبيق بيعمل
  v_was := case when coalesce(v_order ->> 'status', 'new') = 'cancelled' then 'cancelled' else 'new' end;

  -- الرصيد بيتعدّل بس لما الحالة تتغيّر فعلاً (مش كل ضغطة على نفس الزرار)
  if v_was <> p_status then
    v_phone := public.normalize_phone(coalesce(v_order #>> '{customer,phone}', ''));
    v_subtotal := greatest(0, coalesce((v_order ->> 'subtotal')::numeric, 0));
    v_loyalty := v_order -> 'loyalty';

    -- الفروق المسجّلة من آخر تغيير حالة — لو موجودة يبقى ده رجوع عن نفس التغيير
    v_reverse := v_order -> 'loyaltyAdjustment';

    if length(v_phone) >= 8 then
      -- القيم قبل التعديل عشان نحسب الفرق اللي اتطبّق فعلاً بعد الحد الأدنى صفر
      select spent, lifetime, orders_count, rewards_used, discount_total
        into v_spent_before, v_lifetime_before, v_orders_before, v_rewards_before, v_discount_before
        from public.customers where phone = v_phone;

      -- عند الإلغاء: نشيل قيمة الطلب، ولو كان صرف مكافأة نرجّع العتبة لرصيده.
      -- عند إرجاعه «جديد»: العكس بالظبط.
      --
      -- مهم: `greatest(0, …)` بيمنع الأرقام السالبة، وده كان بيسبب انحراف في
      -- الرصيد. مثال: رصيد 50 وطلب بـ 100 → الإلغاء بينزّله لـ 0 (مش -50)،
      -- وإرجاع الطلب كان بيزوّد 100 فيبقى 100 بدل 50 الأصلية. الحل إننا
      -- نسجّل الفرق اللي اتطبّق فعلاً على الصف، ونعكسه هو بالظبط بعد كده.
      if v_reverse is not null then
        -- عملية عكسية: استخدم الفروق المسجّلة من التغيير السابق بإشارة معكوسة
        v_d_spent    := -coalesce((v_reverse ->> 'spent')::numeric, 0);
        v_d_lifetime := -coalesce((v_reverse ->> 'lifetime')::numeric, 0);
        v_d_orders   := -coalesce((v_reverse ->> 'ordersCount')::integer, 0);
        v_d_rewards  := -coalesce((v_reverse ->> 'rewardsUsed')::integer, 0);
        v_d_discount := -coalesce((v_reverse ->> 'discountTotal')::numeric, 0);
      else
        v_delta := v_subtotal - coalesce((v_loyalty ->> 'threshold')::numeric, 0);
        if p_status = 'cancelled' then v_delta := -v_delta; end if;
        v_d_spent    := v_delta;
        v_d_lifetime := case when p_status = 'cancelled' then -v_subtotal else v_subtotal end;
        v_d_orders   := case when p_status = 'cancelled' then -1 else 1 end;
        v_d_rewards  := case when v_loyalty is null then 0
                             when p_status = 'cancelled' then -1 else 1 end;
        v_d_discount := case when p_status = 'cancelled' then -1 else 1 end
                        * coalesce((v_loyalty ->> 'discount')::numeric, 0);
      end if;

      update public.customers set
        spent          = greatest(0, spent + v_d_spent),
        lifetime       = greatest(0, lifetime + v_d_lifetime),
        orders_count   = greatest(0, orders_count + v_d_orders),
        rewards_used   = greatest(0, rewards_used + v_d_rewards),
        discount_total = greatest(0, discount_total + v_d_discount),
        updated_at     = now()
      where phone = v_phone
      returning
        spent - v_spent_before,
        lifetime - v_lifetime_before,
        orders_count - v_orders_before,
        rewards_used - v_rewards_before,
        discount_total - v_discount_before
      into v_d_spent, v_d_lifetime, v_d_orders, v_d_rewards, v_d_discount;
    end if;
  end if;

  v_order := v_order || jsonb_build_object(
    'status', p_status,
    'statusUpdatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  -- سجّل الفروق اللي اتطبّقت فعلاً (بعد الحد الأدنى صفر) عشان العكس يبقى مضبوط
  if v_was <> p_status and v_d_spent is not null then
    v_order := v_order || jsonb_build_object('loyaltyAdjustment', jsonb_build_object(
      'spent', v_d_spent,
      'lifetime', v_d_lifetime,
      'ordersCount', v_d_orders,
      'rewardsUsed', v_d_rewards,
      'discountTotal', v_d_discount
    ));
  end if;

  update public.orders set data = v_order where id = btrim(coalesce(p_order_id, ''));
  return jsonb_build_object('order', v_order);
end;
$function$;

revoke all on function public.update_order_status(text, text) from public, anon;
grant execute on function public.update_order_status(text, text) to authenticated;


do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='catalog_data') then
    alter publication supabase_realtime add table public.catalog_data;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

alter table public.catalog_data replica identity full;
alter table public.orders replica identity full;
alter table public.customers replica identity full;
