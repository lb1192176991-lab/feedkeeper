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
        "search.fts": true,
      },
      manageUrl: null,
    };
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

/** The advertised feature map is also the authority for enforcement. Missing keys deny access. */
export function hasUserCapability(userId: number, capability: string): boolean {
  return getUserCapabilities(userId).features[capability] === true;
}

export function capabilityDenial(userId: number, capability: string) {
  return {
    error: "capability_not_available",
    capability,
    manageUrl: getUserCapabilities(userId).manageUrl ?? null,
  };
}

export function requireCapability(capability: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "not_authenticated" });
      return;
    }
    if (!hasUserCapability(userId, capability)) {
      res.status(403).json(capabilityDenial(userId, capability));
      return;
    }
    next();
  };
}
