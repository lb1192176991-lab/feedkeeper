import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listItemsForUser, listSubscriptionsForUser, markItemRead, findFeedById, isUserSubscribed } from "../feeds/repository.js";
import { subscribeToFeed, unsubscribeFromFeed, FeedError, MultipleFeedsFoundError } from "../feeds/service.js";
import { SsrfBlockedError } from "../feeds/ssrfGuard.js";
import { generateOpml, importOpmlFeeds } from "../feeds/opml.js";
import { pollFeed } from "../feeds/poller.js";
import { discoverFeeds } from "../feeds/discovery.js";
import { findUserById } from "../auth/users.js";
import { getDatabaseStats, runCleanup } from "../feeds/cleanup.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

// Builds a fresh MCP server scoped to a single authenticated user. A new
// instance is created per request (see mcp/http.ts) so tool handlers can
// safely close over `userId` without leaking data between users.
export function createMcpServerForUser(userId: number): McpServer {
  const server = new McpServer({ name: "feedkeeper", version: "0.1.0" });

  server.registerTool(
    "list_feeds",
    {
      title: "List subscribed feeds",
      description: "Lists all RSS/Atom feeds the current user is subscribed to, including unread counts.",
      inputSchema: {},
    },
    async () => textResult(listSubscriptionsForUser(userId)),
  );

  server.registerTool(
    "subscribe_feed",
    {
      title: "Subscribe to a feed",
      description: "Subscribes the current user to an RSS/Atom feed URL or website URL (auto-discovering the feed).",
      inputSchema: {
        url: z.string().url().describe("The feed URL or website URL"),
        label: z.string().max(200).optional().describe("Optional display name for this feed"),
      },
    },
    async ({ url, label }) => {
      try {
        const subscription = await subscribeToFeed(userId, url, label ?? null);
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
      description: "Inspects a website URL and discovers available RSS/Atom/JSON feed links.",
      inputSchema: {
        url: z.string().url().describe("The website URL to discover feeds from"),
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

  server.registerTool(
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
    "get_new_items",
    {
      title: "Get new feed items",
      description: "Returns unread items, optionally filtered by feed or a search term.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        search: z.string().max(200).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ feedId, search, limit }) =>
      textResult(listItemsForUser(userId, { feedId, search, limit, unreadOnly: true })),
  );

  server.registerTool(
    "search_items",
    {
      title: "Search feed items",
      description: "Full-text search (title/summary) across all items the user has access to, read or unread.",
      inputSchema: {
        query: z.string().min(1).max(200),
        feedId: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ query, feedId, limit }) => textResult(listItemsForUser(userId, { search: query, feedId, limit })),
  );

  server.registerTool(
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

  server.registerTool(
    "export_opml",
    {
      title: "Export feeds as OPML",
      description: "Exports all subscribed feeds of the current user as an OPML 2.0 XML string.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: generateOpml(userId) }] }),
  );

  server.registerTool(
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

  server.registerTool(
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
  if (currentUser?.role === "admin") {
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
