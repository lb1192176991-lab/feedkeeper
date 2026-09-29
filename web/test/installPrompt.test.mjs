import assert from "node:assert/strict";
import { test } from "node:test";
import { installMode } from "../src/utils/installPrompt.ts";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const macChrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const macFirefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0";
const env = (userAgent, overrides = {}) => ({ standalone: false, hasPrompt: false, userAgent, maxTouchPoints: 0, ...overrides });

test("an installed app offers no install entry", () => {
  assert.equal(installMode(env(iphone, { standalone: true, hasPrompt: true })), "installed");
});

test("a captured browser prompt takes precedence", () => {
  assert.equal(installMode(env(macChrome, { hasPrompt: true })), "prompt");
});

test("iPhone and iPad get home screen instructions", () => {
  assert.equal(installMode(env(iphone, { maxTouchPoints: 5 })), "ios");
  assert.equal(installMode(env(ipad, { maxTouchPoints: 5 })), "ios");
});

test("desktop Safari gets dock instructions, other browsers without a prompt get nothing", () => {
  assert.equal(installMode(env(ipad)), "mac-safari");
  assert.equal(installMode(env(macChrome)), "unsupported");
  assert.equal(installMode(env(macFirefox)), "unsupported");
});
