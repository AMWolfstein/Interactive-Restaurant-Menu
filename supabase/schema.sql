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
  select case
    when coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
           #>> '{app_metadata,role}' = 'invoice_staff'
    then 'invoice_staff'
    else 'admin'
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

-- قراءة الطلبات متاحة للأدمن ولموظف الفواتير (ده شغلهم الأساسي).
drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_owner_read" on public.orders
  for select to authenticated using (true);

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

-- يسجل الطلب فقط. لا يتابع أو يخصم أي مخزون.
-- يدعم مناطق التوصيل (رسوم لكل منطقة) وطرق الدفع، والطلب بيتسجل بحالة "new".
create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_menu jsonb;
  v_lines jsonb := coalesce(payload -> 'lines', '[]'::jsonb);
  v_line jsonb;
  v_item jsonb;
  v_variant jsonb;
  v_items jsonb;
  v_item_id text;
  v_item_name text;
  v_item_price numeric;
  v_quantity integer;
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
  v_order_type text;
  v_free_over numeric;
  v_fee numeric;
  v_pct numeric;
  v_zone jsonb;
  v_zone_id text;
  v_zone_name text := '';
  v_payment text := '';
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

    -- الأكثر مبيعاً يُحسب تلقائياً من الكميات الموجودة في الطلبات المكتملة.
    select jsonb_agg(
      case when elem ->> 'id' = v_item_id
        then elem || jsonb_build_object(
          'salesCount', greatest(0, coalesce((elem ->> 'salesCount')::integer, 0)) + v_quantity
        )
        else elem end
      order by ordinality
    ) into v_items
    from jsonb_array_elements(v_menu -> 'items') with ordinality as t(elem, ordinality);
    v_menu := jsonb_set(v_menu, '{items}', v_items);
  end loop;

  v_commerce := v_menu -> 'commerce';
  -- المحل تيك-أواي (مفيش طاولات): استلام من المحل أو توصيل بس
  v_order_type := coalesce(payload ->> 'orderType', 'pickup');
  if v_order_type not in ('delivery', 'pickup') then
    raise exception 'نوع الطلب غير صالح' using errcode = '22023';
  end if;

  select coalesce(sum((elem->>'unitPrice')::numeric * (elem->>'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(v_order_lines) as elem;

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
    end if;

    if not (v_free_over > 0 and v_subtotal >= v_free_over) then v_delivery := v_fee; end if;
  end if;
  v_pct := greatest(0, coalesce((v_commerce->>'serviceChargePercent')::numeric, 0));
  if v_pct > 0 then v_service := round((v_subtotal + v_delivery) * v_pct / 100); end if;
  v_total := v_subtotal + v_delivery + v_service;

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
      'name', left(btrim(coalesce(payload #>> '{customer,name}', '')), 100),
      'phone', left(btrim(coalesce(payload #>> '{customer,phone}', '')), 30),
      'address', left(btrim(coalesce(payload #>> '{customer,address}', '')), 500),
      'notes', left(btrim(coalesce(payload #>> '{customer,notes}', '')), 500)
    ),
    'orderType', v_order_type, 'lines', v_order_lines, 'total', v_total,
    'status', 'new',
    'zoneName', v_zone_name,
    'paymentMethod', v_payment
  );

  insert into public.orders (id, created_at, data) values (v_order_id, v_now, v_order);
  update public.catalog_data
    set data = jsonb_set(v_menu, '{updatedAt}', to_jsonb(v_now_iso)), updated_at = v_now
    where slug = 'main';
  return jsonb_build_object('order', v_order);
end;
$function$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- تحديث حالة الطلب (جديد/ملغي) — للأدمن فقط (authenticated).
-- أي طلب جه من الموقع هيتنفذ (توصيل أو استلام)، فمفيش «مؤكد» ولا «تم التسليم» —
-- الإجراء الوحيد هو الإلغاء (أو إرجاع الملغي جديد). الطلبات القديمة المحفوظة
-- بحالة confirmed/delivered بتتعامل كـ new عند القراءة في التطبيق.
create or replace function public.update_order_status(p_order_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order jsonb;
begin
  if p_status not in ('new', 'cancelled') then
    raise exception 'حالة الطلب غير صالحة' using errcode = '22023';
  end if;

  select data into v_order from public.orders where id = btrim(coalesce(p_order_id, '')) for update;
  if v_order is null then
    raise exception 'الطلب غير موجود' using errcode = '22023';
  end if;

  v_order := v_order || jsonb_build_object(
    'status', p_status,
    'statusUpdatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

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
