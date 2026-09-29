import assert from "node:assert/strict";
import { test } from "node:test";
import { squareCrop } from "../src/utils/avatarImage.ts";

test("profile photos are cropped to a centered square", () => {
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, size: 300 });
  assert.deepEqual(squareCrop(300, 500), { sx: 0, sy: 100, size: 300 });
  assert.deepEqual(squareCrop(256, 256), { sx: 0, sy: 0, size: 256 });
});
