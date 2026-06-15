import assert from "node:assert/strict";
import { test } from "node:test";
import { parseListQuery } from "./list-query.ts";

test("parseListQuery reads search, multi-value filters, sort and pagination from the URL", () => {
  // q is trimmed; chips repeat a key; daterange is two keys; "-field" ⇒ desc sort.
  assert.deepEqual(
    parseListQuery("?q=  ada  &status=active&tag=oncall&tag=lead&joined_from=2026-01-01&sort=-last_active&page=3&pageSize=50"),
    {
      filters: { joined_from: ["2026-01-01"], status: ["active"], tag: ["oncall", "lead"] },
      page: 3,
      pageSize: 50,
      q: "ada",
      sort: { dir: "desc", field: "last_active" },
    },
  );
});

test("parseListQuery applies defaults, clamps, drops empties and accepts URL/URLSearchParams/string", () => {
  // Empty query → all defaults, never throws.
  assert.deepEqual(parseListQuery("?"), { filters: {}, page: 1, pageSize: 25, q: "", sort: null });

  // Empty values dropped (status, q); page<1 → 1; oversized pageSize clamped to max; bare sort ⇒ asc.
  assert.deepEqual(
    parseListQuery("status=&q=&page=0&pageSize=99999&sort=name"),
    { filters: {}, page: 1, pageSize: 100, q: "", sort: { dir: "asc", field: "name" } },
  );

  // A URL works (searchParams), multi-value preserved.
  assert.deepEqual(
    parseListQuery(new URL("http://x/users?team=engineering&team=design")),
    { filters: { team: ["engineering", "design"] }, page: 1, pageSize: 25, q: "", sort: null },
  );

  // URLSearchParams works; non-integer page/pageSize fall back to defaults; lone "-" sort ⇒ null.
  assert.deepEqual(
    parseListQuery(new URLSearchParams("page=abc&pageSize=-5&sort=-")),
    { filters: {}, page: 1, pageSize: 25, q: "", sort: null },
  );
});

test("parseListQuery honours custom reserved names and page-size bounds", () => {
  assert.deepEqual(
    parseListQuery("?search=hi&p=2&n=10&order=-x&status=active", {
      defaultPageSize: 20, maxPageSize: 50, pageParam: "p", pageSizeParam: "n", qParam: "search", sortParam: "order",
    }),
    { filters: { status: ["active"] }, page: 2, pageSize: 10, q: "hi", sort: { dir: "desc", field: "x" } },
  );

  // Custom n clamps to the custom max; the now-unreserved default names become plain filters.
  assert.equal(parseListQuery("?n=999", { maxPageSize: 50, pageSizeParam: "n" }).pageSize, 50);
  assert.deepEqual(parseListQuery("?q=hi", { qParam: "search" }).filters, { q: ["hi"] });
});
