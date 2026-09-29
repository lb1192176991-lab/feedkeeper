import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, type Item } from "../api/client.js";
import { sanitizeHtml, estimateReadingTime } from "../utils/sanitizeHtml.js";

interface ArticleReaderModalProps {
  item: Item | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleBookmark: (item: Item) => void;
  onToggleRead: (item: Item) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onItemUpdated?: (item: Item) => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export function ArticleReaderModal({
  item,
  isOpen,
  onClose,
  onToggleBookmark,
  onToggleRead,
  onNext,
  onPrevious,
  onItemUpdated,
  hasNext = false,
  hasPrev = false,
}: ArticleReaderModalProps) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [extractedByline, setExtractedByline] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  // Sync state whenever active item changes
  useEffect(() => {
    setShowFullText(Boolean(item?.full_content_html));
    setExtractionError(null);
    setExtractedByline(null);
  }, [item?.id, item?.full_content_html]);

  // Automatically trigger reader view extraction if configured and article not yet extracted
  useEffect(() => {
    if (!isOpen || !item || !item.link) return;
    const isAutoReader = localStorage.getItem("feedkeeper_auto_reader_mode") !== "false";
    if (isAutoReader && !item.full_content_html) {
      handleToggleFullText();
    }
  }, [isOpen, item?.id]);

  // Prevent background scrolling when reader modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Extract full article text from original website via Readability
  async function handleToggleFullText() {
    if (!item || extracting) return;

    if (item.full_content_html) {
      setShowFullText((prev) => !prev);
      return;
    }

    if (!item.link) return;

    setExtracting(true);
    setExtractionError(null);
    try {
      const res = await api.extractContent(item.id);
      const updatedItem = {
        ...item,
        full_content_html: res.full_content_html,
      };
      if (res.byline) {
        setExtractedByline(res.byline);
      }
      setShowFullText(true);
      onItemUpdated?.(updatedItem);
    } catch (err: unknown) {
      console.error("Failed to extract full text:", err);
      setExtractionError(t("reader.extractionFailed"));
    } finally {
      setExtracting(false);
    }
  }

