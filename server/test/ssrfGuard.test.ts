import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublicHttpUrl, createPublicDispatcher, isPublicIp, SsrfBlockedError } from "../src/feeds/ssrfGuard.js";

test("SSRF guard rejects private, special and IPv4-mapped addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "198.18.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2002:c0a8:101::1"]) {
    assert.equal(isPublicIp(address), false, address);
  }
  assert.equal(isPublicIp("93.184.216.34"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
  await assert.rejects(assertPublicHttpUrl("http://[::ffff:127.0.0.1]/"), SsrfBlockedError);
});

test("connection lookup rejects private DNS answers", async () => {
  const dispatcher = createPublicDispatcher();
  try {
    await assert.rejects(
      fetch("http://localhost:12345/", { dispatcher } as RequestInit & { dispatcher: typeof dispatcher }),
      (error: unknown) => error instanceof Error && error.cause instanceof SsrfBlockedError,
    );
  } finally {
    dispatcher.destroy();
  }
});
