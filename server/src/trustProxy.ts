/**
 * Express "trust proxy" setting from TRUST_PROXY.
 *
 * - unset, "" or "false": trust no proxy
 * - "true": trust exactly one proxy hop (the previous behaviour)
 * - a number: trust that many hops
 * - a comma-separated list of addresses, CIDR ranges or the names "loopback", "linklocal"
 *   and "uniquelocal": trust only those proxies. Use this when several proxies sit in front of
 *   the server (for example a CDN and the hosting provider's web server), so rate limits and
 *   logs see the real client address and clients that bypass the CDN cannot spoof one.
 */
export type TrustProxySetting = boolean | number | string[];

export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "" || trimmed === "false") return false;
  if (trimmed === "true") return 1;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const entries = trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  return entries;
}
