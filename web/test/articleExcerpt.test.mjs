import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;

const { articleExcerpt } = await import("../src/utils/articleExcerpt.ts");

test("uses cached reader text before feed content or teaser", () => {
  assert.equal(articleExcerpt({
    full_content_html: "<p>Complete &amp; useful article.</p><script>bad()</script>",
    content_html: "<p>Short feed content.</p>",
    content_snippet: "Tiny teaser.",
  }), "Complete & useful article.");
});

test("uses feed content when no reader text is cached", () => {
  assert.equal(articleExcerpt({
    full_content_html: null,
    content_html: "<img src='photo.jpg'><p>First paragraph.</p><p>Second paragraph.</p>",
    content_snippet: "Short teaser.",
  }), "First paragraph. Second paragraph.");
});

test("falls back to teaser when available HTML has no text", () => {
  assert.equal(articleExcerpt({
    full_content_html: null,
    content_html: "<img src='photo.jpg'>",
    content_snippet: "  Short   teaser.  ",
  }), "Short teaser.");
});

test("keeps the teaser if feed HTML contains only a short caption", () => {
  assert.equal(articleExcerpt({
    full_content_html: null,
    content_html: "<p>Photo credit</p>",
    content_snippet: "A useful account of the whole story.",
  }), "A useful account of the whole story.");
});

test("keeps large article bodies out of card markup", () => {
  const excerpt = articleExcerpt({ full_content_html: `<p>${"word ".repeat(300)}</p>`, content_html: null, content_snippet: null });
  assert.ok(excerpt.length <= 651);
  assert.ok(excerpt.endsWith("…"));
});
