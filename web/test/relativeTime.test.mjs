import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRelativeTime } from "../src/utils/relativeTime.ts";

test("poll times read as short relative phrases", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  assert.equal(formatRelativeTime(new Date(now - 5 * 60_000), "en", now), "5 minutes ago");
  assert.equal(formatRelativeTime(new Date(now - 3 * 3_600_000), "en", now), "3 hours ago");
  assert.equal(formatRelativeTime(new Date(now - 26 * 3_600_000), "en", now), "yesterday");
  assert.equal(formatRelativeTime(new Date(now - 10_000), "en", now), "this minute");
  assert.equal(formatRelativeTime(new Date(now - 5 * 60_000), "de", now), "vor 5 Minuten");
});
