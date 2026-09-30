import assert from "node:assert/strict";
import { test } from "node:test";
import { pickIconUrl } from "../src/feeds/icon.js";

test("declared site icons are preferred by size, with touch icons as fallback", () => {
  const futurezone = `<head>
    <link rel="icon" href="https://www.futurezone.de/wp-content/uploads/FZ.png?w=32" sizes="32x32" />
    <link rel="icon" href="https://www.futurezone.de/wp-content/uploads/FZ.png?w=192" sizes="192x192" />
    <link rel="apple-touch-icon" href="https://www.futurezone.de/wp-content/uploads/FZ.png?w=180" />
  </head>`;
  assert.equal(pickIconUrl(futurezone, "https://www.futurezone.de/"), "https://www.futurezone.de/wp-content/uploads/FZ.png?w=32");

  assert.equal(pickIconUrl(`<link rel='shortcut icon' href='/static/fav.ico'>`, "https://example.test/blog/"), "https://example.test/static/fav.ico");
  assert.equal(pickIconUrl(`<link rel="apple-touch-icon" href="touch.png"><link rel="mask-icon" href="mask.svg">`, "https://example.test/"), "https://example.test/touch.png");
  assert.equal(pickIconUrl(`<link rel="icon" href="javascript:alert(1)">`, "https://example.test/"), null);
  assert.equal(pickIconUrl(`<head></head><body><link rel="icon" href="/late.png"></body>`, "https://example.test/"), null);
  assert.equal(pickIconUrl(`<link rel="stylesheet" href="/app.css">`, "https://example.test/"), null);
});
