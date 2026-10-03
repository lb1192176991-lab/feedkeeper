import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Resvg } from "@resvg/resvg-js";

const PNG = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>').render().asPng();
const ICO = Buffer.alloc(22 + PNG.length);
ICO.writeUInt16LE(1, 2);
ICO.writeUInt16LE(1, 4);
ICO[6] = 16;
ICO[7] = 16;
ICO.writeUInt16LE(1, 10);
ICO.writeUInt16LE(32, 12);
ICO.writeUInt32LE(PNG.length, 14);
ICO.writeUInt32LE(22, 18);
PNG.copy(ICO, 22);

test("feed icons are served through this server to people who may see the feed", async () => {
  let svgColor = "red";
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    switch (req.url) {
      case "/feed.xml":
        if (req.headers["if-none-match"]) return res.writeHead(304).end();
        return res.writeHead(200, { "content-type": "application/rss+xml" }).end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Icons</title><link>${host}/</link><item><guid>a</guid><title>One</title></item></channel></rss>`);
      case "/": return res.writeHead(200, { "content-type": "text/html" }).end('<html><head><link rel="icon" href="/declared.svg"></head></html>');
      case "/declared.svg": return res.writeHead(200, { "content-type": "image/svg+xml" }).end(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${svgColor}"/></svg>`);
      case "/favicon.ico": return res.writeHead(200, { "content-type": "image/x-icon" }).end(ICO);
      case "/page.html": return res.writeHead(200, { "content-type": "text/html" }).end("<html>not an icon</html>");
      default: return res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const { canAccessFeed, getFeedIconHash, loadFeedIcon } = await import("../src/feeds/feedIcon.js");
  const { findFeedById } = await import("../src/feeds/repository.js");
  const { pollFeed } = await import("../src/feeds/poller.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("icon-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("icon-other@example.test", "Other").lastInsertRowid);

  try {
    const feed = await subscribeToFeed(ownerId, `${base}/feed.xml`);
    assert.equal(canAccessFeed(ownerId, feed.id), true);
    assert.equal(canAccessFeed(otherId, feed.id), false);

    // The icon the site declares wins; SVG is converted to PNG.
    db.prepare("UPDATE feeds SET icon_url = ? WHERE id = ?").run(`${base}/declared.svg`, feed.id);
    assert.equal((await loadFeedIcon(feed.id))?.mime, "image/png");

    // A feed 304 still rechecks the icon when its weekly check is due.
    const previousHash = getFeedIconHash(feed.id);
    svgColor = "blue";
    db.prepare("UPDATE feeds SET etag = 'old-etag', icon_checked_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(feed.id);
    assert.equal((await pollFeed(findFeedById(feed.id)!)).error, null);
    assert.notEqual(getFeedIconHash(feed.id), previousHash);

    // Otherwise /favicon.ico is tried; things that are not images are never served.
    db.prepare("UPDATE feeds SET icon_url = ? WHERE id = ?").run(`${base}/page.html`, feed.id);
    (await import("../src/feeds/feedIcon.js")).clearIconCache();
    assert.equal((await loadFeedIcon(feed.id))?.mime, "image/png");
    assert.deepEqual((await loadFeedIcon(feed.id))?.buffer, PNG);
  } finally {
    server.close();
  }
});
