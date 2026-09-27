import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { config } from "../config.js";
import {
  listSubscriptionsForUser,
  findFeedByUrl,
  createFeed,
  isUserSubscribed,
  subscribe,
  type Feed,
} from "./repository.js";
import { assertPublicHttpUrl, SsrfBlockedError } from "./ssrfGuard.js";
import { pollFeed } from "./poller.js";

export interface OpmlFeedItem {
  url: string;
  label?: string;
}

export interface OpmlImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ url: string; reason: string }>;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

/**
 * Generates standard OPML 2.0 XML representation of all subscribed feeds for a user.
 */
export function generateOpml(userId: number): string {
  const subscriptions = listSubscriptionsForUser(userId);

  const outlines = subscriptions
    .map((s) => {
      const text = escapeXml(s.label || s.title || s.url);
      const xmlUrl = escapeXml(s.url);
      const htmlUrl = s.site_url ? ` htmlUrl="${escapeXml(s.site_url)}"` : "";
      return `    <outline text="${text}" title="${text}" type="rss" xmlUrl="${xmlUrl}"${htmlUrl} />`;
    })
    .join("\n");

  const now = new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Feedkeeper Subscriptions</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}

/**
 * Recursively extracts outline elements containing an xmlUrl attribute from parsed OPML.
 */
function extractOutlines(node: unknown, items: OpmlFeedItem[] = []): OpmlFeedItem[] {
  if (!node || typeof node !== "object") return items;

  if (Array.isArray(node)) {
    for (const item of node) {
      extractOutlines(item, items);
    }
    return items;
  }

  const record = node as Record<string, unknown>;

  const xmlUrl =
    (typeof record["@_xmlUrl"] === "string" ? record["@_xmlUrl"] : undefined) ??
    (typeof record["@_xmlurl"] === "string" ? record["@_xmlurl"] : undefined);

  if (xmlUrl) {
    const rawLabel =
      (typeof record["@_text"] === "string" ? record["@_text"] : undefined) ??
      (typeof record["@_title"] === "string" ? record["@_title"] : undefined);

    const label = rawLabel?.trim() ? rawLabel.trim() : undefined;
    items.push({ url: xmlUrl.trim(), label });
  }

  if (record.outline) {
    extractOutlines(record.outline, items);
  }

  return items;
}

/**
 * Parses an OPML document string and returns a list of feed URLs and their labels.
 */
export function parseOpml(xmlContent: string): OpmlFeedItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });

  const parsed = parser.parse(xmlContent);
  if (!parsed || !parsed.opml || !parsed.opml.body) {
    throw new Error("invalid_opml_format");
  }

  return extractOutlines(parsed.opml.body.outline);
}

const urlSchema = z.string().url();

/**
 * Imports feeds from an OPML document string for the given user.
 */
export async function importOpmlFeeds(userId: number, xmlContent: string): Promise<OpmlImportResult> {
  const feedItems = parseOpml(xmlContent);

  const result: OpmlImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const feedsToPoll: Feed[] = [];

  for (const item of feedItems) {
    if (!item.url) continue;

    const urlCheck = urlSchema.safeParse(item.url);
    if (!urlCheck.success) {
      result.failed++;
      result.errors.push({ url: item.url, reason: "invalid_url_format" });
      continue;
    }

    let normalizedUrl: string;
    try {
      const validated = await assertPublicHttpUrl(item.url);
      normalizedUrl = validated.toString();
    } catch (error) {
      result.failed++;
      const reason = error instanceof SsrfBlockedError ? error.message : "url_validation_failed";
      result.errors.push({ url: item.url, reason });
      continue;
    }

    try {
      let feed = findFeedByUrl(normalizedUrl);
      if (!feed) {
        feed = createFeed(normalizedUrl, Math.max(config.minPollIntervalMinutes, 15));
      }

      if (isUserSubscribed(userId, feed.id)) {
        result.skipped++;
        continue;
      }

      subscribe(userId, feed.id, item.label ?? null);
      result.imported++;
      feedsToPoll.push(feed);
    } catch (error) {
      result.failed++;
      result.errors.push({
        url: item.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Poll newly subscribed feeds asynchronously in background without blocking response
  if (feedsToPoll.length > 0) {
    (async () => {
      for (const feed of feedsToPoll) {
        try {
          await pollFeed(feed);
        } catch {
          // Last poll errors are tracked in the database feeds table
        }
      }
    })().catch(() => {});
  }

  return result;
}
