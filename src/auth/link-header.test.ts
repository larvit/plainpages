import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPageToken } from "./link-header.ts";

test("nextPageToken reads the page_token of the rel=next entry among several", () => {
  const link = `</admin/identities?page_size=2&page_token=NEXT>; rel="next",</admin/identities?page_size=2>; rel="first"`;
  assert.equal(nextPageToken(link), "NEXT");
});

test("nextPageToken is null with no header, no next entry, or a next href without a page_token", () => {
  assert.equal(nextPageToken(null), null);
  assert.equal(nextPageToken(`</admin/clients?page_size=2>; rel="first"`), null);
  assert.equal(nextPageToken(`</admin/clients?page_size=2>; rel="next"`), null);
});
