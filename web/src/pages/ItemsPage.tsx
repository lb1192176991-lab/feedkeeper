import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type Feed, type Folder, type Item } from "../api/client.ts";
import { CustomSelect, type SelectOption } from "../components/CustomSelect.tsx";
import { ArticleReaderModal } from "../components/ArticleReaderModal.tsx";
import { LoadingSpinner } from "../components/LoadingSpinner.tsx";
import { getItemsScrollY, setItemsScrollY, resetItemsScrollY } from "../utils/scrollState.ts";

let cachedItems: Item[] | null = null;
let cachedFeeds: Feed[] | null = null;
let cachedFolders: Folder[] | null = null;

export function ItemsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [feeds, setFeeds] = useState<Feed[]>(() => cachedFeeds || []);
  const [folders, setFolders] = useState<Folder[]>(() => cachedFolders || []);
  const [items, setItems] = useState<Item[]>(() => cachedItems || []);
  const [loading, setLoading] = useState<boolean>(() => cachedItems === null);
  const [selectedArticle, setSelectedArticle] = useState<Item | null>(null);

  const STORAGE_KEY_SCOPE = "feedkeeper_filter_scope";
  const STORAGE_KEY_UNREAD = "feedkeeper_filter_unread";
  const STORAGE_KEY_BOOKMARKED = "feedkeeper_filter_bookmarked";
  const articleParam = searchParams.get("article");

  // Initialize filterScope: URL takes precedence, then localStorage, fallback to ""
  const initialScope = (() => {
    const feedParam = searchParams.get("feed");
    if (feedParam) return `feed:${feedParam}`;
    const folderParam = searchParams.get("folder");
    if (folderParam) return `folder:${folderParam}`;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCOPE);
      if (saved) return saved;
    } catch {
      // Ignore localStorage errors
    }
    return "";
  })();

  const initialUnreadOnly = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_UNREAD);
      if (saved !== null) return saved === "true";
    } catch {
      // Ignore localStorage errors
    }
    return true; // Default behavior: only unread
  })();

  const initialBookmarkedOnly = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BOOKMARKED);
      if (saved !== null) return saved === "true";
    } catch {
      // Ignore localStorage errors
    }
    return false;
  })();

  const [filterScope, setFilterScope] = useState<string>(initialScope);
  const [unreadOnly, setUnreadOnly] = useState<boolean>(initialUnreadOnly);
  const [bookmarkedOnly, setBookmarkedOnly] = useState<boolean>(initialBookmarkedOnly);
  const [search, setSearch] = useState("");

  function toggleUnreadOnly() {
    resetItemsScrollY();
    setUnreadOnly((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_UNREAD, String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }

  function toggleBookmarkedOnly() {
    resetItemsScrollY();
    setBookmarkedOnly((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_BOOKMARKED, String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }

  // Restore scroll position when returning to items page
  useEffect(() => {
    const targetY = getItemsScrollY();
    if (targetY > 0) {
      window.scrollTo({ top: targetY, behavior: "instant" });
      const raf = requestAnimationFrame(() => {
        window.scrollTo({ top: targetY, behavior: "instant" });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, []);

  // Track scroll position on items page
  useEffect(() => {
    function handleScroll() {
      if (document.body.style.overflow !== "hidden") {
        setItemsScrollY(window.scrollY);
      }
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (document.body.style.overflow !== "hidden") {
        setItemsScrollY(window.scrollY);
      }
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Sync state if URL search params change (e.g. user clicked a feed in FeedsPage or browser back/forward)
  useEffect(() => {
    const feedParam = searchParams.get("feed");
    const folderParam = searchParams.get("folder");
    if (feedParam) {
      const newScope = `feed:${feedParam}`;
      if (newScope !== filterScope) resetItemsScrollY();
      setFilterScope(newScope);
      try {
        localStorage.setItem(STORAGE_KEY_SCOPE, newScope);
      } catch {
        // Ignore localStorage errors
      }
    } else if (folderParam) {
      const newScope = `folder:${folderParam}`;
      if (newScope !== filterScope) resetItemsScrollY();
      setFilterScope(newScope);
      try {
        localStorage.setItem(STORAGE_KEY_SCOPE, newScope);
      } catch {
        // Ignore localStorage errors
      }
    } else if (initialScope && !searchParams.toString()) {
      // If we restored from localStorage and URL has no params, reflect it in the URL
      const nextParams = new URLSearchParams(searchParams);
      if (initialScope.startsWith("feed:")) {
        nextParams.set("feed", initialScope.slice(5));
      } else if (initialScope.startsWith("folder:")) {
        nextParams.set("folder", initialScope.slice(7));
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams]);

  // Update URL search params and localStorage when filterScope changes
  function onScopeChange(newScope: string) {
    resetItemsScrollY();
    setFilterScope(newScope);
    try {
      if (newScope) {
        localStorage.setItem(STORAGE_KEY_SCOPE, newScope);
      } else {
        localStorage.removeItem(STORAGE_KEY_SCOPE);
      }
    } catch {
      // Ignore localStorage errors
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("feed");
    nextParams.delete("folder");
    if (newScope.startsWith("feed:")) {
      nextParams.set("feed", newScope.slice(5));
    } else if (newScope.startsWith("folder:")) {
      nextParams.set("folder", newScope.slice(7));
    }
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    Promise.all([
      api.listFeeds(),
      api.listFolders().catch(() => ({ folders: [] })),
    ])
      .then(([f, fol]) => {
        setFeeds(f);
        setFolders(fol.folders);
        cachedFeeds = f;
        cachedFolders = fol.folders;
      })
      .catch((err) => console.error("Failed to load initial feeds/folders:", err));
  }, []);

  const currentFeedId = filterScope.startsWith("feed:") ? Number(filterScope.slice(5)) : undefined;
  const currentFolderId = filterScope.startsWith("folder:") ? Number(filterScope.slice(7)) : undefined;

  async function load() {
    if (items.length === 0) {
      setLoading(true);
    }
    try {
      const data = await api.listItems({
        feedId: currentFeedId,
        folderId: currentFolderId,
        unreadOnly,
        bookmarkedOnly,
        search: search || undefined,
      });
      setItems(data);
      cachedItems = data;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(load, 200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterScope, unreadOnly, bookmarkedOnly, search]);

  // Synchronize selectedArticle with URL ?article=ID parameter
  useEffect(() => {
    if (articleParam) {
      const found = items.find((i) => i.id === Number(articleParam));
      if (found) {
        setSelectedArticle(found);
      }
    } else {
      setSelectedArticle(null);
    }
  }, [articleParam, items]);

  function openArticle(item: Item) {
    setSelectedArticle(item);
    if (!item.read) {
      api.markRead(item.id).catch(() => {});
      setItems((prev) => {
        const next = prev.map((i) => (i.id === item.id ? { ...i, read: true } : i));
        cachedItems = next;
        return next;
      });
      setSelectedArticle({ ...item, read: true });
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("article", String(item.id));
    setSearchParams(nextParams);
  }

  function closeArticle() {
    setSelectedArticle(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("article");
    setSearchParams(nextParams);
  }

  const selectedIndex = selectedArticle
    ? items.findIndex((i) => i.id === selectedArticle.id)
    : -1;
  const hasNext = selectedIndex >= 0 && selectedIndex < items.length - 1;
  const hasPrev = selectedIndex > 0;

  function handleNext() {
    if (hasNext) {
      openArticle(items[selectedIndex + 1]);
    }
  }

  function handlePrev() {
    if (hasPrev) {
      openArticle(items[selectedIndex - 1]);
    }
  }

  async function toggleRead(item: Item) {
    const nextRead = !item.read;
    if (item.read) await api.markUnread(item.id);
    else await api.markRead(item.id);
    setItems((prev) => {
      const next = prev.map((i) => (i.id === item.id ? { ...i, read: nextRead } : i));
      cachedItems = next;
      return next;
    });
    if (selectedArticle?.id === item.id) {
      setSelectedArticle((prev) => (prev ? { ...prev, read: nextRead } : null));
    }
  }

  async function toggleBookmark(item: Item) {
    const nextBookmarked = !item.bookmarked;
    if (item.bookmarked) await api.unbookmarkItem(item.id);
    else await api.bookmarkItem(item.id);
    setItems((prev) => {
      const next = prev.map((i) => (i.id === item.id ? { ...i, bookmarked: nextBookmarked } : i));
      cachedItems = next;
      return next;
    });
    if (selectedArticle?.id === item.id) {
      setSelectedArticle((prev) => (prev ? { ...prev, bookmarked: nextBookmarked } : null));
    }
  }

  async function onMarkAllRead() {
    await api.markAllRead({ feedId: currentFeedId, folderId: currentFolderId });
    await load();
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
  });

  const timeFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeStyle: "short",
  });

  function getFaviconUrl(item: Item): string | null {
    for (const source of [item.feed_site_url, item.feed_url, item.link]) {
      if (!source) continue;
      try {
        const url = new URL(source);
        if (url.protocol === "https:" || url.protocol === "http:") return `${url.origin}/favicon.ico`;
      } catch {
        // Try the next source URL.
      }
    }
    return null;
  }

  const scopeOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [{ value: "", label: t("items.allFeeds") }];
    if (folders.length > 0) {
      for (const folder of folders) {
        list.push({
          value: `folder:${folder.id}`,
          label: folder.name,
          group: t("feeds.folderGroup"),
          badge: folder.unread_count,
        });
      }
    }
    for (const feed of feeds) {
      list.push({
        value: `feed:${feed.id}`,
        label: feed.label ?? feed.title ?? feed.url,
        group: t("feeds.feedGroup"),
        badge: feed.unread_count,
      });
    }
    return list;
  }, [folders, feeds, t]);

  function handleItemUpdated(updated: Item) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    if (selectedArticle?.id === updated.id) {
      setSelectedArticle(updated);
    }
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-semibold">{t("items.title")}</h1>
        <button
          onClick={onMarkAllRead}
          className="btn-secondary text-xs sm:text-sm whitespace-nowrap"
        >
          {t("feeds.markAllRead")}
        </button>
      </div>

      <div className="card p-3 sm:p-4 flex flex-col sm:flex-row gap-2.5 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <input
            type="search"
            placeholder={t("items.searchPlaceholder")}
            className="input w-full pl-9 pr-3"
            value={search}
            onChange={(e) => {
              resetItemsScrollY();
              setSearch(e.target.value);
            }}
          />
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-45"
            style={{ color: "var(--c-text-muted)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        <div className="flex items-center gap-2 sm:contents">
          <CustomSelect
            value={filterScope}
            onChange={onScopeChange}
            options={scopeOptions}
            className="flex-1 min-w-0 sm:flex-none sm:w-64 shrink-0 block"
            placeholder={t("items.allFeeds")}
          />

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleBookmarkedOnly}
              title={bookmarkedOnly ? t("items.all") : t("items.bookmarkedOnly")}
              aria-label={t("items.bookmarkedOnly")}
              aria-pressed={bookmarkedOnly}
              className={`w-[38px] h-[38px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                bookmarkedOnly
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                  : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
              }`}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill={bookmarkedOnly ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>

            <button
              type="button"
              onClick={toggleUnreadOnly}
              title={unreadOnly ? t("items.all") : t("items.unreadOnly")}
              aria-label={t("items.unreadOnly")}
              aria-pressed={unreadOnly}
              className={`w-[38px] h-[38px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                unreadOnly
                  ? "bg-[var(--c-surface-hover)] border-[var(--c-blue3)] text-[var(--c-text)] shadow-xs"
                  : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:border-[var(--c-blue3)]"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill={unreadOnly ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <circle cx="12" cy="12" r="9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <LoadingSpinner size="lg" />
      ) : items.length === 0 ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("items.noItems")}</p>
      ) : (
        <ul className="flex flex-col gap-3 animate-page-fade">
          {items.map((item) => {
            const favicon = getFaviconUrl(item);
            const pubDate = item.published_at ? new Date(item.published_at) : null;

            return (
              <li
                key={item.id}
                onClick={() => openArticle(item)}
                className="card overflow-hidden p-4 sm:p-0 transition-colors duration-150 hover:bg-[var(--c-surface-hover)] hover:border-[var(--c-blue3)]/60 cursor-pointer group/card"
                style={{ opacity: item.read ? 0.6 : 1 }}
              >
                <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-0">
                  {/* Article thumbnail if available */}
                  {item.image_url && (
                    <div
                      className="order-first w-[calc(100%+2rem)] -mx-4 -mt-4 sm:m-0 sm:w-52 sm:min-w-52 h-48 sm:h-auto sm:self-stretch overflow-hidden shrink-0 border-b sm:border-b-0 sm:border-r bg-[var(--c-bg)] group transition-opacity hover:opacity-90 block"
                      style={{ borderColor: "var(--c-border)" }}
                    >
                      <img
                        src={item.image_url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                        onError={(e) => {
                          const parent = (e.currentTarget as HTMLElement).parentElement;
                          if (parent) parent.style.display = "none";
                        }}
                      />
                    </div>
                  )}

                  <div className="min-w-0 flex-1 sm:p-4 sm:pr-2 flex flex-col justify-between">
                    <div>
                      {/* Source row above headline with optional Favicon */}
                      <div className="flex items-center gap-2 text-xs mb-1.5 font-medium" style={{ color: "var(--c-text-muted)" }}>
                        {favicon && (
                          <img
                            src={favicon}
                            alt=""
                            className="w-3.5 h-3.5 rounded-xs shrink-0 object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = "none";
                            }}
                          />
                        )}
                        <span className="truncate">{item.feed_title}</span>
                      </div>

                      <h2 className="font-medium text-base leading-snug">
                        <span className="text-[var(--c-text)]">
                          {item.title}
                        </span>
                      </h2>

                      {item.content_snippet && (
                        <p className="text-sm mt-1.5 line-clamp-3" style={{ color: "var(--c-text-muted)" }}>
                          {item.content_snippet}
                        </p>
                      )}
                    </div>

                    {/* Meta information row BELOW article text with icons and mobile action buttons */}
                    <div className="flex items-center justify-between gap-3 text-xs mt-3" style={{ color: "var(--c-text-muted)" }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
                        {pubDate && (
                          <>
                            {/* Calendar date */}
                            <span className="inline-flex items-center gap-1.5">
                              <svg
                                className="w-3.5 h-3.5 shrink-0 opacity-70"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                              <span>{dateFormatter.format(pubDate)}</span>
                            </span>

                            {/* Clock time */}
                            <span className="inline-flex items-center gap-1.5">
                              <svg
                                className="w-3.5 h-3.5 shrink-0 opacity-70"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                              <span>{timeFormatter.format(pubDate)}</span>
                            </span>
                          </>
                        )}
                      </div>

                      {/* Action buttons on mobile (inline with meta row) */}
                      <div
                        className="flex sm:hidden items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBookmark(item);
                          }}
                          title={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                          aria-label={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            item.bookmarked
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                              : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
                          }`}
                        >
                          <svg
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill={item.bookmarked ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRead(item);
                          }}
                          title={item.read ? t("items.markUnread") : t("items.markRead")}
                          aria-label={item.read ? t("items.markUnread") : t("items.markRead")}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            !item.read
                              ? "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-blue1)] hover:border-[var(--c-blue3)]"
                              : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:border-[var(--c-blue3)]"
                          }`}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill={!item.read ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="2.2"
                          >
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Desktop action buttons (top right) */}
                  <div
                    className="hidden sm:flex items-center gap-2 pt-4 pr-4 shrink-0 self-start"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBookmark(item);
                      }}
                      title={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                      aria-label={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        item.bookmarked
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                          : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill={item.bookmarked ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRead(item);
                      }}
                      title={item.read ? t("items.markUnread") : t("items.markRead")}
                      aria-label={item.read ? t("items.markUnread") : t("items.markRead")}
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        !item.read
                          ? "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-blue1)] hover:border-[var(--c-blue3)]"
                          : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:border-[var(--c-blue3)]"
                      }`}
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill={!item.read ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2.2"
                      >
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modern Slide-over Reader Modal */}
      <ArticleReaderModal
        item={selectedArticle}
        isOpen={Boolean(selectedArticle)}
        onClose={closeArticle}
        onToggleBookmark={toggleBookmark}
        onToggleRead={toggleRead}
        onNext={handleNext}
        onPrevious={handlePrev}
        onItemUpdated={handleItemUpdated}
        hasNext={hasNext}
        hasPrev={hasPrev}
      />
    </div>
  );
}
