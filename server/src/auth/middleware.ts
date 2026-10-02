import type { NextFunction, Request, Response } from "express";
import { resolveToken, type TokenKind, type TokenScope } from "./tokens.js";
import { findUserById, toPublicUser, type PublicUser } from "./users.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
      tokenScope?: TokenScope;
      /** Set when the request was authenticated with a token rather than a session. */
      tokenId?: number;
      tokenKind?: TokenKind;
    }
  }
}

// Web UI auth: cookie session set at login.
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session?.userId as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }
  const user = findUserById(userId);
  if (!user) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }
  req.user = toPublicUser(user);
  next();
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

// MCP auth: Bearer personal access token (not a paired device), scopes the request to its owner.
export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  authenticateBearer(["api"])(req, res, next);
}

// Native app API: a paired device token or a hand-made token; the web UI may call it with its session.
export function requireSessionOrDevice(req: Request, res: Response, next: NextFunction): void {
  if (bearerToken(req)) authenticateBearer(["api", "device"])(req, res, next);
  else requireSession(req, res, next);
}

export function authenticateBearer(kinds: TokenKind[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    bearerAuth(req, res, next, kinds);
  };
}

function bearerAuth(req: Request, res: Response, next: NextFunction, kinds: TokenKind[]): void {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const resolved = resolveToken(token);
  if (!resolved || !kinds.includes(resolved.kind)) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const user = findUserById(resolved.userId);
  if (!user) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  req.user = toPublicUser(user);
  req.tokenScope = resolved.scope;
  req.tokenId = resolved.tokenId;
  req.tokenKind = resolved.kind;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
