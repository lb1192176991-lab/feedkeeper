import Parser from "rss-parser";
import cron from "node-cron";
import { fetchFeed } from "./fetcher.js";
import { listFeedsDueForPoll, updateFeedAfterPoll, upsertItems, type Feed } from "./repository.js";

type CustomItem = Parser.Item & {
  mediaContent?: any;
  mediaThumbnail?: any;
  contentEncoded?: string;
  "media:content"?: any;
  "media:thumbnail"?: any;
  "content:encoded"?: string;
};

const parser = new Parser<Record<string, unknown>, CustomItem>({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["content:encoded", "contentEncoded", { keepArray: false }],
    ],
  },
});

function cleanImageUrl(url: string): string {
  return url.trim().replace(/&#038;/g, "&").replace(/&amp;/g, "&");
}

function isValidImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  if (trimmed.includes("/1x1") || trimmed.includes("pixel.wp.com") || trimmed.includes("tracking") || trimmed.includes("beacon")) {
    if (trimmed.includes("pixel") || trimmed.includes("1x1")) return false;
  }
  return true;
}

function extractImageUrl(item: CustomItem): string | null {
  // 1. media:content (Media RSS)
  const mediaContent = item.mediaContent ?? item["media:content"];
  if (mediaContent) {
    if (isValidImageUrl(mediaContent)) return cleanImageUrl(mediaContent);
    const url = mediaContent.$?.url ?? mediaContent.url;
    const medium = mediaContent.$?.medium ?? mediaContent.medium;
    const type = mediaContent.$?.type ?? mediaContent.type;
    if (isValidImageUrl(url) && (medium === "image" || !medium || (type && type.startsWith("image/")))) {
      return cleanImageUrl(url);
    }
  }

  // 2. media:thumbnail
  const mediaThumbnail = item.mediaThumbnail ?? item["media:thumbnail"];
  if (mediaThumbnail) {
    if (isValidImageUrl(mediaThumbnail)) return cleanImageUrl(mediaThumbnail);
    const url = mediaThumbnail.$?.url ?? mediaThumbnail.url;
    if (isValidImageUrl(url)) return cleanImageUrl(url);
  }

  // 3. enclosure
  if (item.enclosure?.url) {
    const url = item.enclosure.url;
    const type = item.enclosure.type ?? "";
    if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|svg)(\?.*)?$/i.test(url)) {
      if (isValidImageUrl(url)) return cleanImageUrl(url);
    }
  }

  // 4. First <img> tag in HTML content or summary
  const htmlContent = item.contentEncoded ?? item["content:encoded"] ?? item.content ?? item.summary ?? "";
  if (typeof htmlContent === "string" && htmlContent.includes("<img")) {
    const match = htmlContent.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)["']/i);
    if (match && isValidImageUrl(match[1])) {
      return cleanImageUrl(match[1]);
    }
  }

  return null;
}

export async function pollFeed(feed: Feed): Promise<{ newItems: number; error: string | null }> {
  try {
    const fetched = await fetchFeed(feed.url, {
      etag: feed.etag ?? undefined,
      lastModified: feed.last_modified ?? undefined,
    });

    if (fetched.notModified) {
      updateFeedAfterPoll(feed.id, { error: null });
      return { newItems: 0, error: null };
    }

    const parsed = await parser.parseString(fetched.body);

    const items = parsed.items.map((item) => ({
      guid: item.guid ?? item.link ?? item.title ?? crypto.randomUUID(),
      title: item.title,
      link: item.link,
      contentSnippet: item.contentSnippet ?? item.content,
      contentHtml: item.contentEncoded ?? item["content:encoded"] ?? item.content ?? null,
      publishedAt: item.isoDate ?? item.pubDate,
      imageUrl: extractImageUrl(item),
    }));

    const newItems = upsertItems(feed.id, items);

    updateFeedAfterPoll(feed.id, {
      title: parsed.title,
      siteUrl: parsed.link,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      error: null,
    });

    return { newItems, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateFeedAfterPoll(feed.id, { error: message });
    return { newItems: 0, error: message };
  }
}

export async function pollDueFeeds(): Promise<void> {
  const due = listFeedsDueForPoll();
  for (const feed of due) {
    await pollFeed(feed);
  }
}

export function startPollingScheduler(): void {
  // Runs every minute; each feed is only actually re-fetched once its own
  // poll_interval_minutes has elapsed (see listFeedsDueForPoll).
  cron.schedule("* * * * *", () => {
    pollDueFeeds().catch((error) => console.error("[poller] unexpected failure", error));
  });
}
