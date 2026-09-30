import { extractArticleFromUrl, isCachedConsentSnippet } from "./extractor.js";
import { findItemById, isUserSubscribed, updateItemFullContent } from "./repository.js";

export type FullTextResult =
  | { ok: true; id: number; fullContentHtml: string; title?: string | null; byline?: string | null; cached: boolean }
  | { ok: false; error: "item_not_found" | "item_has_no_link" | "could_not_extract_content" | "extraction_failed"; message?: string };

/** Load an article's full text for a subscriber, reusing the cached extraction unless forced. */
export async function loadFullText(userId: number, itemId: number, options: { force?: boolean } = {}): Promise<FullTextResult> {
  const item = findItemById(itemId);
  if (!item || !isUserSubscribed(userId, item.feed_id)) return { ok: false, error: "item_not_found" };

  // Older versions cached consent banners as article text; those are fetched again.
  if (!options.force && item.full_content_html && !isCachedConsentSnippet(item.full_content_html)) {
    return { ok: true, id: item.id, fullContentHtml: item.full_content_html, cached: true };
  }
  if (!item.link) return { ok: false, error: "item_has_no_link" };

  try {
    const extracted = await extractArticleFromUrl(item.link);
    if (!extracted?.contentHtml) return { ok: false, error: "could_not_extract_content" };
    updateItemFullContent(itemId, extracted.contentHtml);
    return { ok: true, id: item.id, fullContentHtml: extracted.contentHtml, title: extracted.title, byline: extracted.byline, cached: false };
  } catch (error) {
    return { ok: false, error: "extraction_failed", message: error instanceof Error ? error.message : String(error) };
  }
}
