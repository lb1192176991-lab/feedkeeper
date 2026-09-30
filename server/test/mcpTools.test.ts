import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("MCP batch actions, date filters and feed management stay scoped to the user", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribe, createFolder, updateSubscriptionFolder } = await import("../src/feeds/repository.js");
  const { createMcpServerForUser } = await import("../src/mcp/server.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("tools-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("tools-other@example.test", "Other").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url, title) VALUES (?, 'Source')").run("https://example.test/feed").lastInsertRowid);
  const foreignFeedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.test/other").lastInsertRowid);
  subscribe(ownerId, feedId);
  subscribe(otherId, foreignFeedId);

  const insert = db.prepare("INSERT INTO items (feed_id, guid, title, published_at, created_at) VALUES (?, ?, ?, ?, ?)");
  const early = Number(insert.run(feedId, "a", "Early", "2026-01-05T10:00:00.000Z", "2026-01-05T10:00:00.000Z").lastInsertRowid);
  const late = Number(insert.run(feedId, "b", "Late", "2026-03-01T10:00:00.000Z", "2026-03-01T10:00:00.000Z").lastInsertRowid);
  const undated = Number(insert.run(feedId, "c", "Undated", "not a date", "2026-02-10T10:00:00.000Z").lastInsertRowid);
  const foreign = Number(insert.run(foreignFeedId, "d", "Foreign", null, "2026-02-01T10:00:00.000Z").lastInsertRowid);

  const connect = async (userId: number, scope: "read" | "write") => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServerForUser(userId, scope);
    const client = new Client({ name: "feedkeeper-test", version: "1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { text: string }[])[0].text;
      return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) };
    };
    return { client, server, call };
  };

  const owner = await connect(ownerId, "write");

  // Batch: foreign items and duplicates are ignored, repeated calls change nothing.
  assert.deepEqual((await owner.call("mark_read", { itemIds: [early, late, late, foreign] })).json(), { ok: true, updated: 2 });
  assert.equal((await owner.call("mark_read", { itemIds: [early] })).json().updated, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_reads WHERE user_id = ?").get(otherId)?.n, 0);
  assert.equal((await owner.call("mark_unread", { itemId: late })).json().updated, 1);
  assert.equal((await owner.call("bookmark_item", { itemIds: [early, undated] })).json().updated, 2);
  assert.equal((await owner.call("mark_read", {})).isError, true);

  // Publish-date range; an unparseable date falls back to the stored time.
  const inFebruary = (await owner.call("search_items", { query: "e", since: "2026-02-01", until: "2026-02-28" })).json();
  assert.deepEqual(inFebruary.map((item: { id: number }) => item.id), [undated]);
  const unreadSinceFeb = (await owner.call("get_new_items", { since: "2026-02-01T00:00:00Z" })).json();
  assert.deepEqual(unreadSinceFeb.map((item: { id: number }) => item.id).sort(), [late, undated].sort());
  const page = (await owner.call("list_items", { until: "2026-01-31" })).json();
  assert.deepEqual(page.items.map((item: { id: number }) => item.id), [early]);
  assert.equal((await owner.call("list_items", { since: "yesterday" })).isError, true);

  // Feed settings: label and a poll interval floored to the server minimum.
  const renamed = (await owner.call("update_feed", { feedId, label: "My Feed", pollIntervalMinutes: 1 })).json();
  assert.equal(renamed.label, "My Feed");
  assert.ok(renamed.poll_interval_minutes >= 1);
  assert.equal((await owner.call("update_feed", { feedId: foreignFeedId, label: "x" })).isError, true);
  assert.equal((await owner.call("update_feed", { feedId, fullText: "never" })).json().full_text_mode, "never");
  assert.equal((await owner.call("fetch_full_text", { itemId: early })).text, "item_has_no_link");

  // Folders: rename, reject duplicates, delete keeps the subscription.
  const folder = createFolder(ownerId, "News");
  createFolder(ownerId, "Tech");
  updateSubscriptionFolder(ownerId, feedId, folder.id);
  assert.equal((await owner.call("rename_folder", { folderId: folder.id, name: "Daily" })).json().name, "Daily");
  assert.equal((await owner.call("rename_folder", { folderId: folder.id, name: "Tech" })).isError, true);
  const otherFolder = createFolder(otherId, "Private");
  assert.equal((await owner.call("delete_folder", { folderId: otherFolder.id })).isError, true);
  assert.deepEqual((await owner.call("delete_folder", { folderId: folder.id })).json(), { ok: true });
  assert.equal(db.prepare("SELECT folder_id FROM subscriptions WHERE user_id = ? AND feed_id = ?").get(ownerId, feedId)?.folder_id, null);

  // Health filter.
  assert.deepEqual((await owner.call("list_feeds", { onlyWithErrors: true })).json(), []);
  db.prepare("UPDATE feeds SET last_error = 'timeout', consecutive_errors = 3 WHERE id = ?").run(feedId);
  assert.equal((await owner.call("list_feeds", { onlyWithErrors: true })).json().length, 1);

  // Full text is a write tool and reports missing links instead of fetching.
  assert.equal((await owner.call("fetch_full_text", { itemId: early })).text, "item_has_no_link");
  assert.equal((await owner.call("fetch_full_text", { itemId: foreign })).text, "item_not_found");

  const reader = await connect(ownerId, "read");
  const readTools = (await reader.client.listTools()).tools.map((tool) => tool.name);
  for (const name of ["fetch_full_text", "update_feed", "rename_folder", "delete_folder", "mark_read", "bookmark_item"]) {
    assert.equal(readTools.includes(name), false, name);
  }
  assert.ok(readTools.includes("list_feeds"));

  for (const session of [owner, reader]) {
    await session.client.close();
    await session.server.close();
  }
  db.close();
});
