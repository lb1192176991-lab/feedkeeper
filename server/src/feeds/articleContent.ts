import { JSDOM } from "jsdom";
import type { Item } from "./repository.js";
import { decodeEntities } from "./text.js";

/** Plain publisher content, shared by readers, search consumers and MCP. */
export function articleText(html: string | null | undefined): string {
  if (!html) return "";
  const fragment = JSDOM.fragment(html);
  fragment.querySelectorAll("script, style, noscript, nav, footer").forEach(node => node.remove());
  fragment.querySelectorAll("p, div, br, li, h1, h2, h3, h4, blockquote").forEach(node => node.append(" "));
  return (fragment.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function contentMetadata(item: Item) {
  const source = item.full_content_html ? "reader" : item.content_html ? "feed" : "snippet";
  return { revision: item.content_revision, source, status: item.extraction_status,
    attemptedAt: item.extraction_attempted_at, retryAt: item.extraction_retry_at };
}

export function sourceText(item: Item) {
  return `${decodeEntities(item.title) ?? ""}\n${articleText(item.full_content_html || item.content_html) || decodeEntities(item.content_snippet) || ""}`.trim();
}

/** Prefer existing substantive publisher text over a shorter extracted teaser. */
export function improvesContent(item: Item, extracted: string): boolean {
  const candidate = articleText(extracted).length;
  const existing = articleText(item.full_content_html || item.content_html).length;
  return candidate >= 200 && candidate >= existing * 0.9;
}
