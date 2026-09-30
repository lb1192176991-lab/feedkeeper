import { db } from "../db/index.js";

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  etag: string | null;
  last_modified: string | null;
  full_text_blocks: number;
  full_text_blocked_at: string | null;
  created_at: string;
}

export type FullTextMode = "auto" | "never";

export interface Item {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  link: string | null;
  content_snippet: string | null;
  content_html: string | null;
  full_content_html: string | null;
  image_url: string | null;
  published_at: string | null;
  created_at: string;
}

export interface Folder {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

export interface SubscribedFeed extends Feed {
  subscription_id: number;
  label: string | null;
  folder_id: number | null;
  folder_name: string | null;
  unread_count: number;
  position: number;
  full_text_mode: FullTextMode;
}

export interface MutedKeyword {
  id: number;
  user_id: number;
  keyword: string;
  created_at: string;
}

export function findFeedByUrl(url: string): Feed | undefined {
  return db.prepare<[string], Feed>("SELECT * FROM feeds WHERE url = ?").get(url);
}

export function findFeedById(id: number): Feed | undefined {
  return db.prepare<[number], Feed>("SELECT * FROM feeds WHERE id = ?").get(id);
}

export function createFeed(url: string, pollIntervalMinutes: number): Feed {
  const result = db
    .prepare("INSERT INTO feeds (url, poll_interval_minutes) VALUES (?, ?)")
    .run(url, pollIntervalMinutes);
  return findFeedById(Number(result.lastInsertRowid))!;
}

export function subscribe(
  userId: number,
  feedId: number,
  label?: string | null,
  folderId?: number | null,
): number {
  const maxPosRow = db
    .prepare<[number], { max_pos: number | null }>(
      "SELECT MAX(position) AS max_pos FROM subscriptions WHERE user_id = ?",
    )
    .get(userId);
  const nextPosition = (maxPosRow?.max_pos ?? -1) + 1;

  const result = db
    .prepare(
      `INSERT INTO subscriptions (user_id, feed_id, label, folder_id, position) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, feed_id) DO UPDATE SET
         label = COALESCE(excluded.label, subscriptions.label),
         folder_id = COALESCE(excluded.folder_id, subscriptions.folder_id)`,
    )
    .run(userId, feedId, label?.trim() || null, folderId ?? null, nextPosition);
  return Number(result.lastInsertRowid);
}

export function unsubscribe(userId: number, feedId: number): void {
  db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
  const remaining = db
    .prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM subscriptions WHERE feed_id = ?")
    .get(feedId)!;
  if (remaining.count === 0) {
    // No one subscribes to this feed anymore; stop polling it and drop its items.
    db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  }
}

export function listSubscriptionsForUser(userId: number): SubscribedFeed[] {
  return db
    .prepare<[number, number], SubscribedFeed>(
      `SELECT
         f.*,
         s.id AS subscription_id,
         NULLIF(TRIM(s.label), '') AS label,
         s.folder_id AS folder_id,
         fo.name AS folder_name,
         s.position AS position,
         s.full_text_mode AS full_text_mode,
         (
           SELECT COUNT(*) FROM items i
           WHERE i.feed_id = f.id
             AND NOT EXISTS (
               SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?
             )
         ) AS unread_count
       FROM subscriptions s
       JOIN feeds f ON f.id = s.feed_id
       LEFT JOIN folders fo ON fo.id = s.folder_id
       WHERE s.user_id = ?
       ORDER BY s.position ASC, s.created_at ASC`,
    )
    .all(userId, userId);
}

export function isUserSubscribed(userId: number, feedId: number): boolean {
  const row = db
    .prepare<[number, number], { count: number }>(
      "SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ? AND feed_id = ?",
    )
    .get(userId, feedId)!;
  return row.count > 0;
}

export function listFeedsDueForPoll(): Feed[] {
  return db
    .prepare<[], Feed>(
      `SELECT * FROM feeds
       WHERE last_polled_at IS NULL
          OR last_polled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || poll_interval_minutes || ' minutes')`,
    )
    .all();
}

export function updateFeedAfterPoll(
  feedId: number,
  data: { title?: string; siteUrl?: string; etag?: string; lastModified?: string; error?: string | null },
): void {
  if (data.error) {
    db.prepare(
      `UPDATE feeds SET
         last_error = ?,
         consecutive_errors = consecutive_errors + 1,
         last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(data.error, feedId);
  } else {
    db.prepare(
      `UPDATE feeds SET
         title = COALESCE(?, title),
         site_url = COALESCE(?, site_url),
         etag = COALESCE(?, etag),
         last_modified = COALESCE(?, last_modified),
         last_error = NULL,
         consecutive_errors = 0,
         last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(data.title ?? null, data.siteUrl ?? null, data.etag ?? null, data.lastModified ?? null, feedId);
  }
}

export function upsertItems(
  feedId: number,
  items: Array<{
    guid: string;
    title?: string;
    link?: string;
    contentSnippet?: string;
    contentHtml?: string | null;
    publishedAt?: string;
    imageUrl?: string | null;
  }>,
): number {
  const insert = db.prepare(
    `INSERT INTO items (feed_id, guid, title, link, content_snippet, content_html, published_at, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (feed_id, guid) DO NOTHING`,
  );
  const update = db.prepare(
    `UPDATE items SET
       title = COALESCE(?, title),
       link = COALESCE(?, link),
       content_snippet = COALESCE(?, content_snippet),
       content_html = COALESCE(?, content_html),
       published_at = COALESCE(?, published_at),
       image_url = COALESCE(?, image_url)
     WHERE feed_id = ? AND guid = ?`,
  );
  const insertMany = db.transaction((rows: typeof items) => {
    let inserted = 0;
    for (const row of rows) {
      const values = [
        feedId,
        row.guid,
        row.title ?? null,
        row.link ?? null,
        row.contentSnippet ?? null,
        row.contentHtml ?? null,
        row.publishedAt ?? null,
        row.imageUrl ?? null,
      ] as const;
      const result = insert.run(...values);
      if (result.changes > 0) {
        inserted++;
      } else {
        update.run(...values.slice(2), feedId, row.guid);
      }
    }
    return inserted;
  });
  return insertMany(items);
}

export function listItemsForUser(
  userId: number,
  opts: {
    feedId?: number;
    folderId?: number;
    unreadOnly?: boolean;
    bookmarkedOnly?: boolean;
    includeMuted?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
    since?: string;
    publishedSince?: string;
    publishedUntil?: string;
    before?: { createdAt: string; id: number };
    after?: { createdAt: string; id: number };
    sortByAdded?: boolean;
  } = {},
): (Item & {
  read: boolean;
  bookmarked: boolean;
  feed_title: string | null;
  feed_site_url: string | null;
  feed_url: string;
  feed_full_text_mode: FullTextMode;
})[] {
  const conditions: string[] = ["s.user_id = ?"];
  const params: unknown[] = [userId];

  if (opts.feedId) {
    conditions.push("i.feed_id = ?");
    params.push(opts.feedId);
  }
  if (opts.folderId) {
    conditions.push("s.folder_id = ?");
    params.push(opts.folderId);
  }
  if (opts.unreadOnly) {
    conditions.push("r.item_id IS NULL");
  }
  if (opts.bookmarkedOnly) {
    conditions.push("b.item_id IS NOT NULL");
  }
  if (!opts.includeMuted) {
    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM user_muted_keywords m
        WHERE m.user_id = s.user_id
          AND (
            INSTR(LOWER(COALESCE(i.title, '')), LOWER(m.keyword)) > 0
            OR INSTR(LOWER(COALESCE(i.content_snippet, '')), LOWER(m.keyword)) > 0
          )
      )`,
    );
  }
  if (opts.search) {
    conditions.push("(INSTR(LOWER(COALESCE(i.title, '')), LOWER(?)) > 0 OR INSTR(LOWER(COALESCE(i.content_snippet, '')), LOWER(?)) > 0)");
    params.push(opts.search, opts.search);
  }
  if (opts.since) {
    conditions.push("i.created_at > ?");
    params.push(opts.since);
  }
  // Feeds without a parseable publish date fall back to when FeedKeeper stored the item.
  if (opts.publishedSince) {
    conditions.push("COALESCE(julianday(i.published_at), julianday(i.created_at)) >= julianday(?)");
    params.push(opts.publishedSince);
  }
  if (opts.publishedUntil) {
    conditions.push("COALESCE(julianday(i.published_at), julianday(i.created_at)) <= julianday(?)");
    params.push(opts.publishedUntil);
  }
  if (opts.before) {
    conditions.push("(i.created_at < ? OR (i.created_at = ? AND i.id < ?))");
    params.push(opts.before.createdAt, opts.before.createdAt, opts.before.id);
  }
  if (opts.after) {
    conditions.push("(i.created_at > ? OR (i.created_at = ? AND i.id > ?))");
    params.push(opts.after.createdAt, opts.after.createdAt, opts.after.id);
  }

  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  params.push(limit, offset);

  return db
    .prepare(
      `SELECT DISTINCT i.*,
              COALESCE(NULLIF(TRIM(s.label), ''), NULLIF(TRIM(f.title), ''), f.url) AS feed_title,
              f.site_url AS feed_site_url,
              f.url AS feed_url,
              s.full_text_mode AS feed_full_text_mode,
              (r.item_id IS NOT NULL) AS read,
              (b.item_id IS NOT NULL) AS bookmarked
       FROM items i
       JOIN subscriptions s ON s.feed_id = i.feed_id
       JOIN feeds f ON f.id = i.feed_id
       LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = s.user_id
       LEFT JOIN item_bookmarks b ON b.item_id = i.id AND b.user_id = s.user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${opts.sortByAdded ? "i.created_at DESC, i.id DESC" : "i.published_at DESC, i.created_at DESC, i.id DESC"}
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as (Item & {
      read: boolean;
      bookmarked: boolean;
      feed_title: string | null;
      feed_site_url: string | null;
      feed_url: string;
      feed_full_text_mode: FullTextMode;
    })[];
}

export function findItemForUser(userId: number, itemId: number): ReturnType<typeof listItemsForUser>[number] | undefined {
  return db.prepare<[number, number], ReturnType<typeof listItemsForUser>[number]>(
    `SELECT i.*, COALESCE(NULLIF(TRIM(s.label), ''), NULLIF(TRIM(f.title), ''), f.url) AS feed_title,
            f.site_url AS feed_site_url, f.url AS feed_url, s.full_text_mode AS feed_full_text_mode,
            (r.item_id IS NOT NULL) AS read, (b.item_id IS NOT NULL) AS bookmarked
     FROM items i
     JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
     JOIN feeds f ON f.id = i.feed_id
     LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = s.user_id
     LEFT JOIN item_bookmarks b ON b.item_id = i.id AND b.user_id = s.user_id
     WHERE i.id = ?`,
  ).get(userId, itemId);
}

export function updateSubscriptionLabel(userId: number, feedId: number, label: string | null): void {
  db.prepare("UPDATE subscriptions SET label = ? WHERE user_id = ? AND feed_id = ?").run(label?.trim() || null, userId, feedId);
}

export function updateSubscriptionFolder(userId: number, feedId: number, folderId: number | null): void {
  db.prepare("UPDATE subscriptions SET folder_id = ? WHERE user_id = ? AND feed_id = ?").run(
    folderId,
    userId,
    feedId,
  );
}

export function listFoldersForUser(userId: number): (Folder & { feed_count: number; unread_count: number })[] {
  return db
    .prepare<[number, number, number], Folder & { feed_count: number; unread_count: number }>(
      `SELECT
         fo.*,
         COUNT(DISTINCT s.feed_id) AS feed_count,
         COALESCE(
           (
             SELECT COUNT(*)
             FROM items i
             JOIN subscriptions s2 ON s2.feed_id = i.feed_id AND s2.folder_id = fo.id AND s2.user_id = ?
             WHERE NOT EXISTS (
               SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?
             )
           ), 0
         ) AS unread_count
       FROM folders fo
       LEFT JOIN subscriptions s ON s.folder_id = fo.id AND s.user_id = fo.user_id
       WHERE fo.user_id = ?
       GROUP BY fo.id
       ORDER BY fo.name COLLATE NOCASE ASC`,
    )
    .all(userId, userId, userId);
}

export function findFolderByName(userId: number, name: string): Folder | undefined {
  return db
    .prepare<[number, string], Folder>("SELECT * FROM folders WHERE user_id = ? AND name = ?")
    .get(userId, name.trim());
}

export function findFolderById(userId: number, id: number): Folder | undefined {
  return db
    .prepare<[number, number], Folder>("SELECT * FROM folders WHERE user_id = ? AND id = ?")
    .get(userId, id);
}

export function createFolder(userId: number, name: string): Folder {
  const trimmed = name.trim();
  db.prepare("INSERT INTO folders (user_id, name) VALUES (?, ?) ON CONFLICT (user_id, name) DO NOTHING").run(
    userId,
    trimmed,
  );
  return findFolderByName(userId, trimmed)!;
}

export function updateFolder(userId: number, id: number, name: string): Folder {
  const trimmed = name.trim();
  db.prepare("UPDATE folders SET name = ? WHERE id = ? AND user_id = ?").run(trimmed, id, userId);
  return findFolderById(userId, id)!;
}

export function deleteFolder(userId: number, id: number): void {
  db.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(id, userId);
}

export function updateFeedPollInterval(feedId: number, minutes: number): void {
  db.prepare("UPDATE feeds SET poll_interval_minutes = ? WHERE id = ?").run(minutes, feedId);
}

export function markAllRead(userId: number, filter?: number | { feedId?: number; folderId?: number }): number {
  const feedId = typeof filter === "number" ? filter : filter?.feedId;
  const folderId = typeof filter === "object" ? filter?.folderId : undefined;
  const conditions = ["s.user_id = ?"];
  const params: unknown[] = [userId, userId];

  if (feedId) {
    conditions.push("i.feed_id = ?");
    params.push(feedId);
  }
  if (folderId) {
    conditions.push("s.folder_id = ?");
    params.push(folderId);
  }

  const result = db
    .prepare(
      `INSERT INTO item_reads (user_id, item_id)
       SELECT ?, i.id
       FROM items i
       JOIN subscriptions s ON s.feed_id = i.feed_id
       WHERE ${conditions.join(" AND ")}
         AND NOT EXISTS (SELECT 1 FROM item_reads r WHERE r.user_id = s.user_id AND r.item_id = i.id)`,
    )
    .run(...params);

  return result.changes;
}

export function markItemRead(userId: number, itemId: number): number {
  return db.prepare(
    `INSERT INTO item_reads (user_id, item_id)
     SELECT ?, i.id FROM items i
     JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
     WHERE i.id = ?
     ON CONFLICT (user_id, item_id) DO NOTHING`,
  ).run(userId, userId, itemId).changes;
}

export function markItemUnread(userId: number, itemId: number): number {
  return db.prepare(
    `DELETE FROM item_reads WHERE user_id = ? AND item_id = ?
     AND EXISTS (SELECT 1 FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id
                 WHERE i.id = ? AND s.user_id = ?)`,
  ).run(userId, itemId, itemId, userId).changes;
}

export function bookmarkItem(userId: number, itemId: number): number {
  return db.prepare(
    `INSERT INTO item_bookmarks (user_id, item_id)
     SELECT ?, i.id FROM items i
     JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
     WHERE i.id = ?
     ON CONFLICT (user_id, item_id) DO NOTHING`,
  ).run(userId, userId, itemId).changes;
}

export function unbookmarkItem(userId: number, itemId: number): number {
  return db.prepare(
    `DELETE FROM item_bookmarks WHERE user_id = ? AND item_id = ?
     AND EXISTS (SELECT 1 FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id
                 WHERE i.id = ? AND s.user_id = ?)`,
  ).run(userId, itemId, itemId, userId).changes;
}

export function listMutedKeywords(userId: number): MutedKeyword[] {
  return db
    .prepare<[number], MutedKeyword>("SELECT * FROM user_muted_keywords WHERE user_id = ? ORDER BY keyword ASC")
    .all(userId);
}

export function addMutedKeyword(userId: number, keyword: string): MutedKeyword {
  const trimmed = keyword.trim().toLowerCase();
  const insert = db.prepare(
    "INSERT INTO user_muted_keywords (user_id, keyword) VALUES (?, ?) ON CONFLICT(user_id, keyword) DO NOTHING",
  );
  insert.run(userId, trimmed);
  return db
    .prepare<[number, string], MutedKeyword>(
      "SELECT * FROM user_muted_keywords WHERE user_id = ? AND keyword = ?",
    )
    .get(userId, trimmed)!;
}

export function removeMutedKeyword(userId: number, keywordId: number): void {
  db.prepare("DELETE FROM user_muted_keywords WHERE id = ? AND user_id = ?").run(keywordId, userId);
}

export function reorderSubscriptions(userId: number, feedIds: number[]): void {
  const update = db.prepare("UPDATE subscriptions SET position = ? WHERE user_id = ? AND feed_id = ?");
  const runTransaction = db.transaction(() => {
    feedIds.forEach((feedId, index) => {
      update.run(index, userId, feedId);
    });
  });
  runTransaction();
}

export function findItemById(id: number): Item | undefined {
  return db.prepare<[number], Item>("SELECT * FROM items WHERE id = ?").get(id);
}

export function updateItemFullContent(id: number, fullContentHtml: string): void {
  db.prepare("UPDATE items SET full_content_html = ? WHERE id = ?").run(fullContentHtml, id);
}

/** Apply a per-item change to many items atomically; returns how many rows changed. */
export function applyToItems(itemIds: readonly number[], change: (itemId: number) => number): number {
  return db.transaction(() => [...new Set(itemIds)].reduce((total, itemId) => total + change(itemId), 0))();
}

export function updateSubscriptionFullTextMode(userId: number, feedId: number, mode: FullTextMode): void {
  db.prepare("UPDATE subscriptions SET full_text_mode = ? WHERE user_id = ? AND feed_id = ?").run(mode, userId, feedId);
}

/** The user's full-text mode for a feed, or undefined when they are not subscribed. */
export function findSubscriptionFullTextMode(userId: number, feedId: number): FullTextMode | undefined {
  return db
    .prepare<[number, number], { full_text_mode: FullTextMode }>("SELECT full_text_mode FROM subscriptions WHERE user_id = ? AND feed_id = ?")
    .get(userId, feedId)?.full_text_mode;
}

/** Count a consent wall for a feed; after `threshold` in a row the feed is marked as blocked. */
export function recordFullTextBlock(feedId: number, threshold: number): void {
  db.prepare(
    `UPDATE feeds SET
       full_text_blocks = full_text_blocks + 1,
       full_text_blocked_at = CASE WHEN full_text_blocks + 1 >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE full_text_blocked_at END
     WHERE id = ?`,
  ).run(threshold, feedId);
}

export function clearFullTextBlock(feedId: number): void {
  db.prepare("UPDATE feeds SET full_text_blocks = 0, full_text_blocked_at = NULL WHERE id = ? AND full_text_blocks > 0").run(feedId);
}

export function countFeedSubscribers(feedId: number): number {
  return db.prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM subscriptions WHERE feed_id = ?").get(feedId)!.count;
}

/** Point a feed at a new URL in place, keeping its items; resets fetch state so the next poll starts fresh. */
export function replaceFeedUrl(feedId: number, url: string): void {
  db.prepare(
    `UPDATE feeds SET url = ?, etag = NULL, last_modified = NULL, last_error = NULL, consecutive_errors = 0,
       full_text_blocks = 0, full_text_blocked_at = NULL
     WHERE id = ?`,
  ).run(url, feedId);
}

/** Move a user's subscription to another feed, keeping label, folder, order and full-text mode. */
export function moveSubscription(userId: number, fromFeedId: number, toFeedId: number): void {
  db.transaction(() => {
    db.prepare("UPDATE subscriptions SET feed_id = ? WHERE user_id = ? AND feed_id = ?").run(toFeedId, userId, fromFeedId);
    if (countFeedSubscribers(fromFeedId) === 0) db.prepare("DELETE FROM feeds WHERE id = ?").run(fromFeedId);
  })();
}
