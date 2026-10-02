import { db } from "../db/index.js";
import { fetchImage } from "./fetcher.js";
import { detectImageType } from "./archive.js";

const MAX_ICON_BYTES = 256 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 500;

export interface FeedIcon {
  buffer: Buffer;
  mime: string;
}

const cache = new Map<number, { icon: FeedIcon | null; fetchedAt: number }>();

/** Icons are small, so besides raster images the formats typical for favicons are accepted. */
function detectIconType(buffer: Uint8Array): string | null {
  const raster = detectImageType(buffer);
  if (raster) return raster.mime;
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) return "image/x-icon";
  const head = Buffer.from(buffer.subarray(0, 512)).toString("utf8").trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(head) ? "image/svg+xml" : null;
}

/** Whether the user subscribes to the feed or has saved one of its articles. */
export function canAccessFeed(userId: number, feedId: number): boolean {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM feeds f WHERE f.id = ?
         AND (EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = f.id AND s.user_id = ?)
           OR EXISTS (SELECT 1 FROM items i JOIN item_bookmarks b ON b.item_id = i.id WHERE i.feed_id = f.id AND b.user_id = ?))`,
    ).get(feedId, userId, userId),
  );
}

function candidates(feed: { icon_url: string | null; site_url: string | null; url: string }): string[] {
  const urls = new Set<string>();
  if (feed.icon_url) urls.add(feed.icon_url);
  for (const source of [feed.site_url, feed.url]) {
    try {
      if (source) urls.add(`${new URL(source).origin}/favicon.ico`);
    } catch {
      // Try the next source.
    }
  }
  return [...urls];
}

/**
 * The feed's icon, fetched by this server so the browser can keep it for offline use
 * without asking third-party sites. Remembered for a day, including "none found".
 */
export async function loadFeedIcon(feedId: number): Promise<FeedIcon | null> {
  const known = cache.get(feedId);
  if (known && Date.now() - known.fetchedAt < TTL_MS) return known.icon;

  const feed = db.prepare<[number], { icon_url: string | null; site_url: string | null; url: string }>("SELECT icon_url, site_url, url FROM feeds WHERE id = ?").get(feedId);
  let icon: FeedIcon | null = null;
  for (const url of feed ? candidates(feed) : []) {
    try {
      const { buffer } = await fetchImage(url, MAX_ICON_BYTES);
      const mime = detectIconType(buffer);
      if (mime) {
        icon = { buffer, mime };
        break;
      }
    } catch {
      // Try the next candidate.
    }
  }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(feedId, { icon, fetchedAt: Date.now() });
  return icon;
}

/** Forget remembered icons (tests). */
export function clearIconCache(): void {
  cache.clear();
}
