import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const locales = ["en", "de", "ja"];
const load = (code) => JSON.parse(readFileSync(new URL(`../src/i18n/locales/${code}.json`, import.meta.url), "utf8"));

function keysOf(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object" ? keysOf(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

const reference = new Set(keysOf(load("en")));

for (const code of locales.filter((code) => code !== "en")) {
  test(`${code} has the same text keys as en`, () => {
    const keys = new Set(keysOf(load(code)));
    assert.deepEqual([...reference].filter((key) => !keys.has(key)), [], `missing in ${code}.json`);
    assert.deepEqual([...keys].filter((key) => !reference.has(key)), [], `unknown in ${code}.json`);
  });
}
