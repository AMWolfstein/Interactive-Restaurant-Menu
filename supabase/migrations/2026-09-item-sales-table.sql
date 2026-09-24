-- ═══════════════════════════════════════════════════════════════════════════
-- نقل عدّاد المبيعات (salesCount) لجدول مستقل
--
-- المشكلة: `salesCount` كان حقل جوه JSON الكتالوج في `catalog_data.data`.
-- عشان كده كل طلب في `place_order` كان لازم:
--   ١) ياخد `for update` على صف الكتالوج — وهو صف واحد للمتجر كله، يعني
--      كل الطلبات المتوازية بتتصفّ ورا بعض حتى لو على منتجات مختلفة تماماً.
--   ٢) يعيد بناء مصفوفة المنتجات كلها في الذاكرة.
--   ٣) يكتب الكتالوج بالكامل تاني (عشرات/مئات الكيلوبايت) عشان رقم واحد.
--
-- الحل: جدول `item_sales` فيه صف صغير لكل منتج. التزويد بقى جملة upsert
-- واحدة بتقفل صفوف المنتجات المطلوبة بس.
--
-- الملف idempotent — ينفّذ أكتر من مرة من غير مشاكل.
-- نفّذه في Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── (١) الجدول ─────────────────────────────────────────────────────────────
create table if not exists public.item_sales (
  item_id text primary key,
  sales_count bigint not null default 0 check (sales_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.item_sales enable row level security;

-- قراءة عامة: الأرقام دي بتظهر في «الأكثر مبيعاً» للزوار.
-- مفيش policy كتابة خالص — `place_order` بس (security definer) بيكتب فيه،
-- فمحدش يقدر يزوّد عدّاد منتج من المتصفح.
drop policy if exists "item_sales_public_read" on public.item_sales;
create policy "item_sales_public_read" on public.item_sales for select using (true);

grant select on public.item_sales to anon, authenticated;

-- ── (٢) نقل الأرقام الموجودة من JSON الكتالوج ──────────────────────────────
-- بنستخدم greatest() مع القيمة الحالية بدل ما نجمع، عشان لو الملف اتنفّذ
-- تاني ما يضاعفش الأرقام.
insert into public.item_sales (item_id, sales_count)
select elem ->> 'id',
       greatest(0, coalesce((elem ->> 'salesCount')::bigint, 0))
  from public.catalog_data,
       lateral jsonb_array_elements(data -> 'items') as elem
 where slug = 'main'
   and nullif(btrim(coalesce(elem ->> 'id', '')), '') is not null
on conflict (item_id) do update
  set sales_count = greatest(public.item_sales.sales_count, excluded.sales_count);

-- ── (٣) place_order من غير قفل الكتالوج ────────────────────────────────────
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

  -- من غير `for update`: عدّاد المبيعات بقى في جدول public.item_sales، فمحدش
  -- بيكتب على صف الكتالوج وقت الطلب. قبل كده كل طلب كان بيقفل الصف ده —
  -- وهو صف واحد للمتجر كله — فالطلبات المتوازية كانت بتتصفّ ورا بعض.
  select data into v_menu from public.catalog_data where slug = 'main';
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

  -- عدّادات المبيعات: جملة واحدة على جدول مستقل بدل إعادة كتابة الكتالوج كله.
  -- القفل هنا على صفوف المنتجات المطلوبة بس، فطلبين لمنتجين مختلفين
  -- ما بيستنّوش بعض خالص.
  if v_sales <> '{}'::jsonb then
    insert into public.item_sales as s (item_id, sales_count, updated_at)
    select key, value::text::bigint, v_now from jsonb_each(v_sales)
    on conflict (item_id) do update
      set sales_count = s.sales_count + excluded.sales_count,
          updated_at  = excluded.updated_at;
  end if;

  return jsonb_build_object('order', v_order);
end;
$function$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- بعد التنفيذ: الأرقام القديمة اللي لسه في JSON الكتالوج بتفضل موجودة كنسخة
-- احتياطية، والتطبيق بيفضّل عليها أرقام `item_sales` وقت القراءة. مش محتاجة
-- تتمسح — أول حفظ للكتالوج من لوحة التحكم هيحدّثها لوحدها.
-- ═══════════════════════════════════════════════════════════════════════════