  // Keyboard navigation & shortcuts
  useEffect(() => {
    if (!isOpen || !item) return;

    const currentItem = item;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if focus is inside an input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.key === "j" || e.key === "ArrowRight") && hasNext && onNext) {
        e.preventDefault();
        onNext();
      } else if ((e.key === "k" || e.key === "ArrowLeft") && hasPrev && onPrevious) {
        e.preventDefault();
        onPrevious();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        onToggleBookmark(currentItem);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        onToggleRead(currentItem);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleToggleFullText();
      } else if ((e.key === "o" || e.key === "O") && currentItem.link) {
        e.preventDefault();
        window.open(currentItem.link, "_blank", "noopener,noreferrer");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, item, hasNext, hasPrev, onNext, onPrevious, onClose, onToggleBookmark, onToggleRead, showFullText, extracting]);

  // Format publication date & time
  const pubDate = useMemo(() => {
    if (!item?.published_at) return null;
    return new Date(item.published_at);
  }, [item?.published_at]);

  const formattedDate = useMemo(() => {
    if (!pubDate) return "";
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(pubDate);
  }, [pubDate, i18n.language]);

  // Extract source domain
  const sourceDomain = useMemo(() => {
    if (!item?.link) return item?.feed_title ?? "";
    try {
      return new URL(item.link).hostname.replace(/^www\./, "");
    } catch {
      return item.feed_title ?? "";
    }
  }, [item?.link, item?.feed_title]);

  // Resolve favicon URL for source
  const faviconUrl = useMemo(() => {
    for (const source of [item?.feed_site_url, item?.feed_url, item?.link]) {
      if (!source) continue;
      try {
        const url = new URL(source);
        if (url.protocol === "https:" || url.protocol === "http:") return `${url.origin}/favicon.ico`;
      } catch {
        // Try the next source URL.
      }
    }
    return null;
  }, [item?.feed_site_url, item?.feed_url, item?.link]);

  // Active content HTML (full text if toggled, otherwise feed HTML)
  const activeContentHtml = showFullText ? item?.full_content_html : item?.content_html;

  // Sanitize full HTML content or format plain text snippet, removing duplicate hero image
  const sanitizedContent = useMemo(() => {
    if (!item) return "";
    if (activeContentHtml) {
      return sanitizeHtml(activeContentHtml, { heroImageUrl: item.image_url });
    }
    return "";
  }, [item, activeContentHtml]);

  // Estimated reading time
  const readingTime = useMemo(() => {
    const rawText = activeContentHtml ?? item?.content_snippet ?? "";
    return estimateReadingTime(rawText.replace(/<[^>]+>/g, " "));
  }, [activeContentHtml, item?.content_snippet]);

  // Copy article link to clipboard
  const handleCopyLink = async () => {
    if (!item?.link) return;
    try {
      await navigator.clipboard.writeText(item.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  };

  if (!isOpen || !item) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Reader Drawer Panel */}
      <div
        className="relative z-10 w-full sm:max-w-2xl md:max-w-3xl h-full h-[100dvh] bg-[var(--c-surface)] shadow-2xl flex flex-col border-0 sm:border-l border-[var(--c-border)] animate-drawer-in"
        role="dialog"
        aria-modal="true"
        aria-label={item.title ?? t("items.title")}
      >
        {/* Sticky App-like Navigation Bar */}
        <header
          className="sticky top-0 z-20 px-4 py-3 border-b border-[var(--c-border)] bg-[var(--c-surface)]/90 backdrop-blur-md flex items-center justify-between gap-3 shrink-0"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))" }}
        >
          {/* Source info with Favicon (top left) */}
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            {faviconUrl && (
              <img
                src={faviconUrl}
                alt=""
                className="w-4 h-4 rounded-xs shrink-0 object-contain"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = "none";
                }}
              />
            )}
            <span className="truncate text-sm font-medium text-[var(--c-text)]">
              {item.feed_title}
            </span>
          </div>

          {/* Close button (top right, touch-friendly & larger) */}
          <button
            type="button"
            onClick={onClose}
            title={t("reader.close")}
            aria-label={t("reader.close")}
            className="w-9 h-9 -mr-1 rounded-xl text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/60 active:scale-95 transition-all cursor-pointer flex items-center justify-center shrink-0"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Scrollable Article Body */}
        <main
          className="flex-1 overflow-y-auto px-5 sm:px-10 py-6 sm:py-8 overscroll-contain"
          style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <article className="max-w-prose mx-auto">
            {/* Optional Hero Image */}
            {item.image_url && (
              <div className="mb-6 rounded-xl overflow-hidden border border-[var(--c-border)] bg-[var(--c-bg)] shadow-xs">
                <img
                  src={item.image_url}
                  alt=""
                  className="w-full max-h-[380px] object-cover"
                  loading="eager"
                  onError={(e) => {
                    const parent = (e.currentTarget as HTMLElement).parentElement;
                    if (parent) parent.style.display = "none";
                  }}
                />
              </div>
            )}

            {/* Article Headline */}
            <h1 className="text-2xl sm:text-3xl font-bold font-['Manrope'] text-[var(--c-text)] leading-snug tracking-tight mb-3">
              {item.title}
            </h1>

            {/* Meta information row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--c-text-muted)] pb-5 border-b border-[var(--c-border)] mb-6 font-medium">
              <span className="inline-flex items-center gap-1.5 text-[var(--c-text)] font-semibold">
                {faviconUrl && (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="w-3.5 h-3.5 rounded-xs shrink-0 object-contain"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                )}
                <span>{item.feed_title}</span>
              </span>
              {extractedByline && (
                <>
                  <span>•</span>
                  <span>{extractedByline}</span>
                </>
              )}
              {formattedDate && (
                <>
                  <span>•</span>
                  <span>{formattedDate}</span>
                </>
              )}
              <span>•</span>
              <span>{t("reader.readingTime", { count: readingTime })}</span>
            </div>

            {/* Extraction Error Notice */}
            {extractionError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center justify-between gap-3">
                <span>{extractionError}</span>
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline font-semibold whitespace-nowrap hover:opacity-80"
                  >
                    {t("reader.openOriginal")}
                  </a>
                )}
              </div>
            )}

            {/* Main Content Area */}
            {sanitizedContent ? (
              <div
                className="reader-content"
                dangerouslySetInnerHTML={{ __html: sanitizedContent }}
              />
            ) : item.content_snippet ? (
              <div className="reader-content">
                {item.content_snippet.split("\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            ) : (
              <p className="text-[var(--c-text-muted)] italic">
                {t("items.noItems")}
              </p>
            )}

            {/* Clean Minimalist Touch-Friendly Article Footer */}
            <div className="mt-12 pt-6 border-t border-[var(--c-border)]/60 flex items-center justify-between gap-3">
              {/* Left group: Navigation (Prev / Next) */}
              <div className="flex items-center gap-2">
                {/* Previous item */}
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={!hasPrev}
                  title={t("reader.previous")}
                  aria-label={t("reader.previous")}
                  className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                {/* Next item */}
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  title={t("reader.next")}
                  aria-label={t("reader.next")}
                  className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              {/* Right group: Actions (Reader View, Bookmark, Read/Unread, Copy Link, Open in Browser) */}
              <div className="flex items-center gap-2">
                {/* Reader View toggle */}
                {item.link && (
                  <button
                    type="button"
                    onClick={handleToggleFullText}
                    disabled={extracting}
                    title={showFullText ? t("reader.togglePreview") : t("reader.toggleFullText")}
                    aria-label={showFullText ? t("reader.togglePreview") : t("reader.toggleFullText")}
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                      showFullText
                        ? "bg-[var(--c-blue1)]/15 border-[var(--c-blue1)]/40 text-[var(--c-blue1)]"
                        : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40"
                    }`}
                  >
                    {extracting ? (
                      <svg className="w-4 h-4 animate-spin text-[var(--c-blue1)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Bookmark item */}
                <button
                  type="button"
                  onClick={() => onToggleBookmark(item)}
                  title={item.bookmarked ? t("reader.unbookmark") : t("reader.bookmark")}
                  aria-label={item.bookmarked ? t("reader.unbookmark") : t("reader.bookmark")}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                    item.bookmarked
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                      : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
                  }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={item.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>

                {/* Read / Unread toggle */}
                <button
                  type="button"
                  onClick={() => onToggleRead(item)}
                  title={item.read ? t("reader.markUnread") : t("reader.markRead")}
                  aria-label={item.read ? t("reader.markUnread") : t("reader.markRead")}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                    !item.read
                      ? "border-[var(--c-border)] text-[var(--c-blue1)] hover:border-[var(--c-blue3)]"
                      : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                  }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={!item.read ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2">
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </button>

                {/* Copy link */}
                <button
                  type="button"
                  onClick={handleCopyLink}
                  title={copied ? t("reader.linkCopied") : t("reader.copyLink")}
                  aria-label={t("reader.copyLink")}
                  className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 transition-all active:scale-95 cursor-pointer relative"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>

                {/* Open in external browser */}
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={t("reader.openOriginal")}
                    aria-label={t("reader.openOriginal")}
                    className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 transition-all active:scale-95"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </article>
        </main>
      </div>
    </div>,
    document.body
  );
}
