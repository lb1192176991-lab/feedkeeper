import assert from "node:assert/strict";
import { test } from "node:test";
import { editorialCompanions, editorialFeatures } from "../src/utils/editorialLayout.ts";

const image = { image_url: "https://example.com/photo.jpg", content_snippet: null };
const short = { image_url: null, content_snippet: "Brief item" };
const long = { image_url: null, content_snippet: "Article context. ".repeat(20) };

test("features only substantial stories and retains article order", () => {
  assert.deepEqual(editorialFeatures([short, image, image, short, long, image, short, image]),
    [false, true, false, false, false, false, false, false]);
});

test("a feature never leaves an empty desktop grid column", () => {
  assert.deepEqual(editorialFeatures([short, short, image, short, short, long, long]),
    [false, false, false, false, false, false, true]);
});

test("adding a page does not change earlier placements", () => {
  const firstPage = [image, short, long, image, short, image];
  assert.deepEqual(editorialFeatures([...firstPage, ...firstPage]).slice(0, firstPage.length), editorialFeatures(firstPage));
});

test("missing and unsafe images use text-only layout", () => {
  assert.deepEqual(editorialFeatures([{ image_url: "javascript:bad", content_snippet: "" }]), [false]);
  assert.deepEqual(editorialFeatures([long]), [true]);
});

test("regular cards beside a featured article can show a longer excerpt", () => {
  assert.deepEqual(editorialCompanions([true, false, false, true, false]),
    [false, true, true, false, false]);
});
