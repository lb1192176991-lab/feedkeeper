import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { parseTrustProxy, type TrustProxySetting } from "../src/trustProxy.js";

test("TRUST_PROXY keeps its boolean meaning and accepts hop counts and proxy lists", () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("true"), 1);
  assert.equal(parseTrustProxy("2"), 2);
  assert.deepEqual(parseTrustProxy(" uniquelocal, 173.245.48.0/20 ,2400:cb00::/32,"), ["uniquelocal", "173.245.48.0/20", "2400:cb00::/32"]);
});

async function clientAddress(setting: TrustProxySetting, forwardedFor: string): Promise<string | undefined> {
  const app = express();
  app.set("trust proxy", setting);
  app.get("/", (req, res) => { res.json({ ip: req.ip }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, { headers: { "X-Forwarded-For": forwardedFor } });
    return (await response.json() as { ip?: string }).ip;
  } finally {
    server.close();
  }
}

test("a proxy list finds the client behind a CDN and ignores forged addresses", async () => {
  // The local web server (loopback here) forwards what the CDN (203.0.113.0/24) reported.
  const chain = ["loopback", "203.0.113.0/24"];
  assert.equal(await clientAddress(chain, "198.51.100.7, 203.0.113.5"), "198.51.100.7");
  // A client that bypasses the CDN cannot choose its address by sending its own header.
  assert.equal(await clientAddress(chain, "192.0.2.1, 198.51.100.9"), "198.51.100.9");
  // One trusted hop treats the CDN edge as the client, which is why lists exist.
  assert.equal(await clientAddress(1, "198.51.100.7, 203.0.113.5"), "203.0.113.5");
});

test("an invalid proxy address is rejected when the setting is applied", () => {
  assert.throws(() => express().set("trust proxy", parseTrustProxy("uniquelocal,not-an-address")));
});
