import { z } from "zod";
import { findItemForUser, listItemsForUser } from "../feeds/repository.js";

const cursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.number().int().positive(),
});

type ItemCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(item: { created_at: string; id: number }): string {
  return Buffer.from(JSON.stringify({ createdAt: item.created_at, id: item.id })).toString("base64url");
}

export function decodeCursor(value: string): ItemCursor {
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_cursor");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("invalid_cursor");
  try {
    return cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
  } catch {
    throw new Error("invalid_cursor");
  }
}

export function listItemsPage(
  userId: number,
  options: {
    feedId?: number;
    folderId?: number;
    unreadOnly?: boolean;
    bookmarkedOnly?: boolean;
    before?: string;
    after?: string;
    since?: string;
    until?: string;
    limit?: number;
  },
) {
  const limit = options.limit ?? 50;
  const rows = listItemsForUser(userId, {
    feedId: options.feedId,
    folderId: options.folderId,
    unreadOnly: options.unreadOnly,
    bookmarkedOnly: options.bookmarkedOnly,
    before: options.before ? decodeCursor(options.before) : undefined,
    after: options.after ? decodeCursor(options.after) : undefined,
    publishedSince: options.since,
    publishedUntil: options.until,
    sortByAdded: true,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(({ content_html: _contentHtml, full_content_html: _fullContentHtml, ...item }) => item);
  return {
    items,
    newestCursor: page[0] ? encodeCursor(page[0]) : null,
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
}

export const MAX_CONTENT_LENGTH = 40_000;

export function getItemForMcp(userId: number, itemId: number, maxChars = MAX_CONTENT_LENGTH) {
  const item = findItemForUser(userId, itemId);
  if (!item) return null;
  const content = item.full_content_html ?? item.content_html;
  const maxContentLength = Math.min(maxChars, MAX_CONTENT_LENGTH);
  return {
    ...item,
    content_html: content?.slice(0, maxContentLength) ?? null,
    content_truncated: Boolean(content && content.length > maxContentLength),
    full_content_html: undefined,
  };
}
