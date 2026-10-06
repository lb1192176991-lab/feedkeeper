import type { Request, Response } from "express";

/**
 * Who is signing in on /oauth/authorize. The core shows its own login form; a hosting product
 * (FeedKeeper Cloud) swaps in its own sign-in and may redirect away.
 */
export interface OAuthHost {
  /** The signed-in user's id, or null once the response (login page, redirect) has been sent. */
  resolveResourceOwner(req: Request, res: Response): number | null;
}

let activeHost: OAuthHost | null = null;

export function setOAuthHost(host: OAuthHost | null): void {
  activeHost = host;
}

export function getOAuthHost(): OAuthHost | null {
  return activeHost;
}
