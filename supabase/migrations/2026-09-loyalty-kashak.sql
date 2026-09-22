-- ═══════════════════════════════════════════════════════════════════════════
-- نظام «كاشك» — مكافأة الولاء على إجمالي مشتريات العميل
--
-- الفكرة: كل طلب بيزوّد رصيد العميل بقيمة الأصناف (subtotal) من غير التوصيل
-- ورسوم الخدمة. أول ما الرصيد يوصل العتبة (٥٠٠٠ ج افتراضياً) يستحق العميل خصم
-- (٥٪ افتراضياً) على الطلب اللي بعده، وساعتها العتبة بتتخصم من رصيده والزيادة
-- بتترحّل للدورة الجديدة.
--
-- كل الحساب بيحصل هنا جوه place_order — مش في المتصفح. لو اتحسب في الفرونت
-- أي حد يقدر يبعت خصم من عنده، فالداتابيز هي مصدر الحقيقة الوحيد.
--
-- نفّذ الملف في Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

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
  for select to authenticated using (true);

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

    if length(v_phone) >= 8 then
      -- عند الإلغاء: نشيل قيمة الطلب، ولو كان صرف مكافأة نرجّع العتبة لرصيده.
      -- عند إرجاعه «جديد»: العكس بالظبط.
      v_delta := v_subtotal - coalesce((v_loyalty ->> 'threshold')::numeric, 0);
      if p_status = 'cancelled' then v_delta := -v_delta; end if;

      update public.customers set
        spent          = greatest(0, spent + v_delta),
        lifetime       = greatest(0, lifetime + case when p_status = 'cancelled' then -v_subtotal else v_subtotal end),
        orders_count   = greatest(0, orders_count + case when p_status = 'cancelled' then -1 else 1 end),
        rewards_used   = greatest(0, rewards_used + case
                           when v_loyalty is null then 0
                           when p_status = 'cancelled' then -1 else 1 end),
        discount_total = greatest(0, discount_total + case when p_status = 'cancelled' then -1 else 1 end
                           * coalesce((v_loyalty ->> 'discount')::numeric, 0)),
        updated_at     = now()
      where phone = v_phone;
    end if;
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

-- ── ترحيل الطلبات القديمة ───────────────────────────────────────────────────
-- بناء أرصدة العملاء من الطلبات الموجودة أصلاً، عشان العملاء القدام ميبدأوش
-- من الصفر. الطلبات الملغية مش بتتحسب.
insert into public.customers (phone, name, spent, lifetime, orders_count, created_at, updated_at)
select
  public.normalize_phone(data #>> '{customer,phone}') as phone,
  coalesce((array_agg(data #>> '{customer,name}' order by created_at desc))[1], '') as name,
  sum(greatest(0, coalesce((data ->> 'subtotal')::numeric, (data ->> 'total')::numeric, 0))) as spent,
  sum(greatest(0, coalesce((data ->> 'subtotal')::numeric, (data ->> 'total')::numeric, 0))) as lifetime,
  count(*)::integer as orders_count,
  min(created_at), max(created_at)
from public.orders
where length(public.normalize_phone(data #>> '{customer,phone}')) >= 8
  and coalesce(data ->> 'status', 'new') <> 'cancelled'
group by 1
on conflict (phone) do nothing;

-- ملاحظة: الأرصدة المرحّلة ممكن تكون أكبر من العتبة، يعني أول طلب لعميل قديم
-- كبير هياخد الخصم على طول. ده مقصود — العميل فعلاً اشترى القيمة دي.
-- لو مش عايز ده، نفّذ: update public.customers set spent = 0;

alter table public.customers replica identity full;
