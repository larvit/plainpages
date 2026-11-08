import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaginationModel, paginate, type PageModel } from "./paginate.ts";

// Compact view of the page sequence: ellipsis → "…", current → "[n]", else the number.
const shape = (m: PageModel): (number | string | null)[] =>
  m.pages.map((p) => (p.ellipsis ? "…" : p.current ? `[${p.page}]` : p.page));

test("paginate computes the page model: counts, row window, prev/next, page sequence", () => {
  const m = paginate(1284, 3, 12);
  assert.deepEqual(
    { from: m.from, next: m.next, page: m.page, pageCount: m.pageCount, pageSize: m.pageSize, prev: m.prev, to: m.to, total: m.total },
    { from: 25, next: 4, page: 3, pageCount: 107, pageSize: 12, prev: 2, to: 36, total: 1284 },
  );
  assert.deepEqual(shape(m), [1, 2, "[3]", 4, "…", 107]);
});

test("paginate clamps out-of-range input, handles the empty list and guards sizes", () => {
  // Page past the end clamps to the last page; no next.
  const last = paginate(50, 99, 25);
  assert.deepEqual([last.page, last.pageCount, last.from, last.to, last.prev, last.next], [2, 2, 26, 50, 1, null]);
  assert.deepEqual(shape(last), [1, "[2]"]);

  // Empty list → one empty page, row window 0–0, no prev/next.
  const empty = paginate(0, 1, 25);
  assert.deepEqual([empty.page, empty.pageCount, empty.from, empty.to, empty.prev, empty.next], [1, 1, 0, 0, null, null]);
  assert.deepEqual(shape(empty), ["[1]"]);

  // page < 1 → 1; pageSize < 1 coerces to 1; non-finite page → 1.
  assert.equal(paginate(50, 0, 25).page, 1);
  assert.equal(paginate(10, 1, 0).pageCount, 10);
  assert.equal(paginate(50, Number.NaN, 25).page, 1);
});

test("paginate windows the sequence: single gaps fill, wider gaps ellipsize, siblings/boundaries tune it", () => {
  // A one-page gap is filled, never collapsed to an ellipsis.
  assert.deepEqual(shape(paginate(70, 4, 10)), [1, 2, 3, "[4]", 5, 6, 7]);
  // Gaps on both sides → an ellipsis each side.
  assert.deepEqual(shape(paginate(200, 10, 10)), [1, "…", 9, "[10]", 11, "…", 20]);
  // Wider sibling window and more boundary pages.
  assert.deepEqual(shape(paginate(200, 10, 10, { siblings: 2 })), [1, "…", 8, 9, "[10]", 11, 12, "…", 20]);
  assert.deepEqual(shape(paginate(200, 10, 10, { boundaries: 2 })), [1, 2, "…", 9, "[10]", 11, "…", 19, 20]);
});

test("buildPaginationModel maps a page to the pagination partial's model, every href from hrefFor", () => {
  const hrefFor = (n: number): string => `/users?q=ann&sort=-name${n > 1 ? `&page=${n}` : ""}`;
  assert.deepEqual(buildPaginationModel(paginate(100, 2, 25), hrefFor, { label: "User pages", pageSizes: [25, 50] }), {
    label: "User pages",
    next: { href: "/users?q=ann&sort=-name&page=3" },
    pages: [
      { href: "/users?q=ann&sort=-name", label: "1" },
      { current: true, label: "2" },
      { href: "/users?q=ann&sort=-name&page=3", label: "3" },
      { href: "/users?q=ann&sort=-name&page=4", label: "4" },
    ],
    prev: { href: "/users?q=ann&sort=-name" },
    rows: { hidden: [{ name: "q", value: "ann" }, { name: "sort", value: "-name" }], name: "pageSize", options: [25, 50], value: 25 },
    summary: { from: 26, to: 50, total: 100 },
  });
});

test("buildPaginationModel leaves prev/next without an href on the first/last page, keeps ellipses, and omits what wasn't asked for", () => {
  const m = buildPaginationModel(paginate(100, 1, 10), (n) => `/l?page=${n}`);
  assert.deepEqual(m.prev, {});
  assert.deepEqual(m.pages[m.pages.length - 2], { ellipsis: true });
  assert.equal("label" in m, false);
  assert.equal("rows" in m, false);
  assert.deepEqual(buildPaginationModel(paginate(100, 10, 10), (n) => `/l?page=${n}`).next, {});
});

test("buildPaginationModel's rows form carries the links' list state, minus page, page size and locale", () => {
  const m = buildPaginationModel(paginate(10, 1, 50), () => "/l?status=active&status=locked&page=2&pageSize=50&locale=sv-SE", { pageSizes: [50] });
  assert.deepEqual(m.rows?.hidden, [{ name: "status", value: "active" }, { name: "status", value: "locked" }]);
});

test("buildPaginationModel follows renamed page and page-size params, as parseListQuery takes them", () => {
  const m = buildPaginationModel(paginate(10, 1, 5), () => "/l?q=x&p=2&size=5", { pageParam: "p", pageSizeParam: "size", pageSizes: [5] });
  assert.deepEqual(m.rows, { hidden: [{ name: "q", value: "x" }], name: "size", options: [5], value: 5 });
});
