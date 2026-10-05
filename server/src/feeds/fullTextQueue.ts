import { isCachedConsentSnippet } from "./extractor.js";
import { db } from "../db/index.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { loadFullText } from "./fullText.js";
import { canAccessItem, findSubscriptionFullTextMode, findItemById } from "./repository.js";

/** Refillable durable queue, bounded independently of library size. */
export function scheduleFullTexts(): number {
  const queued = db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number };
  const room = Math.max(0, 200 - queued.n);
  if (!room) return 0;
  const eligible = (db.prepare("SELECT id FROM users").all() as { id: number }[]).filter(user => hasUserCapability(user.id, "fulltext")).map(user => user.id);
  if (!eligible.length) return 0;
  const candidates = db.prepare<[string, string, string, string, number], { id: number; user_id: number; priority: number }>(`
    WITH candidate_articles AS (
      SELECT ids.value AS item_id, e.user_id, 3 AS priority, i.created_at
      FROM editions e, json_each(e.item_ids) ids
      JOIN items i ON i.id = ids.value
      WHERE e.user_id IN (SELECT value FROM json_each(?))
        AND e.status = 'active' AND e.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)

      UNION ALL

      SELECT b.item_id, b.user_id, 2 AS priority, i.created_at
      FROM item_bookmarks b
      JOIN items i ON i.id = b.item_id
      WHERE b.user_id IN (SELECT value FROM json_each(?))
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)

      UNION ALL

      SELECT n.item_id, n.user_id, 2 AS priority, i.created_at
      FROM item_notes n
      JOIN items i ON i.id = n.item_id
      WHERE n.user_id IN (SELECT value FROM json_each(?))
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)

      UNION ALL

      SELECT i.id AS item_id, s.user_id, 1 AS priority, i.created_at
      FROM subscriptions s
      JOIN items i ON i.feed_id = s.feed_id
      WHERE s.user_id IN (SELECT value FROM json_each(?))
        AND COALESCE(s.full_text_mode, 'auto') = 'auto'
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)
    )
    SELECT item_id AS id, user_id, MAX(priority) AS priority
    FROM candidate_articles
    GROUP BY item_id
    ORDER BY priority DESC, created_at DESC LIMIT ?`).all(JSON.stringify(eligible), JSON.stringify(eligible), JSON.stringify(eligible), JSON.stringify(eligible), room);
  const add = db.prepare("INSERT OR IGNORE INTO full_text_jobs(item_id, user_id, priority) VALUES (?, ?, ?)");
  let count = 0;
  db.transaction(() => {
    for (const row of candidates) if (hasUserCapability(row.user_id, "fulltext")) count += add.run(row.id, row.user_id, row.priority).changes;
  })();
  return count;
}

/** Explicit priority requests never run publisher I/O inside an HTTP batch request. */
export function enqueueArticleContents(userId: number, ids: number[]): number[] {
  if (ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_source_selection");
  if (!hasUserCapability(userId, "fulltext")) throw new Error("capability_not_available");
  const unique = [...new Set(ids)];
  if (unique.some(id => !canAccessItem(userId, id))) throw new Error("item_not_found");
  return db.transaction(() => {
    const count = db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number };
    if (count.n + unique.length > 1000) throw new Error("queue_full");
    const add = db.prepare("INSERT INTO full_text_jobs(item_id,user_id,priority) VALUES (?,?,4) ON CONFLICT(item_id) DO UPDATE SET priority = MAX(priority,4), user_id = excluded.user_id");
    const queued: number[] = [];
    for (const id of unique) {
      const item = findItemById(id)!;
      if (item.full_content_html || item.extraction_status === "feed_only" || findSubscriptionFullTextMode(userId, item.feed_id) === "never") continue;
      if (item.extraction_retry_at && Date.parse(item.extraction_retry_at) > Date.now()) continue;
      add.run(id, userId); queued.push(id);
    }
    return queued;
  })();
}

/** Synchronous consumers can prepare selected articles without waiting for the worker. */
export async function prepareArticleContents(userId: number, ids: number[]) {
  if (ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_source_selection");
  const unique = [...new Set(ids)];
  if (unique.some(id => !canAccessItem(userId, id))) throw new Error("item_not_found");
  if (!hasUserCapability(userId, "fulltext")) throw new Error("capability_not_available");
  const results: { id: number; ok: boolean; error?: string }[] = [];
  // Avoid queueing an unbounded number of suspended host slots.
  for (let start = 0; start < unique.length; start += 2) {
    results.push(...await Promise.all(unique.slice(start, start + 2).map(async id => {
      if (!hasUserCapability(userId, "fulltext")) throw new Error("capability_not_available");
      const result = await loadFullText(userId, id);
      return { id, ok: result.ok, ...(!result.ok ? { error: result.error } : {}) };
    })));
  }
  return results;
}
let running = false;
export async function runFullTextQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const queued = db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number };
    if (queued.n < 200) scheduleFullTexts();
    const jobs = db.prepare<[string], { item_id: number; user_id: number }>("SELECT * FROM full_text_jobs WHERE available_at <= ? ORDER BY priority DESC, available_at LIMIT 1").all(new Date().toISOString());
    await Promise.all(jobs.map(async job => {
      const item = findItemById(job.item_id);
      if (item && hasUserCapability(job.user_id, "fulltext") && canAccessItem(job.user_id, job.item_id) && findSubscriptionFullTextMode(job.user_id, item.feed_id) !== "never") {
        await loadFullText(job.user_id, job.item_id);
      }
      db.prepare("DELETE FROM full_text_jobs WHERE item_id = ?").run(job.item_id);
    }));
  } finally { running = false; }
}
export function startFullTextScheduler(): NodeJS.Timeout {
  const tick = () => { void runFullTextQueue().catch(() => console.error("[fulltext] queue failed")); };
  // One-time startup repair of old consent-only caches, without contacting publishers.
  const cached = db.prepare<[], { id: number; full_content_html: string }>("SELECT id, full_content_html FROM items WHERE full_content_html IS NOT NULL AND (lower(full_content_html) LIKE '%cookie%' OR lower(full_content_html) LIKE '%consent%') LIMIT 100").all();
  db.transaction(() => {
    for (const item of cached) if (isCachedConsentSnippet(item.full_content_html)) {
      db.prepare("UPDATE items SET full_content_html = NULL, extraction_status = 'pending', extraction_retry_at = NULL WHERE id = ?").run(item.id);
    }
  })();
  tick();
  const timer = setInterval(tick, 15000); timer.unref(); return timer;
}
