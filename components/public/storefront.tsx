"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type SVGProps } from "react";
import {
  Clock,
  Search,
  Settings2,
  ShoppingBag,
  Sparkles,
  Store,
  Phone,
  MapPin,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useMenu } from "@/lib/use-menu";
import { useCart } from "@/lib/use-cart";
import { computeTotals, formatPrice, pick, toWhatsappNumber } from "@/lib/format";
import { useStoreOpen } from "@/lib/use-store-open";
import { describeNextOpening } from "@/lib/schedule";
import { cx } from "@/lib/cx";
import { ProductCard, ProductImage } from "@/components/public/product-card";
import { CartSheet } from "@/components/public/cart-sheet";
import { ThemeToggle } from "@/components/public/theme-toggle";
import { PwaInstallButton } from "@/components/public/pwa-install-button";
import { PreviousOrderButton } from "@/components/public/previous-order-button";
import { FAVORITES_SERVER_SNAPSHOT, getFavoritesSnapshot, subscribeFavorites } from "@/lib/favorites-store";
import { isItemOnOffer } from "@/lib/offers";
import { useOnlineStatus } from "@/lib/use-online-status";
import { HeroCarousel } from "@/components/public/hero-carousel";
import { OfflineBanner } from "@/components/public/offline-banner";
import { PushNotificationButton } from "@/components/public/push-notification-button";

const ALL = "all";
const FAVORITES = "favorites";
const OFFERS = "offers";
type SortBy = "newest" | "priceAsc" | "priceDesc";
type SocialIconName = "whatsapp" | "instagram" | "facebook" | "tiktok";
interface SocialLink {
  key: SocialIconName;
  label: string;
  href: string;
  className: string;
}
/** عدد المنتجات المعروضة في الصفحة الواحدة من الكتالوج. */
// عدد المنتجات في الصفحة بيتماشى مع أعمدة شبكة الموبايل: عمودين ← ١٦ منتج (٨ صفوف)،
// ٣ أعمدة ← ١٥ منتج (٥ صفوف).
const PAGE_SIZE_BY_COLUMNS: Record<number, number> = { 2: 16, 3: 15 };
const DEFAULT_PAGE_SIZE = 15;

function safeHref(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
  } catch {
    // Invalid URLs are intentionally ignored.
  }
  return undefined;
}

