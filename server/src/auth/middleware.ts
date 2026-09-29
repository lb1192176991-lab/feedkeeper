import type { NextFunction, Request, Response } from "express";
import { resolveToken, type TokenScope } from "./tokens.js";
import { findUserById, toPublicUser, type PublicUser } from "./users.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
      tokenScope?: TokenScope;
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

// MCP / API auth: Bearer personal access token, scopes the request to its owner.
export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const resolved = resolveToken(token);
  if (!resolved) {
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
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
