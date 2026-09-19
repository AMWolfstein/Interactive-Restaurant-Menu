-- شغّل الملف مرة واحدة فقط لبدء المتجر بقاعدة فارغة.
-- يمسح القائمة والطلبات القديمة، وبعدها أضف أقسامك ومنتجاتك من لوحة التحكم.
truncate table public.orders;
delete from public.menu_data where slug = 'main';
