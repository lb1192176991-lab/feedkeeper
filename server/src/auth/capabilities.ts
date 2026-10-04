import type { NextFunction, Request, Response } from "express";

export interface AccountCapabilities {
  type: "selfhosted" | string;
  features: {
    mcp: boolean;
    sync: boolean;
    notes: boolean;
    editions: boolean;
    fulltext: boolean;
    [key: string]: boolean;
  };
  manageUrl: string | null;
}

export interface CapabilitiesProvider {
  getCapabilitiesForUser(userId: number): AccountCapabilities;
  hasCapability(userId: number, capability: string): boolean;
}

class DefaultCapabilitiesProvider implements CapabilitiesProvider {
  getCapabilitiesForUser(_userId: number): AccountCapabilities {
    return {
      type: "selfhosted",
      features: {
        mcp: true,
        sync: true,
        notes: true,
        editions: true,
        fulltext: true,
      },
      manageUrl: null,
    };
  }

  hasCapability(_userId: number, _capability: string): boolean {
    return true;
  }
}

let activeCapabilitiesProvider: CapabilitiesProvider = new DefaultCapabilitiesProvider();

export function setCapabilitiesProvider(provider: CapabilitiesProvider): void {
  activeCapabilitiesProvider = provider;
}

export function getCapabilitiesProvider(): CapabilitiesProvider {
  return activeCapabilitiesProvider;
}

export function getUserCapabilities(userId: number): AccountCapabilities {
  return activeCapabilitiesProvider.getCapabilitiesForUser(userId);
}

export function requireCapability(capability: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "not_authenticated" });
      return;
    }
    if (!activeCapabilitiesProvider.hasCapability(userId, capability)) {
      const caps = activeCapabilitiesProvider.getCapabilitiesForUser(userId);
      res.status(403).json({
        error: "capability_not_available",
        capability,
        manageUrl: caps.manageUrl ?? null,
      });
      return;
    }
    next();
  };
}
