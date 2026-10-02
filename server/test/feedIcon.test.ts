import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("feed icons are served through this server to people who may see the feed", async () => {
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    switch (req.url) {
      case "/feed.xml":
        return res.writeHead(200, { "content-type": "application/rss+xml" }).end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Icons</title><link>${host}/</link><item><guid>a</guid><title>One</title></item></channel></rss>`);
      case "/declared.svg": return res.writeHead(200, { "content-type": "image/svg+xml" }).end(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`);
      case "/favicon.ico": return res.writeHead(200, { "content-type": "image/x-icon" }).end(Buffer.from([0, 0, 1, 0, 1, 0]));
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
  const { canAccessFeed, loadFeedIcon } = await import("../src/feeds/feedIcon.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("icon-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("icon-other@example.test", "Other").lastInsertRowid);

  try {
    const feed = await subscribeToFeed(ownerId, `${base}/feed.xml`);
    assert.equal(canAccessFeed(ownerId, feed.id), true);
    assert.equal(canAccessFeed(otherId, feed.id), false);

    // The icon the site declares wins; SVG is accepted for icons.
    db.prepare("UPDATE feeds SET icon_url = ? WHERE id = ?").run(`${base}/declared.svg`, feed.id);
    assert.equal((await loadFeedIcon(feed.id))?.mime, "image/svg+xml");

    // Otherwise /favicon.ico is tried; things that are not images are never served.
    db.prepare("UPDATE feeds SET icon_url = ? WHERE id = ?").run(`${base}/page.html`, feed.id);
    (await import("../src/feeds/feedIcon.js")).clearIconCache();
    assert.equal((await loadFeedIcon(feed.id))?.mime, "image/x-icon");
    assert.equal(PNG.length > 0, true);
  } finally {
    server.close();
  }
});
