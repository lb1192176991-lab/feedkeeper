import assert from "node:assert/strict";
import { test } from "node:test";
import { pickIconUrl, pickIconUrls } from "../src/feeds/icon.js";

test("declared site icons prefer high-resolution artwork, including touch icons", () => {
  const futurezone = `<head>
    <link rel="icon" href="https://www.futurezone.de/wp-content/uploads/FZ.png?w=32" sizes="32x32" />
    <link rel="icon" href="https://www.futurezone.de/wp-content/uploads/FZ.png?w=192" sizes="192x192" />
    <link rel="apple-touch-icon" href="https://www.futurezone.de/wp-content/uploads/FZ.png?w=180" />
  </head>`;
  assert.deepEqual(pickIconUrls(futurezone, "https://www.futurezone.de/"), [
    "https://www.futurezone.de/wp-content/uploads/FZ.png?w=192",
    "https://www.futurezone.de/wp-content/uploads/FZ.png?w=180",
    "https://www.futurezone.de/wp-content/uploads/FZ.png?w=32",
  ]);

  assert.equal(pickIconUrl(`<link rel='shortcut icon' href='/static/fav.ico'>`, "https://example.test/blog/"), "https://example.test/static/fav.ico");
  assert.equal(pickIconUrl(`<link rel="apple-touch-icon" href="touch.png"><link rel="mask-icon" href="mask.svg">`, "https://example.test/"), "https://example.test/touch.png");
  assert.equal(pickIconUrl(`<link rel="icon" href="javascript:alert(1)">`, "https://example.test/"), null);
  assert.equal(pickIconUrl(`<head></head><body><link rel="icon" href="/late.png"></body>`, "https://example.test/"), null);
  assert.equal(pickIconUrl(`<link rel="stylesheet" href="/app.css">`, "https://example.test/"), null);
});

test("scalable icons win, all declared dimensions count, and URLs are decoded and deduplicated", () => {
  const html = `<head>
    <link rel="icon" href="/tiny.png" sizes="16x16">
    <link rel="apple-touch-icon" href="/touch.png" sizes="512x512">
    <link rel="icon" href="/multi.png?a=1&amp;b=2" sizes="32x32 1024x1024">
    <link rel="icon" href="/wide.png" sizes="2048x16">
    <link rel="icon" href="/vector" type="image/svg+xml" sizes="any">
    <link rel="icon" href="/vector" type="image/svg+xml">
    <link rel="mask-icon" href="/mask.svg">
    <link rel="icon" href="data:image/png;base64,bad">
  </head>`;
  assert.deepEqual(pickIconUrls(html, "https://example.test/"), [
    "https://example.test/vector",
    "https://example.test/multi.png?a=1&b=2",
    "https://example.test/touch.png",
    "https://example.test/tiny.png",
    "https://example.test/wide.png",
  ]);
  assert.equal(pickIconUrl('<link rel="icon" href="/small.png" sizes="32x32"><link rel="apple-touch-icon" href="/touch.png">', "https://example.test/"), "https://example.test/touch.png");
});
