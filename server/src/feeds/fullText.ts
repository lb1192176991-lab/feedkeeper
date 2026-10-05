import { extractArticle, isCachedConsentSnippet } from "./extractor.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { db } from "../db/index.js";
import { improvesContent } from "./articleContent.js";
import { canAccessItem, findItemById, findSubscriptionFullTextMode, updateItemFullContent } from "./repository.js";

// Kept for integrations importing the old constant; retries now belong to individual articles.
export const FULL_TEXT_BLOCK_THRESHOLD = 2;
export type FullTextError = "capability_not_available" | "item_not_found" | "item_has_no_link" | "full_text_disabled" | "consent_wall" |
  "paywall" | "bot_blocked" | "timeout" | "partial" | "could_not_extract_content" | "extraction_failed";
export type FullTextResult =
  | { ok: true; id: number; fullContentHtml: string; title?: string | null; byline?: string | null; cached: boolean }
  | { ok: false; error: FullTextError; message?: string };

const inFlight = new Map<number, Promise<FullTextResult>>();
const hosts = new Set<string>();
let active = 0;
const waiters: (() => void)[] = [];
async function acquire(host: string) {
  while (active >= 2 || hosts.has(host)) await new Promise<void>(resolve => waiters.push(resolve));
  active++; hosts.add(host);
  return () => { active--; hosts.delete(host); waiters.splice(0).forEach(resolve => resolve()); };
}
function recordAttempt(id: number, status: string) {
  const blocked = ["paywall", "consent_wall"].includes(status);
  const retry = status === "ready" || status === "feed_only" ? null :
    new Date(Date.now() + (blocked ? 7 * 86400_000 : status === "partial" ? 86400_000 : 3600_000)).toISOString();
  db.prepare("UPDATE items SET extraction_status = ?, extraction_attempted_at = ?, extraction_retry_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), retry, id);
}

/** All callers share bounded host-aware extraction, cache quality and per-article retry policy. */
export async function loadFullText(userId: number, itemId: number, options: { force?: boolean } = {}): Promise<FullTextResult> {
  const item = findItemById(itemId);
  const mode = item ? findSubscriptionFullTextMode(userId, item.feed_id) ?? (canAccessItem(userId, itemId) ? "auto" : undefined) : undefined;
  if (!item || !mode) return { ok: false, error: "item_not_found" };
  if (item.full_content_html && isCachedConsentSnippet(item.full_content_html)) {
    // Repair cached walls before any caller can mistake them for reader content again.
    db.prepare("UPDATE items SET full_content_html = NULL, extraction_status = 'pending', extraction_retry_at = NULL WHERE id = ?").run(itemId);
    item.full_content_html = null;
  }
  if (!options.force && item.full_content_html && !isCachedConsentSnippet(item.full_content_html)) {
    return { ok: true, id: item.id, fullContentHtml: item.full_content_html, cached: true };
  }
  if (!item.link) return { ok: false, error: "item_has_no_link" };
  if (mode === "never") return { ok: false, error: "full_text_disabled" };
  if (!options.force && item.extraction_status === "feed_only") return { ok: true, id: itemId, fullContentHtml: item.content_html ?? "", cached: true };
  if (!options.force && item.extraction_retry_at && Date.parse(item.extraction_retry_at) > Date.now()) {
    const status = item.extraction_status;
    return { ok: false, error: ["consent_wall", "paywall", "bot_blocked", "timeout", "partial"].includes(status) ? status as FullTextError : "could_not_extract_content" };
  }
  if (!hasUserCapability(userId, "fulltext")) return { ok: false, error: "capability_not_available" };
  if (inFlight.has(itemId)) return inFlight.get(itemId)!;
  const task = (async (): Promise<FullTextResult> => {
    let release: (() => void) | undefined;
    try {
      release = await acquire(new URL(item.link!).host);
      if (!hasUserCapability(userId, "fulltext") || !canAccessItem(userId, itemId)) return { ok: false, error: "capability_not_available" };
      const result = await extractArticle(item.link!);
      if (result.status !== "ok") {
        recordAttempt(itemId, result.status);
        return { ok: false, error: result.status === "failed" ? "could_not_extract_content" : result.status };
      }
      // Content may have improved while this request was running.
      const current = findItemById(itemId);
      if (!current) return { ok: false, error: "item_not_found" };
      if (current.link !== item.link) return { ok: false, error: "extraction_failed" };
      if (improvesContent(current, result.article.contentHtml)) {
        db.transaction(() => { updateItemFullContent(itemId, result.article.contentHtml); recordAttempt(itemId, "ready"); })();
      } else recordAttempt(itemId, current.full_content_html ? "ready" : "feed_only");
      return { ok: true, id: itemId, fullContentHtml: findItemById(itemId)!.full_content_html || current.content_html || "",
        title: result.article.title, byline: result.article.byline, cached: false };
    } catch {
      recordAttempt(itemId, "failed");
      return { ok: false, error: "extraction_failed" };
    } finally { release?.(); inFlight.delete(itemId); }
  })();
  inFlight.set(itemId, task);
  return task;
}
