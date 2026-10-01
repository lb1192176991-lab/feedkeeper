import { extractArticle, isCachedConsentSnippet } from "./extractor.js";
import {
  canAccessItem,
  clearFullTextBlock,
  findFeedById,
  findItemById,
  findSubscriptionFullTextMode,
  recordFullTextBlock,
  updateItemFullContent,
} from "./repository.js";

/** Consent walls in a row before a feed stops trying, and how long it then waits before trying again. */
export const FULL_TEXT_BLOCK_THRESHOLD = 2;
const FULL_TEXT_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type FullTextError =
  | "item_not_found"
  | "item_has_no_link"
  | "full_text_disabled"
  | "consent_wall"
  | "could_not_extract_content"
  | "extraction_failed";

export type FullTextResult =
  | { ok: true; id: number; fullContentHtml: string; title?: string | null; byline?: string | null; cached: boolean }
  | { ok: false; error: FullTextError; message?: string };

function isBlocked(blockedAt: string | null): boolean {
  return Boolean(blockedAt) && Date.now() - Date.parse(blockedAt!) < FULL_TEXT_RETRY_AFTER_MS;
}

/**
 * Load an article's full text for a subscriber, reusing the cached extraction unless forced.
 * Sites that repeatedly answer with a consent wall are remembered per feed and skipped for a
 * while, so the reader does not wait on requests that cannot succeed.
 */
export async function loadFullText(userId: number, itemId: number, options: { force?: boolean } = {}): Promise<FullTextResult> {
  const item = findItemById(itemId);
  // Saved articles stay readable after unsubscribing; they use the default mode then.
  const mode = item ? findSubscriptionFullTextMode(userId, item.feed_id) ?? (canAccessItem(userId, itemId) ? "auto" : undefined) : undefined;
  if (!item || !mode) return { ok: false, error: "item_not_found" };

  // Older versions cached consent banners as article text; those are fetched again.
  if (!options.force && item.full_content_html && !isCachedConsentSnippet(item.full_content_html)) {
    return { ok: true, id: item.id, fullContentHtml: item.full_content_html, cached: true };
  }
  if (!item.link) return { ok: false, error: "item_has_no_link" };
  if (mode === "never") return { ok: false, error: "full_text_disabled" };
  if (!options.force && isBlocked(findFeedById(item.feed_id)?.full_text_blocked_at ?? null)) {
    return { ok: false, error: "consent_wall" };
  }

  try {
    const result = await extractArticle(item.link);
    if (result.status === "consent_wall") {
      recordFullTextBlock(item.feed_id, FULL_TEXT_BLOCK_THRESHOLD);
      return { ok: false, error: "consent_wall" };
    }
    if (result.status === "failed") return { ok: false, error: "could_not_extract_content" };

    clearFullTextBlock(item.feed_id);
    updateItemFullContent(itemId, result.article.contentHtml);
    return {
      ok: true,
      id: item.id,
      fullContentHtml: result.article.contentHtml,
      title: result.article.title,
      byline: result.article.byline,
      cached: false,
    };
  } catch (error) {
    return { ok: false, error: "extraction_failed", message: error instanceof Error ? error.message : String(error) };
  }
}
