import assert from "node:assert/strict";
import { test } from "node:test";
import { extractArticleFromUrl } from "../src/feeds/extractor.js";
import { SsrfBlockedError } from "../src/feeds/ssrfGuard.js";

test("article extraction rejects redirects to internal addresses", async () => {
  const requests: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    requests.push(String(input));
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  };

  await assert.rejects(extractArticleFromUrl("https://93.184.216.34/article", mockFetch), SsrfBlockedError);
  assert.deepEqual(requests, ["https://93.184.216.34/article"]);
});

test("article extraction skips oversized responses", async () => {
  let requests = 0;
  const mockFetch: typeof fetch = async () => {
    requests++;
    return new Response("too large", {
      headers: { "content-length": String(6 * 1024 * 1024) },
    });
  };

  assert.equal(await extractArticleFromUrl("https://93.184.216.34/article", mockFetch), null);
  assert.equal(requests, 2);
});
