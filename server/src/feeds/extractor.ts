import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { assertPublicHttpUrl, SsrfBlockedError } from "./ssrfGuard.js";

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  contentHtml: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
}

const CONSENT_SELECTORS = [
  "#onetrust-consent-sdk",
  "#cmpbox",
  "#usercentrics-root",
  "[id*='sp_message_container']",
  "[class*='cookie-banner']",
  "[class*='cookie-consent']",
  "[class*='consent-banner']",
  "[id*='cookie-notice']",
  "[id*='cookie-banner']",
  ".qc-cmp2-container",
  "#didomi-host",
  "dialog[open]",
  ".cookie-wall",
  ".consent-wall",
  "[data-nosnippet]",
];

function cleanConsentDom(doc: Document): void {
  for (const sel of CONSENT_SELECTORS) {
    try {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      // ignore invalid selector in edge environments
    }
  }
}

/**
 * Checks if a given URL or extracted HTML/text is a cookie / consent wall rather than article content.
 */
export function isConsentContent(finalUrl: string, html: string, title?: string | null, text?: string | null): boolean {
  if (
    /\/zustimmung[\/?]/i.test(finalUrl) ||
    /\/consent[\/?]/i.test(finalUrl) ||
    /\/cookie-wall/i.test(finalUrl) ||
    /\/pur-abo[\/?]/i.test(finalUrl) ||
    /\/cmp[\/?]/i.test(finalUrl) ||
    /\/privacy-wall/i.test(finalUrl)
  ) {
    return true;
  }

  const combined = `${title || ""} ${text || ""} ${html}`.toLowerCase();
  const strongSignatures = [
    "cookies zustimmen",
    "nutzung aller cookies",
    "tracking zustimmen",
    "einwilligung verwalten",
    "werbung und tracking, indem sie",
    "zustimmen & weiter",
    "bevor sie fortfahren",
    "accept all cookies",
    "cookie-einstellungen",
    "alle cookies akzeptieren",
    "cookies akzeptieren",
    "we value your privacy",
  ];

  const headText = `${title || ""} ${text || ""}`.toLowerCase().slice(0, 600);

  for (const sig of strongSignatures) {
    if (combined.includes(sig)) {
      if (headText.includes(sig) || (text || "").length < 6000) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks cached HTML to see if it was a saved consent banner instead of real article content.
 */
export function isCachedConsentSnippet(html: string): boolean {
  return isConsentContent("", html, "", html.replace(/<[^>]+>/g, " "));
}

// Search crawlers bypass CMP/cookie consent walls because publishers want their content indexed
const FETCH_USER_AGENTS = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 FeedKeeper/0.4.0",
];
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

async function fetchArticleHtml(rawUrl: string, userAgent: string, signal: AbortSignal): Promise<{ html: string; url: string } | null> {
  let currentUrl = rawUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const safeUrl = await assertPublicHttpUrl(currentUrl);
    const response = await fetch(safeUrl, {
      signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
      },
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength > MAX_HTML_BYTES) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const html = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    return { html, url: safeUrl.toString() };
  }

  return null;
}

export async function extractArticleFromUrl(rawUrl: string): Promise<ExtractedArticle | null> {
  const safeUrl = await assertPublicHttpUrl(rawUrl);

  for (const ua of FETCH_USER_AGENTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const fetched = await fetchArticleHtml(safeUrl.toString(), ua, controller.signal);
      if (!fetched) continue;

      const dom = new JSDOM(fetched.html, { url: fetched.url });
      cleanConsentDom(dom.window.document);

      const reader = new Readability(dom.window.document, {
        charThreshold: 60,
      });
      const parsed = reader.parse();

      if (!parsed || !parsed.content) {
        continue;
      }

      if (isConsentContent(fetched.url, parsed.content, parsed.title, parsed.textContent)) {
        // Detected a consent/cookie redirect or banner page, try next user-agent
        continue;
      }

      return {
        title: parsed.title || null,
        byline: parsed.byline || null,
        contentHtml: parsed.content,
        textContent: parsed.textContent || "",
        excerpt: parsed.excerpt || null,
        siteName: parsed.siteName || null,
      };
    } catch (error) {
      if (error instanceof SsrfBlockedError) throw error;
      // Try next user-agent
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}
