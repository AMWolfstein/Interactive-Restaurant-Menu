import { WifiOff } from "lucide-react";

/** يظهر فقط وقت انقطاع الشبكة بدون منع تصفح الصفحات المخزنة في PWA. */
export function OfflineBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[60] flex h-9 items-center justify-center gap-2 bg-amber-400 px-3 text-center text-[11px] font-black text-amber-950 shadow-sm">
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      أنت غير متصل بالإنترنت — يمكنك تصفح النسخة المحفوظة، لكن إرسال الطلبات متوقف مؤقتاً.
    </div>
  );
}
