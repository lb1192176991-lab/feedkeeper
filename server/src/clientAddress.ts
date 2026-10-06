import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";
import type { TrustProxySetting } from "./trustProxy.js";

/**
 * Takes the client address from a header set by a CDN, such as Cloudflare's CF-Connecting-IP.
 *
 * Some web servers in front of the app replace X-Forwarded-For with the address of the CDN edge
 * that connected to them, so `trust proxy` alone finds only that edge. The header is used only when
 * the request reached the app through the trusted proxies listed in TRUST_PROXY: `req.ip` must itself
 * be one of them. A client that bypasses the CDN is not trusted, so its own header is ignored.
 * Hop counts cannot tell a CDN edge from a client, so the header needs a TRUST_PROXY list.
 */
export function clientAddressFromHeader(header: string | null, trustProxy: TrustProxySetting) {
  const name = header?.trim().toLowerCase() || null;
  const enabled = name !== null && Array.isArray(trustProxy);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (enabled) {
      const value = req.headers[name];
      const address = typeof value === "string" ? value.trim() : "";
      const trusted = req.app.get("trust proxy fn") as (address: string, index: number) => boolean;
      if (address && isIP(address) && req.ip && trusted(req.ip, 0)) {
        Object.defineProperty(req, "ip", { value: address, configurable: true, enumerable: true });
      }
    }
    next();
  };
}
