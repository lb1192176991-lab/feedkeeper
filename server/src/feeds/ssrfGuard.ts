import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

const BENCHMARK_NETWORK = ipaddr.parse("198.18.0.0") as ipaddr.IPv4;

export class SsrfBlockedError extends Error {
  constructor(url: string) {
    super(`Refusing to fetch "${url}": resolves to a blocked internal address`);
    this.name = "SsrfBlockedError";
  }
}

export function normalizeUrlCandidate(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

export function isPublicIp(address: string): boolean {
  try {
    const parsed = ipaddr.process(address.replace(/^\[|\]$/g, ""));
    // The benchmarking range is reported as "unicast" by ipaddr.js.
    if (parsed.kind() === "ipv4" && (parsed as ipaddr.IPv4).match(BENCHMARK_NETWORK, 15)) {
      return false;
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

function assertPublicAddresses(addresses: Array<{ address: string }>, url: string): void {
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new SsrfBlockedError(url);
  }
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(normalizeUrlCandidate(rawUrl));
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are allowed");
  }
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(hostname)) {
    if (!isPublicIp(hostname)) throw new SsrfBlockedError(rawUrl);
  } else {
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      throw new SsrfBlockedError(rawUrl);
    }
    assertPublicAddresses(await lookup(hostname, { all: true }), rawUrl);
  }

  return url;
}

// Validate the address actually used by the socket. A DNS answer can change
// between URL validation and connection, so the preflight check alone is insufficient.
export function createPublicDispatcher(): Agent {
  const guardedLookup: LookupFunction = (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true })
      .then((addresses) => {
        try {
          assertPublicAddresses(addresses, hostname);
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        } catch (error) {
          callback(error as NodeJS.ErrnoException, "");
        }
      })
      .catch((error: NodeJS.ErrnoException) => callback(error, ""));
  };
  return new Agent({ connect: { lookup: guardedLookup } });
}
