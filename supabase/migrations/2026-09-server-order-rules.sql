-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: فرض قواعد الطلب على السيرفر + تصحيح صلاحيات القراءة + رصيد كاشك
--
-- نفّذ الملف ده مرة واحدة في Supabase Dashboard → SQL Editor على قاعدة بيانات
-- شغالة بالفعل. الملف idempotent (ينفع يتنفذ أكتر من مرة بأمان)، وهو نفس
-- محتوى supabase/schema.sql المحدّث — يعني لو نفّذت schema.sql كامل مش محتاج
-- الملف ده.
--
-- بيصلّح ٤ حاجات:
--
-- (١) قواعد قبول الطلب كانت متفروضة في المتصفح بس.
--     أي حد يبعت POST على /api/orders (أو ينادي Supabase REST مباشرةً) كان
--     بيعدّي: المحل مقفول، السلة مقفولة، نوع طلب مش مفعّل، أقل من الحد الأدنى،
--     وبيانات عميل ناقصة. دلوقتي place_order بترفض كل دي.
--
-- (٢) سياسات RLS على orders وcustomers كانت `using (true)` لأي مستخدم مسجّل
--     دخول في المشروع — يعني بيانات كل العملاء وكل الطلبات مكشوفة. بقت
--     مقصورة على admin وinvoice_staff.
--
-- (٣) current_app_role كانت بترجّع 'admin' لأي قيمة دور مش معروفة، فغلطة
--     إملائية في app_metadata.role كانت بتدّي صلاحيات أدمن كاملة.
--
-- (٤) رصيد «كاشك» كان بينحرف عند إلغاء طلب ورجوعه، بسبب قَصّ القيم السالبة
--     عند الصفر. دلوقتي الفروق المطبّقة فعلاً بتتسجّل في الطلب وبتتعكس بالظبط.
--
-- ملحوظة: مفيش تغيير في شكل الجداول — دوال وسياسات بس.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) الأدوار: قيمة غير معروفة = بدون صلاحيات (مش admin)
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


-- (2) هل المحل بيستقبل طلبات دلوقتي؟ (نفس منطق effectiveStoreOpen في TypeScript)
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


-- (3) قراءة الطلبات وبيانات العملاء: الأدمن وموظف الفواتير بس
drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_owner_read" on public.orders
  for select to authenticated
  using (public.current_app_role() in ('admin', 'invoice_staff'));

drop policy if exists "customers_staff_read" on public.customers;
create policy "customers_staff_read" on public.customers
  for select to authenticated
  using (public.current_app_role() in ('admin', 'invoice_staff'));


-- (4) تسجيل الطلب مع فرض كل قواعد المحل على السيرفر
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


-- (5) تغيير حالة الطلب مع عكس دقيق لرصيد «كاشك»
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
