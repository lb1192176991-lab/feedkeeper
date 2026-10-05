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
  const candidates = db.prepare<[string, number], { id: number; user_id: number; priority: number }>(`
    SELECT i.id, owners.user_id,
      CASE WHEN EXISTS (SELECT 1 FROM editions e, json_each(e.item_ids) ids WHERE e.user_id = owners.user_id AND ids.value = i.id AND e.status = 'active' AND e.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 3
        WHEN EXISTS (SELECT 1 FROM item_bookmarks b WHERE b.item_id = i.id AND b.user_id = owners.user_id)
          OR EXISTS (SELECT 1 FROM item_notes n WHERE n.item_id = i.id AND n.user_id = owners.user_id) THEN 2 ELSE 1 END priority
    FROM items i JOIN (
      SELECT i.id item_id, s.user_id FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id
      UNION SELECT item_id, user_id FROM item_bookmarks
      UNION SELECT item_id, user_id FROM item_notes
      UNION SELECT ids.value item_id, e.user_id FROM editions e, json_each(e.item_ids) ids
        WHERE e.status = 'active' AND e.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ) owners ON owners.item_id = i.id
    LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = owners.user_id
    WHERE owners.user_id IN (SELECT value FROM json_each(?)) AND i.link IS NOT NULL AND COALESCE(s.full_text_mode,'auto') = 'auto' AND i.full_content_html IS NULL
      AND i.extraction_status != 'feed_only' AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)
    ORDER BY priority DESC, i.created_at DESC LIMIT ?`).all(JSON.stringify(eligible), room);
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
    const jobs = db.prepare<[string], { item_id: number; user_id: number }>("SELECT * FROM full_text_jobs WHERE available_at <= ? ORDER BY priority DESC, available_at LIMIT 2").all(new Date().toISOString());
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
  const cached = db.prepare<[], { id: number; full_content_html: string }>("SELECT id, full_content_html FROM items WHERE full_content_html IS NOT NULL AND (lower(full_content_html) LIKE '%cookie%' OR lower(full_content_html) LIKE '%consent%')").all();
  db.transaction(() => {
    for (const item of cached) if (isCachedConsentSnippet(item.full_content_html)) {
      db.prepare("UPDATE items SET full_content_html = NULL, extraction_status = 'pending', extraction_retry_at = NULL WHERE id = ?").run(item.id);
    }
  })();
  tick();
  const timer = setInterval(tick, 5000); timer.unref(); return timer;
}
