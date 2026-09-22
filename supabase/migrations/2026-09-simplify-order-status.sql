-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: تبسيط حالات الطلب إلى (جديد / ملغي)
--
-- نفّذ الملف ده مرة واحدة في Supabase Dashboard → SQL Editor على قاعدة
-- بيانات شغالة بالفعل. الملف idempotent (ينفع يتنفذ أكتر من مرة بأمان)،
-- وهو نفس محتوى supabase/schema.sql المحدّث — يعني لو نفّذت schema.sql
-- كامل مش محتاج الملف ده.
--
-- المنطق: أي طلب جه من الموقع هيتنفذ (توصيل أو استلام من المحل)، فحالتا
-- «مؤكد» و«تم التسليم» اتشالوا من التطبيق. الحالة الوحيدة اللي الأدمن
-- بيغيّرها هي «ملغي» (وممكن يرجّع الملغي جديد).
--
-- ملحوظة: التطبيق شغال حتى من غير تنفيذ الملف ده — لأن new وcancelled
-- كانوا مسموحين في الدالة القديمة أصلاً. الملف بيقفل الباب قدام الحالتين
-- القديمتين وبينظّف البيانات المخزّنة.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) الدالة بتقبل جديد/ملغي بس
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


-- (2) تنظيف الطلبات القديمة: اللي كانت «مؤكد» أو «تم التسليم» بتبقى «جديد»
--     (يعني طلب شغال — مش ملغي). الطلبات الملغية ما بتتغيرش.
update public.orders
set data = data || jsonb_build_object('status', 'new')
where data ->> 'status' in ('confirmed', 'delivered');