export function Storefront() {
  const { data } = useMenu();
  const { brand, commerce, contact, categories, suppliers, items } = data;
  const lang = brand.language;
  const en = lang === "en";
  const storeOpen = useStoreOpen(contact);
  const closedHint = contact.autoSchedule ? describeNextOpening(contact.weeklySchedule ?? []) : "";

  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [page, setPage] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const online = useOnlineStatus();

  const cart = useCart(items);
  const favoriteIds = useSyncExternalStore(subscribeFavorites, getFavoritesSnapshot, () => FAVORITES_SERVER_SNAPSHOT);
  const totals = useMemo(() => computeTotals(cart.lines, commerce, "delivery"), [cart.lines, commerce]);

  const visibleCategories = useMemo(() => categories.filter((category) => category.visible), [categories]);
  const sortItems = useCallback((source: typeof items) => {
    if (sortBy === "priceAsc") return [...source].sort((a, b) => a.price - b.price);
    if (sortBy === "priceDesc") return [...source].sort((a, b) => b.price - a.price);
    // الترتيب الافتراضي: الأحدث في تاريخ الإضافة الأول. المنتجات المعلّمة «جديد»
    // بتتقدم بس بين اللي مالهمش تاريخ إنشاء (بيانات قديمة منسوخة من نسخ سابقة).
    return [...source].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aDate !== bDate) return bDate - aDate;
      return Number(b.isNew) - Number(a.isNew);
    });
  }, [sortBy]);
  const nameOf = (value: { name: string; nameEn?: string }) => pick(lang, value.name, value.nameEn);

  const searched = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [item.name, item.nameEn, item.description, item.descriptionEn]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(term)),
    );
  }, [items, query]);
  const featured = useMemo(
    () => (commerce.enableFeatured && activeCategory === ALL && !query
      ? items.filter((item) => item.available && (item.salesCount ?? 0) > 0).sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0))
      : []),
    [commerce.enableFeatured, activeCategory, query, items],
  );

  // كل المنتجات في قائمة واحدة تحت بعض — من غير تقسيم أقسام — بعد تطبيق
  // الفلاتر (البحث/القسم/المورد/المفضلة/العروض) والترتيب المختار.
  const listItems = useMemo(() => {
    const pool = searched.filter((item) => item.available || query);
    if (supplierFilter) return sortItems(pool.filter((item) => item.supplier?.trim() === supplierFilter));
    if (activeCategory === FAVORITES) return sortItems(pool.filter((item) => favoriteIds.includes(item.id)));
    if (activeCategory === OFFERS) return sortItems(pool.filter((item) => isItemOnOffer(item)));
    if (activeCategory !== ALL) return sortItems(pool.filter((item) => item.categoryId === activeCategory));
    return sortItems(pool);
  }, [searched, activeCategory, query, favoriteIds, supplierFilter, sortItems]);

  const isEmpty = listItems.length === 0;

  // ترقيم الصفحات: ١٥ أو ١٦ منتج في الصفحة حسب أعمدة الشبكة، مع رجوع تلقائي للصفحة الأولى عند أي تغيير فلتر.
  const pageSize = commerce.productLayout === "grid"
    ? PAGE_SIZE_BY_COLUMNS[commerce.mobileGridColumns] ?? DEFAULT_PAGE_SIZE
    : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(listItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => listItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [listItems, currentPage, pageSize],
  );

  // أي تغيير في الفلترة أو الترتيب بيرجّع المستخدم للصفحة الأولى — بنحدّثها
  // جوه الـ handlers نفسها بدل effect.
  const selectCategory = useCallback((next: string) => {
    setActiveCategory(next);
    setSupplierFilter(null);
    setPage(1);
  }, []);
  const selectSupplier = useCallback((supplier: string) => {
    setSupplierFilter(supplier);
    setActiveCategory(ALL);
    setPage(1);
  }, []);
  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setPage(1);
  }, []);
  const updateSort = useCallback((value: SortBy) => {
    setSortBy(value);
    setPage(1);
  }, []);

  // بعد تغيير الصفحة بنرجّع المستخدم لأول القائمة عشان يشوف المنتجات الجديدة.
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const goToPage = useCallback((next: number) => {
    setPage(next);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const selectedCategory = activeCategory !== ALL ? categories.find((c) => c.id === activeCategory) : undefined;
  const listTitle = supplierFilter
    ? `${en ? "Supplier" : "منتجات المورد"}: ${supplierFilter}`
    : activeCategory === FAVORITES
      ? en ? "Favorites" : "المفضلة"
      : activeCategory === OFFERS
        ? en ? "Available offers" : "العروض المتاحة"
        : selectedCategory
          ? nameOf(selectedCategory)
          : en ? "All products" : "كل المنتجات";
  const listEmoji = supplierFilter
    ? "🏷️"
    : activeCategory === FAVORITES
      ? "❤️"
      : activeCategory === OFFERS
        ? "🔥"
        : selectedCategory?.emoji ?? "🛍️";
  // في العربي «التالية» بتشاور شمال، وفي الإنجليزي العكس.
  const PrevIcon = en ? ChevronLeft : ChevronRight;
  const NextIcon = en ? ChevronRight : ChevronLeft;
  const whatsappNumber = toWhatsappNumber(contact.whatsapp);
  const instagramHref = safeHref(contact.instagram);
  const facebookHref = safeHref(contact.facebook);
  const tiktokHref = safeHref(contact.tiktok);
  const socialLinks: SocialLink[] = [
    whatsappNumber
      ? {
          key: "whatsapp",
          label: en ? "WhatsApp" : "واتساب",
          href: `https://wa.me/${whatsappNumber}`,
          className: "hover:border-[#25D366]/60 hover:text-[#25D366]",
        }
      : null,
    instagramHref
      ? {
          key: "instagram",
          label: en ? "Instagram" : "إنستجرام",
          href: instagramHref,
          className: "hover:border-[#E1306C]/60 hover:text-[#E1306C]",
        }
      : null,
    facebookHref
      ? {
          key: "facebook",
          label: en ? "Facebook" : "فيسبوك",
          href: facebookHref,
          className: "hover:border-[#1877F2]/60 hover:text-[#1877F2]",
        }
      : null,
    tiktokHref
      ? {
          key: "tiktok",
          label: en ? "TikTok" : "تيك توك",
          href: tiktokHref,
          className: "hover:border-ink/50 hover:text-ink",
        }
      : null,
  ].filter((link): link is SocialLink => link !== null);

  return (
    <div className="min-h-screen bg-bg pb-28 text-ink" dir={en ? "ltr" : "rtl"}>
      <OfflineBanner visible={!online} />
      {/* شريط الإعلان */}
      {brand.announcementEnabled && brand.announcementText.trim() ? (
        <div className="overflow-hidden border-b border-accent/25 bg-accent text-accent-contrast">
          <div className="marquee-track flex w-max gap-10 py-2 text-xs font-black">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="whitespace-nowrap">
                {brand.announcementText}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* الهيدر */}
      <header className={cx("sticky z-40 border-b border-line bg-bg/90 backdrop-blur-md", online ? "top-0" : "top-9")}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {brand.logo ? (
              <ProductImage src={brand.logo} alt="" className="h-11 w-11 rounded-xl border border-line" />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-contrast">
                <Store className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-base font-black leading-tight">
                {pick(lang, brand.storeName, brand.storeNameEn)}
              </h1>
              <p className="truncate text-[11px] text-muted">{pick(lang, brand.tagline, brand.taglineEn)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cx(
                "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-flex",
                storeOpen ? "bg-emerald-500/12 text-emerald-400" : "bg-red-500/12 text-red-400",
              )}
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", storeOpen ? "bg-emerald-400" : "bg-red-400")} />
              {storeOpen ? (en ? "Open now" : "مفتوح الآن") : en ? "Closed" : "مقفل"}
            </span>
            <PreviousOrderButton
              language={lang}
              validItemIds={new Set(items.map((item) => item.id))}
              onRestore={cart.restore}
              onOpenCart={() => setCartOpen(true)}
            />
            <PwaInstallButton language={lang} />
            <PushNotificationButton language={lang} />
            <ThemeToggle fallback={brand.theme} language={lang} />
            <a
              href="/admin"
              title={en ? "Admin panel" : "لوحة التحكم"}
              className="hidden h-9 w-9 place-items-center rounded-full border border-line text-muted transition hover:text-accent sm:grid"
            >
              <Settings2 className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-accent transition hover:border-accent/60"
              aria-label={en ? "Open cart" : "فتح السلة"}
            >
              <ShoppingBag className="h-4.5 w-4.5" />
              {totals.itemCount > 0 ? (
                <span className="absolute -end-1 -top-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 text-[10px] font-black text-accent-contrast">
                  {totals.itemCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4">
        {/* الهيرو */}
        {brand.showHero ? (
          <section className="relative mt-5 overflow-hidden rounded-xl2 border border-line">
            <HeroCarousel images={brand.heroImages} fallback={brand.heroImage} label={en ? "Featured images" : "صور مميزة"} />
            <div className="pointer-events-none relative bg-[linear-gradient(100deg,rgba(0,0,0,.86),rgba(0,0,0,.35))] p-6 sm:p-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-black text-accent">
                <Sparkles className="h-3 w-3" />
                {pick(lang, brand.tagline, brand.taglineEn)}
              </span>
              <h2 className="mt-3 max-w-md text-2xl font-black leading-snug text-white sm:text-3xl">
                {brand.heroTitle}
              </h2>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-white/75 sm:text-sm">{brand.heroSubtitle}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a
                  href="#menu"
                  className="pointer-events-auto rounded-xl bg-accent px-4 py-2.5 text-xs font-black text-accent-contrast transition hover:brightness-110"
                >
                  {en ? "Browse the products" : "اتفرّج على المنتجات 👀"}
                </a>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-3 py-2.5 text-[11px] font-bold text-white/80">
                  <Clock className="h-3.5 w-3.5" /> {contact.openingHours}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {!storeOpen ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-card border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-400">
            <Store className="h-4 w-4" /> {contact.closedMessage}
            {closedHint ? <span className="text-[11px] font-medium text-amber-400/80">· {closedHint}</span> : null}
          </div>
        ) : null}

        {/* البحث + الأقسام */}
        <div id="menu" className={cx("sticky z-30 -mx-4 mt-5 bg-bg/92 px-4 py-3 backdrop-blur-md", online ? "top-[68px]" : "top-[104px]")}>
          {commerce.enableSearch ? (
            <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 focus-within:border-accent">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                placeholder={en ? "Search for a product…" : "دوّر على أي منتج… أرز، شاي، مناديل"}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted/70"
              />
              {query ? (
                <button onClick={() => updateQuery("")} className="text-[11px] font-bold text-muted hover:text-ink">
                  ✕
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            <CategoryChip
              active={activeCategory === ALL}
              onClick={() => selectCategory(ALL)}
              label={en ? "All" : "الكل"}
              emoji="🛍️"
            />
            <CategoryChip
              active={activeCategory === FAVORITES}
              onClick={() => selectCategory(FAVORITES)}
              label={en ? "Favorites" : "المفضلة"}
              emoji="❤️"
            />
            <CategoryChip
              active={activeCategory === OFFERS}
              onClick={() => selectCategory(OFFERS)}
              label={en ? "Offers" : "العروض"}
              emoji="🔥"
            />
            {visibleCategories.map((category) => (
              <CategoryChip
                key={category.id}
                active={activeCategory === category.id}
                onClick={() => selectCategory(category.id)}
                label={nameOf(category)}
                emoji={category.emoji}
              />
            ))}
            {suppliers.filter((supplier) => supplier.visible).map((supplier) => (
              <CategoryChip
                key={`supplier-${supplier.id}`}
                active={supplierFilter === supplier.name}
                onClick={() => selectSupplier(supplier.name)}
                label={supplier.name}
                emoji="🏷️"
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-muted">{en ? "Sort" : "ترتيب"}</span>
            <select
              value={sortBy}
              onChange={(event) => updateSort(event.target.value as SortBy)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-bold text-ink outline-none transition focus:border-accent"
              aria-label={en ? "Sort products" : "ترتيب المنتجات"}
            >
              <option value="newest">{en ? "Newest first" : "الأحدث أولاً"}</option>
              <option value="priceAsc">{en ? "Price: low to high" : "السعر: من الأقل للأعلى"}</option>
              <option value="priceDesc">{en ? "Price: high to low" : "السعر: من الأعلى للأقل"}</option>
            </select>
          </div>
        </div>

        {/* الأكثر مبيعاً */}
        {featured.length > 0 ? (
          <section className="mt-3">
            <h3 className="mb-2 text-sm font-black text-accent">{commerce.featuredLabel}</h3>
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
              {featured.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  onClick={() => cart.add(item.id)}
                  className="w-40 shrink-0 snap-start overflow-hidden rounded-card border border-line bg-surface text-start transition hover:border-accent/50"
                >
                  <ProductImage src={item.image} alt={nameOf(item)} className="h-24 w-full" />
                  <div className="p-2.5">
                    <p className="truncate text-xs font-bold">{nameOf(item)}</p>
                    <p className="mt-1 text-[11px] font-black text-accent">
                      {formatPrice(item.price, lang, commerce)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* شبكة المنتجات — كل المنتجات تحت بعض في قائمة واحدة */}
        <div ref={listTopRef} className="mt-5 scroll-mt-52 space-y-7">
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-black">
                <span aria-hidden>{listEmoji}</span>
                {listTitle}
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted">
                  {listItems.length}
                </span>
              </h3>
              {totalPages > 1 ? (
                <span className="shrink-0 text-[11px] font-bold text-muted">
                  {en ? `Page ${currentPage} of ${totalPages}` : `صفحة ${currentPage} من ${totalPages}`}
                </span>
              ) : null}
            </div>
            <div className={cx(
              "grid",
              commerce.productLayout === "grid" ? "mobile-product-grid gap-2 sm:gap-3" : "grid-cols-1 gap-3 md:grid-cols-2",
            )}
            style={commerce.productLayout === "grid" ? { "--mobile-grid-columns": commerce.mobileGridColumns } as CSSProperties : undefined}>
              {pagedItems.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  lang={lang}
                  commerce={commerce}
                  getQuantity={(variantId) => cart.quantityOf(item.id, variantId)}
                  onAdd={(variantId) => cart.add(item.id, variantId)}
                  onRemoveOne={(variantId) => cart.setQuantity(item.id, cart.quantityOf(item.id, variantId) - 1, variantId)}
                  onSupplierClick={(supplier) => selectSupplier(supplier.trim())}
                  layout={commerce.productLayout}
                  disabled={!storeOpen || !commerce.enableCart}
                />
              ))}
            </div>
          </section>

          {isEmpty ? (
            <div className="rounded-xl2 border border-dashed border-line py-14 text-center">
              <p className="text-sm font-black">{en ? "Nothing matches your search" : "مفيش حاجة يطابق البحث 🤷‍♂️"}</p>
              <p className="mt-1 text-xs text-muted">
                {en ? "Try another word or pick another category" : "جرّب كلمة تانية أو اختار قسم تاني"}
              </p>
            </div>
          ) : null}

          {/* عداد الصفحات + التالية والسابقة */}
          {totalPages > 1 ? (
            <nav
              className="flex flex-col items-center gap-2.5 pt-1"
              aria-label={en ? "Products pagination" : "تصفح صفحات المنتجات"}
            >
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <PagerButton onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
                  <PrevIcon className="h-4 w-4" />
                  {en ? "Previous" : "السابقة"}
                </PagerButton>
                {pageSequence(currentPage, totalPages).map((entry, index) =>
                  entry === "gap" ? (
                    <span key={`gap-${index}`} className="px-0.5 text-xs font-black text-muted">
                      …
                    </span>
                  ) : (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => goToPage(entry)}
                      aria-current={entry === currentPage ? "page" : undefined}
                      className={cx(
                        "grid h-9 w-9 place-items-center rounded-full border text-xs font-black transition",
                        entry === currentPage
                          ? "border-accent bg-accent text-accent-contrast"
                          : "border-line bg-surface text-muted hover:border-accent/50 hover:text-ink",
                      )}
                    >
                      {entry}
                    </button>
                  ),
                )}
                <PagerButton onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
                  {en ? "Next" : "التالية"}
                  <NextIcon className="h-4 w-4" />
                </PagerButton>
              </div>
              <span className="text-[11px] font-bold text-muted">
                {en
                  ? `Page ${currentPage} of ${totalPages} — ${listItems.length} products`
                  : `صفحة ${currentPage} من ${totalPages} — ${listItems.length} منتج`}
              </span>
            </nav>
          ) : null}
        </div>

        {/* الفوتر */}
        <footer className="mt-10 rounded-xl2 border border-line bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-black">{pick(lang, brand.storeName, brand.storeNameEn)}</h4>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{contact.footerNote}</p>
            </div>
            <div className="space-y-1.5 text-xs text-muted">
              <p className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {contact.openingHours}
              </p>
              {contact.address ? (
                <a href={safeHref(contact.mapUrl)} target="_blank" rel="noopener" className="flex items-start gap-2 transition hover:text-accent">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {contact.address}
                </a>
              ) : null}
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/\D/g, "")}`} className="flex items-start gap-2 transition hover:text-accent">
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {contact.phone}
                </a>
              ) : null}
              {socialLinks.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1" aria-label={en ? "Social links" : "روابط السوشيال"}>
                  {socialLinks.map((link) => (
                    <a
                      key={link.key}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.label}
                      title={link.label}
                      className={cx(
                        "grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-2 text-muted transition hover:-translate-y-0.5 hover:bg-surface",
                        link.className,
                      )}
                    >
                      <SocialAppIcon name={link.key} className="h-4.5 w-4.5" />
                    </a>
                  ))}
                </div>
              ) : null}
              {commerce.paymentMethods.filter(Boolean).length > 0 ? (
                <div className="pt-1">
                  <p className="mb-1 text-[11px] font-bold text-muted">{en ? "Payment methods" : "طرق الدفع 💳"}</p>
                  <p className="flex flex-wrap gap-1.5">
                    {commerce.paymentMethods.filter(Boolean).map((method) => (
                      <span key={method} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-bold">
                        {method}
                      </span>
                    ))}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-muted">
            <span>
              © {new Date().getFullYear()} — {pick(lang, brand.storeName, brand.storeNameEn)}
            </span>
            <a href="/admin" className="inline-flex items-center gap-1 font-bold transition hover:text-accent">
              <Settings2 className="h-3 w-3" /> {en ? "Admin" : "لوحة التحكم"}
            </a>
          </div>
        </footer>
      </main>

      {/* شريط السلة العائم */}
      {commerce.enableCart && totals.itemCount > 0 ? (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card bg-accent px-4 py-3 text-accent-contrast shadow-[0_18px_45px_-18px_var(--accent)] transition hover:brightness-110 active:scale-[.99]"
        >
          <span className="flex items-center gap-2 text-xs font-black">
            <ShoppingBag className="h-4 w-4" />
            {totals.itemCount} {en ? "items" : "منتج"}
          </span>
          <span className="text-sm font-black">
            {formatPrice(totals.subtotal, lang, commerce)} {en ? "→ Review order" : "— راجع الطلب ←"}
          </span>
        </button>
      ) : null}

      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lines={cart.lines}
        setQuantity={cart.setQuantity}
        remove={cart.remove}
        clear={cart.clear}
      />
    </div>
  );
}

function SocialAppIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: SocialIconName }) {
  if (name === "whatsapp") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35ZM12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88ZM20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.48-8.42Z" />
      </svg>
    );
  }

  if (name === "instagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
        <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
        <circle cx="17.5" cy="6.5" r="1.25" fill="currentColor" />
      </svg>
    );
  }

  if (name === "facebook") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M14 8h2V5h-2.35C10.9 5 10 6.8 10 8.86V11H8v3h2v7h3v-7h2.35l.65-3h-3V9.2c0-.8.25-1.2 1-1.2Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M16.6 2c.28 1.62 1.16 3 2.5 3.82A6.23 6.23 0 0 0 22 6.57v3.05a9.05 9.05 0 0 1-5.34-1.72v6.83a6.03 6.03 0 1 1-5.2-5.97v3.16a2.96 2.96 0 1 0 2.09 2.81V2h3.05Z" />
    </svg>
  );
}

/** أرقام الصفحات المعروضة في العداد — مع اختصار «…» لو الصفحات كتير. */
function pageSequence(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...wanted].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const sequence: (number | "gap")[] = [];
  let previous = 0;
  for (const entry of sorted) {
    if (entry - previous > 1) sequence.push("gap");
    sequence.push(entry);
    previous = entry;
  }
  return sequence;
}

function PagerButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3.5 py-2 text-xs font-bold text-muted transition",
        "hover:border-accent/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  emoji,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  emoji?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-bold whitespace-nowrap transition",
        active
          ? "border-accent bg-accent text-accent-contrast shadow-[0_10px_24px_-14px_var(--accent)]"
          : "border-line bg-surface text-muted hover:border-accent/50 hover:text-ink",
      )}
    >
      {emoji ? <span aria-hidden>{emoji}</span> : null}
      {label}
    </button>
  );
}
