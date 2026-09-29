import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://example.com/items" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let coarsePointer = true;
window.matchMedia = (query) => ({ matches: query === "(any-pointer: coarse)" && coarsePointer });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: i18n } = await import("i18next");
const { initReactI18next } = await import("react-i18next");
const { PullToRefresh } = await import("../src/components/PullToRefresh.tsx");
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: { items: { refresh: "Refresh", refreshing: "Refreshing" } } } } });

function touch(target, type, x, y) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
  return event;
}

test("pull refreshes once on tablet touchscreens after crossing the threshold", async () => {
  window.innerWidth = 1366;
  let calls = 0;
  let finishRefresh;
  const root = createRoot(document.getElementById("root"));
  await React.act(async () => {
    root.render(React.createElement(PullToRefresh, {
      onRefresh: () => { calls++; return new Promise((resolve) => { finishRefresh = resolve; }); },
    }, React.createElement("div", { id: "content" }, "Articles")));
  });
  const content = document.getElementById("content");

  window.scrollY = 100;
  await React.act(async () => {
    touch(content, "touchstart", 50, 100);
    touch(content, "touchmove", 50, 220);
    touch(content, "touchend", 50, 220);
  });
  assert.equal(calls, 0);

  window.scrollY = 0;
  await React.act(async () => {
    touch(content, "touchstart", 50, 100);
    touch(content, "touchmove", 50, 160);
    touch(content, "touchend", 50, 160);
  });
  assert.equal(calls, 0);

  await React.act(async () => {
    touch(content, "touchstart", 50, 100);
    touch(content, "touchmove", 50, 220);
    touch(content, "touchmove", 50, 95);
    touch(content, "touchend", 50, 95);
  });
  assert.equal(calls, 0);

  await React.act(async () => {
    touch(content, "touchstart", 50, 100);
    const move = touch(content, "touchmove", 50, 220);
    assert.equal(move.defaultPrevented, true);
    touch(content, "touchend", 50, 220);
  });
  assert.equal(calls, 1);
  assert.ok(document.querySelector('[role="status"]'));

  await React.act(async () => {
    touch(content, "touchstart", 50, 100);
    touch(content, "touchmove", 50, 220);
    touch(content, "touchend", 50, 220);
  });
  assert.equal(calls, 1);

  await React.act(async () => finishRefresh());
  assert.equal(document.querySelector('[role="status"]'), null);

  coarsePointer = false;
  await React.act(async () => {
    touch(content, "touchstart", 50, 100);
    touch(content, "touchmove", 50, 220);
    touch(content, "touchend", 50, 220);
  });
  assert.equal(calls, 1);

  await React.act(async () => root.unmount());
});
