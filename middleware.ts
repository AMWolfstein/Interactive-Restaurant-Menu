import { NextResponse, type NextRequest } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

/**
 * CSP بـnonce لكل طلب بدل `'unsafe-inline'`.
 *
 * ليه الملف ده موجود: الـCSP القديمة كانت بتسمح بـ`script-src 'unsafe-inline'`،
 * وده عملياً بيلغي أهم فايدة من الـCSP — أي سكربت متحقون في الصفحة كان هيشتغل
 * عادي. المشكلة إن App Router بيحقن سكربتات inline بنفسه (بيانات الهيدريشن
 * `self.__next_f.push(...)`) ومحتواها بيتغير كل طلب، فالـhash مش حل. الحل
 * الوحيد هو nonce بيتولد لكل طلب — وده لازم يحصل في middleware.
 *
 * التكلفة المعتادة للطريقة دي إن الصفحات بتبقى dynamic، بس ده مش فارق هنا:
 * كل صفحات الـHTML في المشروع (`/`, `/menu`, `/admin`, `/invoices`, `/qr`)
 * كانت dynamic أصلاً لأنها بتقرا المنيو من الداتابيز وقت الطلب. الحاجات
 * الستاتيك الوحيدة هي الأيقونات والـmanifest وrobots/sitemap، وكلها
 * مستثناة من الـmatcher تحت وما فيهاش سكربتات.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' بيخلي السكربتات اللي الـbootstrap بيحمّلها (الـchunks)
    // موثوقة بالوراثة من غير ما نضطر نسرد كل مسار. المتصفحات الحديثة بتتجاهل
    // 'self' لما يكون 'strict-dynamic' موجود، وبنسيبها كـfallback للقديمة.
    // 'unsafe-eval' في التطوير بس — react-refresh محتاجه.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // الاستايل لسه محتاج unsafe-inline: رياكت بيكتب style={{...}} على وسم
    // html نفسه (لون البراند والخط)، وNext بيحقن <style> للـCSS.
    // الخطر هنا أقل بكتير من السكربت.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob:",
    // تصدير المنيو PNG بيقرا الصور والخطوط بـfetch قبل ما يحوّلها data:
    // فلازم تكون مصادر الصور/الخطوط مسموحة هنا كمان مش في img-src/font-src بس.
    [
      "connect-src 'self' data: blob:",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://api.cloudinary.com",
      "https://res.cloudinary.com",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ].join(" "),
    // لازم صريحة: worker-src بترجع لـscript-src لو مش مكتوبة، و'strict-dynamic'
    // بيلغي 'self' هناك — يعني تسجيل /sw.js كان هيتمنع، وده بيكسر الإشعارات
    // وعمل التطبيق أوفلاين.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(nonce);

  // الـnonce لازم يوصل للصفحة عشان تحطه على السكربتات الـinline بتاعتنا،
  // والـCSP نفسها لازم تتحط على هيدرات الطلب كمان — Next بيقراها من هناك
  // عشان يحقن نفس الـnonce تلقائياً في السكربتات اللي بيولّدها هو.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * كل المسارات ما عدا:
     * - _next/static و _next/image (ملفات مبنية، مالهاش لازمة وبتبطّأ)
     * - الأيقونات والـmanifest وrobots/sitemap (مخرجات ستاتيك من غير سكربتات)
     */
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
