import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

test("account capabilities and feature negotiation for self-hosted instances", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { authRouter } = await import("../src/api/auth.js");
  const { mcpRouter } = await import("../src/mcp/http.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const { setCapabilitiesProvider } = await import("../src/auth/capabilities.js");
  type CapabilitiesProvider = import("../src/auth/capabilities.js").CapabilitiesProvider;
  type AccountCapabilities = import("../src/auth/capabilities.js").AccountCapabilities;

  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const testUserId = Number(addUser.run("reader@example.test", "Test Reader").lastInsertRowid);
  const otherUserId = Number(addUser.run("other@example.test", "Other Reader").lastInsertRowid);

  const testToken = createPersonalAccessToken(testUserId, "Test Token", "write").token;
  const otherToken = createPersonalAccessToken(otherUserId, "Other Token", "write").token;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.headers["x-test-session-user"];
    if (header) {
      req.session = { userId: Number(header) } as typeof req.session;
    }
    next();
  });
  app.use("/api/auth", authRouter);
  app.use("/api/v1", v1Router);
  app.use("/mcp", mcpRouter);

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (path: string, token: string | null, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, body };
  };

  try {
    // 1. Default self-hosted behaviour:
    const v1MeRes = await call("/api/v1/me", testToken);
    assert.equal(v1MeRes.status, 200);
    const v1User = v1MeRes.body as { capabilities: AccountCapabilities };
    assert.equal(v1User.capabilities.type, "selfhosted");
    assert.equal(v1User.capabilities.features.mcp, true);
    assert.equal(v1User.capabilities.features.sync, true);

    const authMeRes = await call("/api/auth/me", null, { headers: { "x-test-session-user": String(testUserId) } });
    assert.equal(authMeRes.status, 200);
    const authUser = authMeRes.body as { capabilities: AccountCapabilities };
    assert.equal(authUser.capabilities.type, "selfhosted");

    // 2. Custom capability provider hook:
    class CustomProvider implements CapabilitiesProvider {
      getCapabilitiesForUser(userId: number): AccountCapabilities {
        const hasMcp = userId === testUserId;
        return {
          type: "custom",
          features: {
            mcp: hasMcp,
            sync: true,
            notes: true,
            editions: true,
            fulltext: true,
          },
          manageUrl: "https://account.example.test",
        };
      }

      hasCapability(userId: number, capability: string): boolean {
        const userCaps = this.getCapabilitiesForUser(userId);
        return Boolean(userCaps.features[capability]);
      }
    }

    setCapabilitiesProvider(new CustomProvider());

    // User without MCP capability receives 403 capability_not_available
    const mcpDeniedRes = await call("/mcp", otherToken, {
      method: "POST",
      body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });
    assert.equal(mcpDeniedRes.status, 403);
    assert.equal((mcpDeniedRes.body as { error: string }).error, "capability_not_available");

    // User with MCP capability is authorized
    const mcpAllowedRes = await call("/mcp", testToken, {
      method: "POST",
      body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });
    assert.notEqual(mcpAllowedRes.status, 403);
  } finally {
    server.close();
    db.close();
  }
});
