import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCookies, serializeCookie } from "./cookie.ts";

// parseCookies returns a null-prototype map; spread into a plain object to deep-equal.
const flat = (header: string | undefined): Record<string, string> => ({ ...parseCookies(header) });

test("parseCookies returns an empty object for an absent or empty header", () => {
  assert.deepEqual(flat(undefined), {});
  assert.deepEqual(flat(""), {});
});

test("parseCookies splits pairs and trims surrounding whitespace", () => {
  assert.deepEqual(flat("a=1; b=2"), { a: "1", b: "2" });
  assert.deepEqual(flat("  a = 1 ;b= 2"), { a: "1", b: "2" });
});

test("parseCookies keeps `=` inside the value (base64/JWT-like tokens)", () => {
  assert.deepEqual(flat("t=ey.Jh=="), { t: "ey.Jh==" });
});

test("parseCookies decodes percent-encoded values, raw on malformed", () => {
  assert.equal(parseCookies("a=one%20two").a, "one two");
  assert.equal(parseCookies("a=%E0%A4%A").a, "%E0%A4%A"); // invalid escape → untouched, no throw
});

test("parseCookies strips one layer of surrounding double-quotes", () => {
  assert.equal(parseCookies('a="quoted"').a, "quoted");
});

test("parseCookies skips pairs without a name or `=`", () => {
  assert.deepEqual(flat("novalue; =orphan; a=1"), { a: "1" });
});

test("parseCookies keeps the first occurrence of a duplicate name", () => {
  assert.equal(parseCookies("a=first; a=second").a, "first");
});

test("parseCookies is not vulnerable to prototype pollution", () => {
  const parsed = parseCookies("__proto__=polluted; a=1");
  assert.equal(Object.getPrototypeOf(parsed), null); // null-prototype map
  assert.equal(parsed["__proto__"], "polluted"); // stored as a plain own key, not the prototype
  assert.equal(parsed.a, "1");
  assert.equal(Object.getPrototypeOf({}), Object.prototype); // global prototype untouched
});

test("serializeCookie emits a bare name=value, encoding the value", () => {
  assert.equal(serializeCookie("session", "abc"), "session=abc");
  assert.equal(serializeCookie("session", "a b&c"), "session=a%20b%26c");
});

test("serializeCookie leaves JWT characters (-_.) readable", () => {
  assert.equal(serializeCookie("session", "ab-_.cd"), "session=ab-_.cd");
});

test("serializeCookie appends the secure-by-default attribute flags", () => {
  const out = serializeCookie("session", "x", { httpOnly: true, path: "/", sameSite: "Lax", secure: true });
  assert.equal(out, "session=x; Path=/; HttpOnly; SameSite=Lax; Secure");
});

test("serializeCookie writes Max-Age and rejects a non-integer", () => {
  assert.match(serializeCookie("a", "1", { maxAge: 600 }), /; Max-Age=600(;|$)/);
  assert.match(serializeCookie("a", "1", { maxAge: 0 }), /; Max-Age=0(;|$)/);
  assert.throws(() => serializeCookie("a", "1", { maxAge: 1.5 }), /integer/);
});

test("serializeCookie writes Expires from a Date and rejects an invalid one", () => {
  assert.match(serializeCookie("a", "1", { expires: new Date(0) }), /; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.throws(() => serializeCookie("a", "1", { expires: new Date("nope") }), /Expires/);
});

test("serializeCookie rejects an Expires year outside the 4-digit RFC range", () => {
  // toUTCString() of a year > 9999 yields a 6-digit year browsers may reject — fail loud instead.
  assert.throws(() => serializeCookie("a", "1", { expires: new Date(8640000000000000) }), /Expires/);
});

test("serializeCookie writes Domain and Path", () => {
  const out = serializeCookie("a", "1", { domain: "example.com", path: "/admin" });
  assert.match(out, /; Domain=example\.com/);
  assert.match(out, /; Path=\/admin/);
});

test("serializeCookie rejects an empty Domain or Path (misconfigured deploy)", () => {
  assert.throws(() => serializeCookie("a", "1", { domain: "" }), /domain/);
  assert.throws(() => serializeCookie("a", "1", { path: "" }), /path/);
});

test("serializeCookie allows a non-positive Max-Age (expire immediately, by design)", () => {
  assert.match(serializeCookie("a", "1", { maxAge: -1 }), /; Max-Age=-1(;|$)/);
});

test("serializeCookie rejects SameSite=None without Secure (browsers would drop it)", () => {
  assert.throws(() => serializeCookie("a", "1", { sameSite: "None" }), /Secure/);
  assert.doesNotThrow(() => serializeCookie("a", "1", { sameSite: "None", secure: true }));
});

test("serializeCookie rejects an invalid cookie name", () => {
  assert.throws(() => serializeCookie("bad name", "1"), /name/);
  assert.throws(() => serializeCookie("a;b", "1"), /name/);
});

test("serializeCookie rejects attribute values that could inject extra attributes", () => {
  assert.throws(() => serializeCookie("a", "1", { path: "/x; Domain=evil.com" }), /path/);
  assert.throws(() => serializeCookie("a", "1", { domain: "evil\r\nSet-Cookie: x=y" }), /domain/);
});

test("serializeCookie and parseCookies round-trip an arbitrary value", () => {
  const value = "header.payload.sig with spaces & symbols=";
  const setCookie = serializeCookie("session", value, { httpOnly: true });
  const cookieHeader = setCookie.split("; ")[0]; // browsers send only name=value
  assert.equal(parseCookies(cookieHeader).session, value);
});
