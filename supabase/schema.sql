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

alter table public.catalog_data enable row level security;
alter table public.orders enable row level security;

drop policy if exists "catalog_public_read" on public.catalog_data;
create policy "catalog_public_read" on public.catalog_data for select using (true);

drop policy if exists "catalog_owner_write" on public.catalog_data;
create policy "catalog_owner_write" on public.catalog_data
  for all to authenticated using (true) with check (true);

drop policy if exists "orders_owner_read" on public.orders;
create policy "orders_owner_read" on public.orders
  for select to authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.catalog_data to anon, authenticated;
grant insert, update, delete on public.catalog_data to authenticated;
grant select on public.orders to authenticated;

-- يسجل الطلب فقط. لا يتابع أو يخصم أي مخزون.
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
  v_order_type := coalesce(payload ->> 'orderType', 'delivery');
  if v_order_type not in ('delivery', 'pickup', 'instore') then
    raise exception 'نوع الطلب غير صالح' using errcode = '22023';
  end if;

  select coalesce(sum((elem->>'unitPrice')::numeric * (elem->>'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(v_order_lines) as elem;

  if v_order_type = 'delivery' then
    v_free_over := greatest(0, coalesce((v_commerce->>'freeDeliveryOver')::numeric, 0));
    v_fee := greatest(0, coalesce((v_commerce->>'deliveryFee')::numeric, 0));
    if not (v_free_over > 0 and v_subtotal >= v_free_over) then v_delivery := v_fee; end if;
  end if;
  v_pct := greatest(0, coalesce((v_commerce->>'serviceChargePercent')::numeric, 0));
  if v_pct > 0 then v_service := round((v_subtotal + v_delivery) * v_pct / 100); end if;
  v_total := v_subtotal + v_delivery + v_service;

  v_now_iso := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_order_id := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_order := jsonb_build_object(
    'id', v_order_id, 'createdAt', v_now_iso,
    'customer', jsonb_build_object(
      'name', left(btrim(coalesce(payload #>> '{customer,name}', '')), 100),
      'phone', left(btrim(coalesce(payload #>> '{customer,phone}', '')), 30),
      'address', left(btrim(coalesce(payload #>> '{customer,address}', '')), 500),
      'notes', left(btrim(coalesce(payload #>> '{customer,notes}', '')), 500)
    ),
    'orderType', v_order_type, 'lines', v_order_lines, 'total', v_total
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
