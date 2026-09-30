import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listItemsForUser,
  listSubscriptionsForUser,
  markItemRead,
  markItemUnread,
  markAllRead,
  findFeedById,
  isUserSubscribed,
  bookmarkItem,
  unbookmarkItem,
  listMutedKeywords,
  addMutedKeyword,
  removeMutedKeyword,
  listFoldersForUser,
  findFolderById,
  createFolder,
  updateFolder,
  deleteFolder,
  updateSubscriptionFolder,
  applyToItems,
} from "../feeds/repository.js";
import type { TokenScope } from "../auth/tokens.js";
import { getItemForMcp, listItemsPage } from "./items.js";
import { subscribeToFeed, unsubscribeFromFeed, updateFeedSettings, FeedError, MultipleFeedsFoundError } from "../feeds/service.js";
import { loadFullText } from "../feeds/fullText.js";
import { SsrfBlockedError, normalizeUrlCandidate } from "../feeds/ssrfGuard.js";
import { generateOpml, importOpmlFeeds } from "../feeds/opml.js";
import { pollFeed } from "../feeds/poller.js";
import { discoverFeeds } from "../feeds/discovery.js";
import { findUserById } from "../auth/users.js";
import { getDatabaseStats, runCleanup } from "../feeds/cleanup.js";
import { APP_VERSION } from "../version.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

const MAX_CONTENT_LENGTH = 40_000;

const dateInput = z.union([z.string().datetime({ offset: true }), z.string().date()]);
const publishedRange = {
  since: dateInput.optional().describe("Only items published at or after this ISO date or date-time"),
  until: dateInput.optional().describe("Only items published at or before this ISO date or date-time"),
};

// Item actions accept one ID or a batch, so clients can triage many articles in one call.
const itemSelection = {
  itemId: z.number().int().positive().optional().describe("A single item ID"),
  itemIds: z.array(z.number().int().positive()).min(1).max(200).optional().describe("Up to 200 item IDs"),
};

function selectedItemIds({ itemId, itemIds }: { itemId?: number; itemIds?: number[] }): number[] {
  return [...(itemIds ?? []), ...(itemId ? [itemId] : [])];
}

