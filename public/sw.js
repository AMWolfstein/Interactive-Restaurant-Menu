// غيّر الرقم ده لو عدّلت استراتيجية الكاش — بيمسح كل النسخ القديمة.
const CACHE_NAME = "store-catalog-v5";
// صفحة احتياطية للعرض وقت انقطاع النت فقط.
const OFFLINE_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

/**
 * الأصول الثابتة بس هي اللي بتتخزن (ملفات /_next/static وصور public):
 * أسماءها فيها بصمة بتتغير مع كل نشر، فمفيش خطر إنها ترجع نسخة قديمة.
 * أي حاجة فيها بيانات المحل (HTML أو RSC أو manifest) بتتجاب من الشبكة
 * دايماً — عشان الزائر ما يشوفش شكل أو إعدادات قديمة بعد تعديل الأدمن.
 */
function isCacheableAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  // دول بيتولدوا من إعدادات البراند، وبالتالي مش static حتى لو favicon
  // امتداده ico. تخزينهم cache-first كان ممكن يثبت اللوجو/اللون القديم.
  if (["/icon", "/apple-icon", "/favicon.ico", "/manifest.webmanifest"].includes(url.pathname)) return false;
  return /\.(?:css|js|woff2?|png|jpe?g|gif|svg|webp|avif|ico)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  // الصفحات: الشبكة أولاً عشان بيانات المحل تبقى دايماً أحدث نسخة،
  // والكاش بيشتغل بس لو النت مقطوع.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // حمولة RSC والـ manifest وأي طلب مش أصل ثابت: من الشبكة دايماً.
  if (!isCacheableAsset(url) || url.searchParams.has("_rsc")) return;

  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "تحديث من المتجر", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "تحديث من المتجر";
  const options = {
    body: payload.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    image: payload.image || undefined,
    data: { url: payload.url || "/" },
    dir: "rtl",
    lang: "ar",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      return clients.openWindow(target);
    }),
  );
});
