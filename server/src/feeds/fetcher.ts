import { assertPublicHttpUrl, createPublicDispatcher } from "./ssrfGuard.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;
const USER_AGENT = "FeedKeeper/1.0 (+https://github.com/visualfusion/feedkeeper)";

export interface FetchedFeed {
  body: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
  contentType?: string;
  finalUrl: string;
}

// Fetches a feed URL while re-validating every redirect hop against the SSRF
// guard, capping response size, and honoring conditional GET headers.
export async function fetchFeed(
  url: string,
  opts: { etag?: string; lastModified?: string } = {},
): Promise<FetchedFeed> {
  let currentUrl = url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const dispatcher = createPublicDispatcher();

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const validated = await assertPublicHttpUrl(currentUrl);

      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml;q=0.9, */*;q=0.5",
      };
      if (redirects === 0 && opts.etag) headers["If-None-Match"] = opts.etag;
      if (redirects === 0 && opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

      const response = await fetch(validated, {
        headers,
        redirect: "manual",
        signal: controller.signal,
        dispatcher,
      } as RequestInit & { dispatcher: typeof dispatcher });

      if (response.status === 304) {
        return {
          notModified: true,
          body: "",
          finalUrl: currentUrl,
          contentType: response.headers.get("content-type") ?? undefined,
        };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect from ${currentUrl} without a Location header`);
        await response.body?.cancel();
        currentUrl = new URL(location, validated).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`Feed responded with HTTP ${response.status}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        throw new Error("Feed response exceeds the maximum allowed size");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Feed response had no body");

      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("Feed response exceeds the maximum allowed size");
        }
        chunks.push(value);
      }

      const rawBuffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const contentType = response.headers.get("content-type") ?? undefined;
      const body = decodeFeedBuffer(rawBuffer, contentType);

      return {
        body,
        notModified: false,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        contentType,
        finalUrl: currentUrl,
      };
    }

    throw new Error(`Too many redirects while fetching ${url}`);
  } finally {
    clearTimeout(timeout);
    dispatcher.destroy();
  }
}

/**
 * Decodes raw response buffer into a string respecting character encoding from:
 * 1. HTTP Content-Type header (e.g. charset=ISO-8859-1)
 * 2. XML declaration header (e.g. <?xml version="1.0" encoding="ISO-8859-1"?>)
 * Defaults to UTF-8.
 */
function decodeFeedBuffer(buffer: Buffer, contentType?: string): string {
  let charset: string | null = null;

  if (contentType) {
    const match = contentType.match(/charset=([^;]+)/i);
    if (match) {
      charset = match[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  if (!charset) {
    const snippet = buffer.subarray(0, 1024).toString("ascii");
    const xmlMatch = snippet.match(/<\?xml[^>]+encoding=["']([^"']+)["']/i);
    if (xmlMatch) {
      charset = xmlMatch[1].trim();
    }
  }

  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // If TextDecoder does not recognize the charset, fall back to utf-8
    }
  }

  return buffer.toString("utf8");
}
