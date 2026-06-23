import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate, type PageModel } from "./paginate.ts";

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
