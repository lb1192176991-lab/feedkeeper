import { fetchFeed } from "./fetcher.js";

const ICON_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** Pick the best icon a page declares: a small `icon` first, then `apple-touch-icon`. */
export function pickIconUrl(html: string, baseUrl: string): string | null {
  const head = html.slice(0, html.search(/<\/head>/i) === -1 ? 200_000 : html.search(/<\/head>/i));
  const candidates: { url: string; score: number }[] = [];

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attribute(tag, "href");
    if (!href || rel.includes("mask-icon")) continue;
    const touch = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!touch && !rel.includes("icon")) continue;

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;

    // Prefer icons close to the ~32px they are displayed at; touch icons are a fallback.
    const size = Number(attribute(tag, "sizes")?.match(/(\d+)x\d+/i)?.[1] ?? 0);
    const sizeScore = size ? Math.abs(Math.log2(size / 32)) : /\.svg(\?|$)/i.test(url.pathname) ? 0.5 : 1;
    candidates.push({ url: url.toString(), score: sizeScore + (touch ? 3 : 0) });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.url ?? null;
}

export function iconCheckDue(checkedAt: string | null): boolean {
  return !checkedAt || Date.now() - Date.parse(checkedAt) > ICON_RECHECK_MS;
}

/** Look up the icon declared by a website's home page; null when none is declared or the page fails. */
export async function discoverIconUrl(siteUrl: string): Promise<string | null> {
  try {
    const page = await fetchFeed(siteUrl);
    return pickIconUrl(page.body, page.finalUrl);
  } catch {
    return null;
  }
}
