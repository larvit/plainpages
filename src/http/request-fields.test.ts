import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { clientAddress, parseTrustedProxies, requestFields } from "./request-fields.ts";

const proxies = parseTrustedProxies(["10.0.0.0/8", "192.168.1.5", "fd00::/8"]);
const none = parseTrustedProxies([]);

test("clientAddress: the socket peer, unless the peer is a listed proxy", () => {
  assert.equal(clientAddress("203.0.113.9", "198.51.100.1", proxies), "203.0.113.9"); // header ignored from a stranger
  assert.equal(clientAddress("10.1.2.3", "198.51.100.1", proxies), "198.51.100.1");
  assert.equal(clientAddress("10.1.2.3", "198.51.100.1", none), "10.1.2.3"); // nothing trusted by default
  assert.equal(clientAddress("192.168.1.5", undefined, proxies), "192.168.1.5"); // trusted peer, no header
  assert.equal(clientAddress(undefined, "198.51.100.1", proxies), undefined);
});

test("clientAddress: walks the chain from the right, so a forged leftmost entry is not believed", () => {
  assert.equal(clientAddress("10.0.0.1", "6.6.6.6, 198.51.100.1, 10.0.0.2", proxies), "198.51.100.1");
  assert.equal(clientAddress("10.0.0.1", "10.0.0.7, 10.0.0.2", proxies), "10.0.0.7"); // every hop trusted → the origin
});

test("clientAddress: a malformed hop or a mapped IPv4 peer never yields garbage", () => {
  assert.equal(clientAddress("10.0.0.1", "not-an-ip", proxies), "10.0.0.1");
  assert.equal(clientAddress("::ffff:10.0.0.1", "198.51.100.1", proxies), "198.51.100.1");
  assert.equal(clientAddress("::ffff:203.0.113.9", undefined, none), "203.0.113.9");
  assert.equal(clientAddress("fd00::1", "2001:db8::7", proxies), "2001:db8::7");
});

test("parseTrustedProxies: a range covers exactly its prefix, and the extremes are legal", () => {
  const one = parseTrustedProxies(["10.1.2.3/32", "fd00::7/128", "192.168.0.0/16"]);
  assert.equal(clientAddress("10.1.2.3", "198.51.100.1", one), "198.51.100.1");
  assert.equal(clientAddress("10.1.2.4", "198.51.100.1", one), "10.1.2.4"); // /32 is one address
  assert.equal(clientAddress("fd00::8", "2001:db8::7", one), "fd00::8"); // /128 is one address
  assert.equal(clientAddress("192.168.255.1", "198.51.100.1", one), "198.51.100.1");
  assert.equal(clientAddress("192.169.0.1", "198.51.100.1", one), "192.169.0.1");
  assert.equal(clientAddress("203.0.113.9", "198.51.100.1", parseTrustedProxies(["0.0.0.0/0"])), "198.51.100.1"); // /0 is a choice, not a typo
});

test("clientAddress: a malformed hop left of a trusted one is not believed over the peer", () => {
  assert.equal(clientAddress("10.0.0.1", "garbage, 10.0.0.2", proxies), "10.0.0.1");
});

test("parseTrustedProxies: refuses an entry that is not an IP or a CIDR range", () => {
  for (const bad of ["proxy.internal", "10.0.0.0/33", "10.0.0.0/x", "::1/129", "", "10.0.0.1/", "10.0.0.0/ ", "fd00::1/", "10.0.0.0//8", "10.0.0.0/8/8", "10.0.0.0/-1", "10.0.0.0/1e1"]) {
    assert.throws(() => parseTrustedProxies([bad]), /TRUSTED_PROXIES/, bad);
  }
});

const request = (headers: Record<string, string>, remoteAddress = "203.0.113.9", url = "/a/b?token=secret", method = "POST") =>
  ({ headers, method, socket: { remoteAddress }, url }) as unknown as IncomingMessage;

test("requestFields: OpenTelemetry names for the caller, the site and the request, without the query", () => {
  const fields = requestFields(request({ host: "Example.com:8080", "user-agent": "TV/1.0" }), none);
  assert.deepEqual(fields, {
    "client.address": "203.0.113.9",
    "http.request.method": "POST",
    "server.address": "example.com",
    "url.path": "/a/b",
    "user_agent.original": "TV/1.0",
  });
});

test("requestFields: drops what the request lacks or sent malformed, and reads X-Forwarded-For only via a trusted peer", () => {
  assert.deepEqual(requestFields(request({ host: "bad host" }, "10.0.0.1", "/"), proxies), {
    "client.address": "10.0.0.1", "http.request.method": "POST", "url.path": "/",
  });
  const fields = requestFields(request({ "x-forwarded-for": "198.51.100.1" }, "10.0.0.1"), proxies);
  assert.equal(fields["client.address"], "198.51.100.1");
});
