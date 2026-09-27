import Parser from "rss-parser";
import { fetchFeed } from "./fetcher.js";
import { assertPublicHttpUrl } from "./ssrfGuard.js";

const rssParser = new Parser();

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  type: string;
}

// Common alternate feed types found in HTML <head>
const FEED_MIME_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/feed+json",
  "application/json",
  "text/xml",
  "application/xml",
];

/**
 * Given a URL, determines if it is already a direct RSS/Atom/JSON feed
 * or if it is an HTML page that links to one or more feeds (auto-discovery).
 */
export async function discoverFeeds(inputUrl: string): Promise<DiscoveredFeed[]> {
  const validated = await assertPublicHttpUrl(inputUrl);
  const targetUrl = validated.toString();

  const fetched = await fetchFeed(targetUrl);
  if (!fetched.body) {
    return [];
  }

  // 1. Check if the fetched content is already an RSS or Atom feed directly
  try {
    const parsed = await rssParser.parseString(fetched.body);
    if (parsed.items && (parsed.title || parsed.description || parsed.items.length > 0)) {
      return [
        {
          url: fetched.finalUrl || targetUrl,
          title: parsed.title ?? null,
          type: "application/rss+xml",
        },
      ];
    }
  } catch {
    // Not a direct RSS/Atom feed or parser threw, continue to HTML autodiscovery
  }

  // 2. Parse HTML looking for <link rel="alternate" type="..." href="...">
  const feeds = extractFeedsFromHtml(fetched.body, fetched.finalUrl || targetUrl);
  if (feeds.length > 0) {
    return feeds;
  }

  // 3. Fallback: try common feed paths relative to the domain (e.g., /feed, /rss.xml, /atom.xml)
  const commonPaths = ["/feed", "/rss.xml", "/atom.xml", "/feed.xml"];
  for (const path of commonPaths) {
    try {
      const candidateUrl = new URL(path, fetched.finalUrl || targetUrl).toString();
      if (candidateUrl === targetUrl) continue;

      const candidateFetch = await fetchFeed(candidateUrl);
      const parsed = await rssParser.parseString(candidateFetch.body);
      if (parsed.items && (parsed.title || parsed.items.length > 0)) {
        return [
          {
            url: candidateFetch.finalUrl || candidateUrl,
            title: parsed.title ?? null,
            type: "application/rss+xml",
          },
        ];
      }
    } catch {
      // Ignore fallback check errors
    }
  }

  return [];
}

/**
 * Extracts feed links from an HTML document body.
 */
export function extractFeedsFromHtml(html: string, baseUrl: string): DiscoveredFeed[] {
  const results: DiscoveredFeed[] = [];
  const seenUrls = new Set<string>();

  // Regex to match <link ...> tags (case-insensitive)
  const linkTagRegex = /<link\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkTagRegex.exec(html)) !== null) {
    const attrsStr = match[1];

    // Extract attributes
    const rel = getAttr(attrsStr, "rel")?.toLowerCase();
    const type = getAttr(attrsStr, "type")?.toLowerCase();
    const href = getAttr(attrsStr, "href");
    const title = getAttr(attrsStr, "title") || null;

    if (!href) continue;

    // Check if rel contains 'alternate' (it can be e.g. "alternate")
    if (rel && rel.split(/\s+/).includes("alternate") && type) {
      if (FEED_MIME_TYPES.includes(type)) {
        try {
          const resolved = new URL(href, baseUrl).toString();
          if (!seenUrls.has(resolved)) {
            seenUrls.add(resolved);
            results.push({
              url: resolved,
              title: title ? decodeHtmlEntities(title.trim()) : null,
              type,
            });
          }
        } catch {
          // invalid URL in href, skip
        }
      }
    }
  }

  // Also check for <a> tags with explicit feed links if no <link> was found
  if (results.length === 0) {
    const aTagRegex = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>(.*?)<\/a>/gi;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = aTagRegex.exec(html)) !== null) {
      const href = aMatch[2];
      const linkText = aMatch[3].replace(/<[^>]+>/g, "").trim();

      if (href && (href.endsWith("/feed") || href.endsWith(".rss") || href.endsWith(".xml") || href.includes("/rss/"))) {
        try {
          const resolved = new URL(href, baseUrl).toString();
          if (!seenUrls.has(resolved)) {
            seenUrls.add(resolved);
            results.push({
              url: resolved,
              title: linkText || null,
              type: "application/rss+xml",
            });
          }
        } catch {
          // skip
        }
      }
    }
  }

  return results;
}

function getAttr(attrsStr: string, attrName: string): string | null {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = regex.exec(attrsStr);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}
