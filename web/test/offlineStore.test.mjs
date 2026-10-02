import assert from "node:assert/strict";
import test from "node:test";
import { filterOffline, offlineItems } from "../src/utils/offlineStore.ts";

const item = (id, feed_id, title, extra = {}) => ({ id, feed_id, title, content_snippet: null, read: false, bookmarked: false, published_at: `2026-10-0${id}T10:00:00Z`, ...extra });
const snapshot = {
  savedAt: "2026-10-02T10:00:00Z",
  feedFolders: { 1: 10, 2: null },
  saved: [item(1, 1, "Porsche studio", { bookmarked: true, read: true }), item(2, 2, "Quiet", { bookmarked: true, full_content_html: "<p>About a Porsche club</p>" })],
  recent: [item(2, 2, "Quiet", { bookmarked: true }), item(3, 1, "Third"), item(4, 2, "Fourth")],
};
const all = offlineItems(snapshot);
const ids = (items) => items.map((entry) => entry.id);

test("combines saved and recent articles without duplicates", () => {
  assert.deepEqual(ids(all).sort(), [1, 2, 3, 4]);
});

test("the saved view keeps the order of saving, everything else is newest first", () => {
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { bookmarkedOnly: true })), [1, 2]);
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, {})), [4, 3, 2, 1]);
});

test("unread only hides read articles, except in the saved view", () => {
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { unreadOnly: true })), [4, 3, 2]);
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { unreadOnly: true, bookmarkedOnly: true })), [1, 2]);
});

test("filters by feed and folder", () => {
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { feedId: 2 })), [4, 2]);
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { folderId: 10 })), [3, 1]);
});

test("searches titles and full text, ignoring case", () => {
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { search: "PORSCHE" })), [2, 1]);
  assert.deepEqual(filterOffline(all, snapshot.feedFolders, { search: "nothing" }), []);
});

test("pages with limit and offset", () => {
  assert.deepEqual(ids(filterOffline(all, snapshot.feedFolders, { limit: 2, offset: 1 })), [3, 2]);
});
