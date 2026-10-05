import { JSDOM } from "jsdom";
import { db } from "../db/index.js";
import { canAccessItem } from "../feeds/repository.js";
import { decodeEntities } from "../feeds/text.js";

/** Bounded cached source material, without network requests or publisher scripts. */
export function cachedEditionSources(userId: number, itemIds: number[]) {
  if (itemIds.length > 24 || new Set(itemIds).size !== itemIds.length) throw new Error("invalid_source_selection");
  const perArticle = Math.min(6000, Math.floor(48000 / Math.max(1, itemIds.length)));
  const query = db.prepare<[number], { title: string | null; content_html: string | null; full_content_html: string | null; content_snippet: string | null }>(
    "SELECT title, content_html, full_content_html, content_snippet FROM items WHERE id = ?",
  );
  return itemIds.map((id) => {
    if (!canAccessItem(userId, id)) throw new Error("item_not_found");
    const row = query.get(id)!;
    const html = row.full_content_html || row.content_html;
    let body: string;
    if (html) {
      const document = JSDOM.fragment(html.slice(0, 200000));
      document.querySelectorAll("script, style, noscript, nav, footer").forEach((node) => node.remove());
      document.querySelectorAll("p, div, br, li, h1, h2, h3").forEach((node) => node.append(" "));
      body = document.textContent ?? "";
    } else body = decodeEntities(row.content_snippet) ?? "";
    const text = `${decodeEntities(row.title) ?? ""}\n${body}`.replace(/\s+/g, " ").trim().slice(0, perArticle).replace(/[\uD800-\uDBFF]$/, "");
    return { id, text, textKind: row.full_content_html ? "reader" : row.content_html ? "feed" : "snippet" };
  });
}
