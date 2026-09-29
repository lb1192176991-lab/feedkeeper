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
  updateSubscriptionFolder,
} from "../feeds/repository.js";
import type { TokenScope } from "../auth/tokens.js";
import { getItemForMcp, listItemsPage } from "./items.js";
import { subscribeToFeed, unsubscribeFromFeed, FeedError, MultipleFeedsFoundError } from "../feeds/service.js";
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

// Builds a fresh MCP server scoped to a single authenticated user. A new
// instance is created per request (see mcp/http.ts) so tool handlers can
// safely close over `userId` without leaking data between users.
export function createMcpServerForUser(userId: number, scope: TokenScope): McpServer {
  const server = new McpServer({ name: "feedkeeper", version: APP_VERSION });

  server.registerTool(
    "list_feeds",
    {
      title: "List subscribed feeds",
      description: "Lists all RSS/Atom feeds the current user is subscribed to, including unread counts.",
      inputSchema: {},
    },
    async () => textResult(listSubscriptionsForUser(userId)),
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
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ feedId, folderId, search, bookmarkedOnly, limit }) =>
      textResult(listItemsForUser(userId, { feedId, folderId, search, bookmarkedOnly, limit, unreadOnly: true })),
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
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ query, feedId, folderId, bookmarkedOnly, limit }) =>
      textResult(listItemsForUser(userId, { search: query, feedId, folderId, bookmarkedOnly, limit })),
  );

  if (scope === "write") server.registerTool(
    "mark_read",
    {
      title: "Mark item as read",
      description: "Marks a feed item as read for the current user.",
      inputSchema: { itemId: z.number().int().positive() },
    },
    async ({ itemId }) => {
      markItemRead(userId, itemId);
      return textResult({ ok: true });
    },
  );

  if (scope === "write") server.registerTool(
    "mark_unread",
    {
      title: "Mark item as unread",
      description: "Marks a subscribed item as unread for the current user.",
      inputSchema: { itemId: z.number().int().positive() },
    },
    async ({ itemId }) => {
      markItemUnread(userId, itemId);
      return textResult({ ok: true });
    },
  );

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

  if (scope === "write") server.registerTool(
    "bookmark_item",
    {
      title: "Bookmark an item",
      description: "Bookmarks/saves a feed item for later reading and protects it from retention purge.",
      inputSchema: { itemId: z.number().int().positive() },
    },
    async ({ itemId }) => {
      bookmarkItem(userId, itemId);
      return textResult({ ok: true });
    },
  );

  if (scope === "write") server.registerTool(
    "unbookmark_item",
    {
      title: "Remove bookmark",
      description: "Removes bookmark from a feed item.",
      inputSchema: { itemId: z.number().int().positive() },
    },
    async ({ itemId }) => {
      unbookmarkItem(userId, itemId);
      return textResult({ ok: true });
    },
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