// Builds a fresh MCP server scoped to a single authenticated user. A new
// instance is created per request (see mcp/http.ts) so tool handlers can
// safely close over `userId` without leaking data between users.
export function createMcpServerForUser(userId: number, scope: TokenScope): McpServer {
  const server = new McpServer({ name: "feedkeeper", version: APP_VERSION });

  server.registerTool(
    "list_feeds",
    {
      title: "List subscribed feeds",
      description: "Lists all RSS/Atom feeds the current user is subscribed to, including unread counts and polling health.",
      inputSchema: {
        onlyWithErrors: z.boolean().optional().describe("Only return feeds whose last poll failed"),
      },
    },
    async ({ onlyWithErrors }) => {
      const feeds = listSubscriptionsForUser(userId);
      return textResult(onlyWithErrors ? feeds.filter((feed) => feed.last_error || feed.consecutive_errors > 0) : feeds);
    },
  );

  const mcpUrlSchema = z.preprocess(
    (val) => (typeof val === "string" ? normalizeUrlCandidate(val) : val),
    z.string().url(),
  );

  if (scope === "write") server.registerTool(
    "subscribe_feed",
    {
      title: "Subscribe to a feed",
      description: "Subscribes the current user to an RSS/Atom feed URL or website URL (auto-discovering the feed).",
      inputSchema: {
        url: mcpUrlSchema.describe("The feed URL or website URL"),
        label: z.string().max(200).optional().describe("Optional display name for this feed"),
        folderId: z.number().int().positive().optional().describe("Optional folder/category ID"),
      },
    },
    async ({ url, label, folderId }) => {
      try {
        const subscription = await subscribeToFeed(userId, url, label ?? null, folderId ?? null);
        return textResult(subscription);
      } catch (error) {
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        if (error instanceof MultipleFeedsFoundError) {
          return textResult({
            error: "multiple_feeds_found",
            message: "Multiple feeds found. Please specify one of the following feed URLs:",
            feeds: error.feeds,
          });
        }
        if (error instanceof FeedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "discover_feeds",
    {
      title: "Discover feeds on a website",
      description: "Inspects a website URL and discovers available RSS/Atom feed links.",
      inputSchema: {
        url: mcpUrlSchema.describe("The website URL to discover feeds from"),
      },
    },
    async ({ url }) => {
      try {
        const feeds = await discoverFeeds(url);
        return textResult({ feeds });
      } catch (error) {
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "unsubscribe_feed",
    {
      title: "Unsubscribe from a feed",
      description: "Removes a feed subscription for the current user.",
      inputSchema: { feedId: z.number().int().positive() },
    },
    async ({ feedId }) => {
      try {
        unsubscribeFromFeed(userId, feedId);
        return textResult({ ok: true });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders / categories",
      description: "Lists all feed categories/folders created by the user, including feed and unread counts.",
      inputSchema: {},
    },
    async () => textResult(listFoldersForUser(userId)),
  );

  if (scope === "write") server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description: "Creates a new category/folder to organize feeds.",
      inputSchema: { name: z.string().trim().min(1).max(100) },
    },
    async ({ name }) => textResult(createFolder(userId, name)),
  );

  if (scope === "write") server.registerTool(
    "move_feed_to_folder",
    {
      title: "Move feed to folder",
      description: "Assigns a feed to a folder, or removes it from all folders if folderId is null.",
      inputSchema: {
        feedId: z.number().int().positive(),
        folderId: z.number().int().positive().nullable(),
      },
    },
    async ({ feedId, folderId }) => {
      if (!isUserSubscribed(userId, feedId)) return errorResult("not_subscribed");
      if (folderId !== null && !findFolderById(userId, folderId)) return errorResult("folder_not_found");
      updateSubscriptionFolder(userId, feedId, folderId);
      return textResult({ ok: true });
    },
  );

  if (scope === "write") server.registerTool(
    "update_feed",
    {
      title: "Update feed settings",
      description: "Renames a subscription or changes how often its feed is polled. The poll interval applies to every subscriber of the feed and has a server-wide minimum.",
      inputSchema: {
        feedId: z.number().int().positive(),
        label: z.string().max(200).nullable().optional().describe("Custom display name; null or empty restores the feed title"),
        pollIntervalMinutes: z.number().int().positive().max(10_080).optional(),
      },
    },
    async ({ feedId, label, pollIntervalMinutes }) => {
      try {
        return textResult(updateFeedSettings(userId, feedId, { label, pollIntervalMinutes }));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "rename_folder",
    {
      title: "Rename folder",
      description: "Renames one of the user's folders.",
      inputSchema: { folderId: z.number().int().positive(), name: z.string().trim().min(1).max(100) },
    },
    async ({ folderId, name }) => {
      if (!findFolderById(userId, folderId)) return errorResult("folder_not_found");
      try {
        return textResult(updateFolder(userId, folderId, name));
      } catch {
        return errorResult("folder_name_taken");
      }
    },
  );

  if (scope === "write") server.registerTool(
    "delete_folder",
    {
      title: "Delete folder",
      description: "Deletes a folder. Its feeds stay subscribed and move out of any folder.",
      inputSchema: { folderId: z.number().int().positive() },
    },
    async ({ folderId }) => {
      if (!findFolderById(userId, folderId)) return errorResult("folder_not_found");
      deleteFolder(userId, folderId);
      return textResult({ ok: true });
    },
  );

  server.registerTool(
    "get_new_items",
    {
      title: "Get new feed items",
      description: "Returns unread items, optionally filtered by feed, folder, search term, or bookmarks.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        search: z.string().max(200).optional(),
        bookmarkedOnly: z.boolean().optional(),
        ...publishedRange,
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ feedId, folderId, search, bookmarkedOnly, since, until, limit }) =>
      textResult(listItemsForUser(userId, {
        feedId, folderId, search, bookmarkedOnly, limit, unreadOnly: true, publishedSince: since, publishedUntil: until,
      })),
  );

  server.registerTool(
    "list_items",
    {
      title: "List items with a cursor",
      description: "Lists compact article records by time added. Use nextCursor as before to fetch older pages, or newestCursor as after to fetch newly added items. When paging new items, keep the original after cursor while following nextCursor.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        unreadOnly: z.boolean().optional(),
        bookmarkedOnly: z.boolean().optional(),
        before: z.string().max(256).optional(),
        after: z.string().max(256).optional(),
        ...publishedRange,
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async (args) => {
      try {
        return textResult(listItemsPage(userId, args));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get an article",
      description: "Returns one subscribed article, including cached feed or reader content when available. Content is capped at 40,000 characters.",
      inputSchema: { itemId: z.number().int().positive() },
    },
    async ({ itemId }) => {
      const item = getItemForMcp(userId, itemId);
      return item ? textResult(item) : errorResult("item_not_found");
    },
  );

  if (scope === "write") server.registerTool(
    "fetch_full_text",
    {
      title: "Fetch an article's full text",
      description: "Downloads the full article from its website when the feed only has a teaser, caches it and returns it. Content is capped at 40,000 characters.",
      inputSchema: {
        itemId: z.number().int().positive(),
        force: z.boolean().optional().describe("Fetch again even when a cached full text exists"),
      },
    },
    async ({ itemId, force }) => {
      const result = await loadFullText(userId, itemId, { force });
      if (!result.ok) return errorResult(result.message ? `${result.error}: ${result.message}` : result.error);
      return textResult({
        id: result.id,
        title: result.title ?? undefined,
        byline: result.byline ?? undefined,
        cached: result.cached,
        content_html: result.fullContentHtml.slice(0, MAX_CONTENT_LENGTH),
        content_truncated: result.fullContentHtml.length > MAX_CONTENT_LENGTH,
      });
    },
  );

  server.registerTool(
    "search_items",
    {
      title: "Search feed items",
      description: "Searches item titles and summaries for a phrase across all items the user can access.",
      inputSchema: {
        query: z.string().min(1).max(200),
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        bookmarkedOnly: z.boolean().optional(),
        ...publishedRange,
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ query, feedId, folderId, bookmarkedOnly, since, until, limit }) =>
      textResult(listItemsForUser(userId, {
        search: query, feedId, folderId, bookmarkedOnly, limit, publishedSince: since, publishedUntil: until,
      })),
  );

  const itemActions = [
    ["mark_read", "Mark items as read", "Marks one or more subscribed items as read.", markItemRead],
    ["mark_unread", "Mark items as unread", "Marks one or more subscribed items as unread.", markItemUnread],
    ["bookmark_item", "Bookmark items", "Bookmarks one or more items for later reading and protects them from retention cleanup.", bookmarkItem],
    ["unbookmark_item", "Remove bookmarks", "Removes the bookmark from one or more items.", unbookmarkItem],
  ] as const;
  if (scope === "write") for (const [name, title, description, change] of itemActions) {
    server.registerTool(name, { title, description, inputSchema: itemSelection }, async (args) => {
      const itemIds = selectedItemIds(args);
      if (itemIds.length === 0) return errorResult("Provide itemId or itemIds");
      // `updated` counts items whose state actually changed.
      return textResult({ ok: true, updated: applyToItems(itemIds, (itemId) => change(userId, itemId)) });
    });
  }

  if (scope === "write") server.registerTool(
    "mark_all_read",
    {
      title: "Mark all items as read",
      description: "Marks all subscribed items as read, optionally limited to one feed or folder.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
      },
    },
    async ({ feedId, folderId }) => textResult({ marked: markAllRead(userId, { feedId, folderId }) }),
  );

  server.registerTool(
    "list_muted_keywords",
    {
      title: "List muted keywords",
      description: "Lists all muted keywords configured for the current user.",
      inputSchema: {},
    },
    async () => textResult(listMutedKeywords(userId)),
  );

  if (scope === "write") server.registerTool(
    "add_muted_keyword",
    {
      title: "Add muted keyword",
      description: "Mutes a keyword. Articles containing this keyword will be filtered out from your feed.",
      inputSchema: { keyword: z.string().min(1).max(100) },
    },
    async ({ keyword }) => textResult(addMutedKeyword(userId, keyword)),
  );

  if (scope === "write") server.registerTool(
    "remove_muted_keyword",
    {
      title: "Remove muted keyword",
      description: "Unmutes a keyword by its ID.",
      inputSchema: { keywordId: z.number().int().positive() },
    },
    async ({ keywordId }) => {
      removeMutedKeyword(userId, keywordId);
      return textResult({ ok: true });
    },
  );

  server.registerTool(
    "export_opml",
    {
      title: "Export feeds as OPML",
      description: "Exports all subscribed feeds of the current user as an OPML 2.0 XML string.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: generateOpml(userId) }] }),
  );

  if (scope === "write") server.registerTool(
    "import_opml",
    {
      title: "Import feeds from OPML",
      description: "Imports feeds from an OPML 2.0 XML string for the current user.",
      inputSchema: {
        opml: z.string().min(1).describe("The OPML XML content to import"),
      },
    },
    async ({ opml }) => {
      try {
        const result = await importOpmlFeeds(userId, opml);
        return textResult(result);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "refresh_feed",
    {
      title: "Refresh a feed",
      description: "Forces an immediate poll of a subscribed feed to fetch new items and inspect feed health.",
      inputSchema: {
        feedId: z.number().int().positive().describe("The ID of the feed to refresh"),
      },
    },
    async ({ feedId }) => {
      const feed = findFeedById(feedId);
      if (!feed || !isUserSubscribed(userId, feedId)) {
        return errorResult("Feed not found or not subscribed");
      }
      try {
        const result = await pollFeed(feed);
        const updated = listSubscriptionsForUser(userId).find((f) => f.id === feedId);
        return textResult({
          success: !result.error,
          newItems: result.newItems,
          error: result.error,
          feed: updated,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  const currentUser = findUserById(userId);
  if (scope === "write" && currentUser?.role === "admin") {
    server.registerTool(
      "cleanup_database",
      {
        title: "Clean up database and retention",
        description: "Admin tool: runs item retention cleanup and VACUUM to purge old/read items and reclaim disk space.",
        inputSchema: {
          retentionReadDays: z.number().int().min(0).optional().describe("Override read items retention in days"),
          retentionMaxDays: z.number().int().min(0).optional().describe("Override total item age retention in days"),
          retentionMaxItemsPerFeed: z.number().int().min(0).optional().describe("Override maximum items per feed cap"),
        },
      },
      async (args) => {
        try {
          const result = runCleanup(args);
          const stats = getDatabaseStats();
          return textResult({ result, stats });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }

  return server;
}
