import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// Walks the Express router tree and lists "METHOD /path" for every route.
function routesOf(router: { stack: { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: unknown[] }; matchers?: unknown }[] }, prefix = ""): string[] {
  return router.stack.flatMap((layer) => {
    if (layer.route) return Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${prefix}${layer.route!.path}`);
    if (layer.handle?.stack) return routesOf(layer.handle as never, prefix);
    return [];
  });
}

test("docs/openapi.yaml documents exactly the routes of the native API", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { v1Router } = await import("../src/api/v1/index.js");

  const spec = parse(readFileSync(fileURLToPath(new URL("../../docs/openapi.yaml", import.meta.url)), "utf8")) as { paths: Record<string, Record<string, unknown>> };
  const documented = Object.entries(spec.paths).flatMap(([path, operations]) =>
    Object.keys(operations).filter((key) => ["get", "post", "put", "patch", "delete"].includes(key)).map((method) => `${method.toUpperCase()} ${path.replace(/\{\w+\}/g, ":param")}`),
  );
  const implemented = routesOf(v1Router as never).map((route) => route.replace(/:\w+/g, ":param"));

  assert.deepEqual([...new Set(implemented)].sort(), [...new Set(documented)].sort());
});
