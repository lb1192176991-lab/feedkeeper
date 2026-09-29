import assert from "node:assert/strict";
import { test } from "node:test";

test("item state changes require a feed subscription", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { markItemRead, bookmarkItem, subscribe } = await import("../src/feeds/repository.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("other@example.test", "Other").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.com/feed").lastInsertRowid);
  const itemId = Number(db.prepare("INSERT INTO items (feed_id, guid) VALUES (?, 'item')").run(feedId).lastInsertRowid);
  subscribe(ownerId, feedId);

  markItemRead(otherId, itemId);
  bookmarkItem(otherId, itemId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_reads WHERE user_id = ?").get(otherId)?.count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_bookmarks WHERE user_id = ?").get(otherId)?.count, 0);

  markItemRead(ownerId, itemId);
  bookmarkItem(ownerId, itemId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_reads WHERE user_id = ?").get(ownerId)?.count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_bookmarks WHERE user_id = ?").get(ownerId)?.count, 1);

  db.close();
});
