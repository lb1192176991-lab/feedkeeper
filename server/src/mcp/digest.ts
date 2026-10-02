import { db } from "../db/index.js";
import { listFoldersForUser, listItemsForUser, listSubscriptionsForUser } from "../feeds/repository.js";

const DIGEST_FETCH_LIMIT = 200;

export function truncate(text: string | null | undefined, maxChars: number): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars).trimEnd()}…` : clean;
}

export interface DigestOptions {
  feedId?: number;
  folderId?: number;
  unreadOnly?: boolean;
  since?: string;
  hours?: number;
  maxItemsPerFeed?: number;
  snippetChars?: number;
}

/** Items grouped by feed with short snippets: one call instead of many, and far fewer tokens. */
export function buildDigest(userId: number, options: DigestOptions) {
  const maxItemsPerFeed = options.maxItemsPerFeed ?? 5;
  const snippetChars = options.snippetChars ?? 200;
  const since = options.since ?? (options.hours ? new Date(Date.now() - options.hours * 3_600_000).toISOString() : undefined);

  const rows = listItemsForUser(userId, {
    feedId: options.feedId,
    folderId: options.folderId,
    unreadOnly: options.unreadOnly ?? true,
    publishedSince: since,
    sortByAdded: true,
    limit: DIGEST_FETCH_LIMIT,
  });

  const groups = new Map<number, { feedId: number; feed: string | null; items: typeof rows }>();
  for (const row of rows) {
    const group = groups.get(row.feed_id) ?? { feedId: row.feed_id, feed: row.feed_title, items: [] };
    group.items.push(row);
    groups.set(row.feed_id, group);
  }

  return {
    generatedAt: new Date().toISOString(),
    since: since ?? null,
    totalItems: rows.length,
    // More than the fetch limit matched; the oldest ones are not part of the digest.
    truncated: rows.length === DIGEST_FETCH_LIMIT,
    feeds: [...groups.values()].map((group) => ({
      feedId: group.feedId,
      feed: group.feed,
      itemCount: group.items.length,
      items: group.items.slice(0, maxItemsPerFeed).map((item) => ({
        id: item.id,
        title: item.title,
        link: item.link,
        publishedAt: item.published_at,
        bookmarked: Boolean(item.bookmarked),
        snippet: truncate(item.content_snippet, snippetChars),
      })),
      moreItems: Math.max(0, group.items.length - maxItemsPerFeed),
    })),
  };
}

/** A quick picture of the account: what is unread, where, and what needs attention. */
export function buildOverview(userId: number) {
  const feeds = listSubscriptionsForUser(userId);
  const failing = feeds.filter((feed) => feed.last_error || feed.consecutive_errors > 0);
  const saved = db.prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM item_bookmarks WHERE user_id = ?").get(userId)!.n;
  const newest = db
    .prepare<[number], { at: string | null }>(
      "SELECT MAX(i.created_at) AS at FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?",
    )
    .get(userId)?.at ?? null;

  return {
    feeds: feeds.length,
    unread: feeds.reduce((total, feed) => total + feed.unread_count, 0),
    savedArticles: saved,
    newestItemAddedAt: newest,
    feedsWithErrors: failing.map((feed) => ({ feedId: feed.id, title: feed.label ?? feed.title ?? feed.url, lastError: feed.last_error, consecutiveErrors: feed.consecutive_errors })),
    topUnreadFeeds: [...feeds]
      .filter((feed) => feed.unread_count > 0)
      .sort((a, b) => b.unread_count - a.unread_count)
      .slice(0, 10)
      .map((feed) => ({ feedId: feed.id, title: feed.label ?? feed.title ?? feed.url, unread: feed.unread_count })),
    folders: listFoldersForUser(userId).map((folder) => ({ folderId: folder.id, name: folder.name, feeds: folder.feed_count, unread: folder.unread_count })),
  };
}
