-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: نظام صفحة الفواتير /invoices
--
-- نفّذ الملف ده مرة واحدة في Supabase Dashboard → SQL Editor على قاعدة
-- بيانات شغالة بالفعل. الملف idempotent (ينفع يتنفذ أكتر من مرة بأمان)،
-- وهو نفس محتوى supabase/schema.sql المحدّث — يعني لو نفّذت schema.sql
-- كامل مش محتاج الملف ده.
--
-- بيضيف:
--   1) الأدوار: current_app_role() + تقييد الكتابة على الكتالوج للأدمن فقط
--   2) رقم الطلب القصير: BF-7K4P2 بدل ORD-9F3A17B2C4
--   3) لقطة الحساب في الطلب (subtotal / deliveryFee / serviceFee / currency)
--
-- مش بيضيف أي جدول جديد — الطلبات بتفضل في public.orders زي ما هي،
-- والطلبات القديمة ما بتتغيرش.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) الأدوار
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


-- الكتابة على الكتالوج (منتجات/أسعار/إعدادات) للأدمن فقط —
-- موظف الفواتير ممنوع حتى لو نادى Supabase REST مباشرةً بالتوكن بتاعه.
drop policy if exists "catalog_owner_write" on public.catalog_data;
create policy "catalog_owner_write" on public.catalog_data
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');


-- (2) رقم الطلب القصير
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

-- (3) تسجيل الطلب برقم قصير + لقطة الحساب
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

-- ─────────────────────────────────────────────────────────────────────────────
-- إنشاء موظف فواتير:
--   1. Supabase → Authentication → Users → Add user (إيميل + باسورد)
--   2. نفّذ السطر ده بإيميله:
--
--      update auth.users
--         set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--                                 || '{"role":"invoice_staff"}'::jsonb
--       where email = 'staff@your-store.example';
--
--   3. الموظف يدخل على /invoices بالحساب ده. لو جرّب يفتح /admin أو ينادي
--      أي API إداري هيترفض من السيرفر (403) ومن RLS كمان.
--
-- أي حساب موجود دلوقتي (من غير الحقل ده) بيفضل admin زي ما هو.
-- ─────────────────────────────────────────────────────────────────────────────
