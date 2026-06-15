import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const pagination = join(dirname(fileURLToPath(import.meta.url)), "..", "views", "partials", "pagination.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(pagination, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

const config = {
  summary: { from: "1", to: 12, total: "1,284" },
  rows: {
    name: "rows",
    value: 25, // active option
    options: [12, 25, 50, 100],
    hidden: [{ name: "q", value: "ada" }, { name: "status", value: "active" }], // list state carried forward
  },
  prev: {}, // first page → disabled (no href)
  pages: [
    { label: "1", current: true },
    { label: "2", href: "?sort=name&page=2" }, // & must be escaped
    { label: "3", href: "?page=3" },
    { ellipsis: true },
    { label: "107", href: "?page=107" },
  ],
  next: { href: "?page=2" },
};

test("pagination renders summary, rows-per-page form, page links, current, ellipsis and prev/next", async () => {
  const html = flat(await render(config));

  assert.match(html, /<footer class="pager"><span>1–12 of <b>1,284<\/b><\/span>/);

  // Rows-per-page: GET form carrying list state, active option selected, zero-JS submit.
  assert.match(html, /<form class="pager-rows" method="get"><input type="hidden" name="q" value="ada"><input type="hidden" name="status" value="active">/);
  assert.match(html, /<label for="pager-rows">Rows<\/label><span class="select"><select id="pager-rows" name="rows">/);
  assert.match(html, /<option value="12">12<\/option><option value="25" selected>25<\/option><option value="50">50<\/option><option value="100">100<\/option><\/select><\/span>/);
  assert.match(html, /<button class="page-btn" type="submit">Go<\/button><\/form>/);

  assert.match(html, /<div class="spacer"><\/div><nav class="page-nums" aria-label="Pagination">/);

  // Prev disabled at the first page.
  assert.match(html, /<button class="page-btn" type="button" disabled aria-label="Previous page"><svg class="ico ico-sm" style="transform:rotate\(180deg\)"><use href="#i-chev"\s*\/?><\/svg><\/button>/);

  // Page items: current as inert span, links for the rest (& escaped), ellipsis hidden from SR.
  assert.match(html, /<span class="page-btn" aria-current="page">1<\/span>/);
  assert.match(html, /<a class="page-btn" href="\?sort=name&amp;page=2">2<\/a>/);
  assert.match(html, /<a class="page-btn" href="\?page=3">3<\/a>/);
  assert.match(html, /<span class="page-btn" aria-hidden="true">…<\/span>/);
  assert.match(html, /<a class="page-btn" href="\?page=107">107<\/a>/);

  // Next is a link when a target exists.
  assert.match(html, /<a class="page-btn" href="\?page=2" aria-label="Next page"><svg class="ico ico-sm"><use href="#i-chev"\s*\/?><\/svg><\/a><\/nav><\/footer>/);
});

test("pagination renders a valid empty footer and never throws on missing config", async () => {
  const expected = /<footer class="pager"><div class="spacer"><\/div><nav class="page-nums" aria-label="Pagination"><\/nav><\/footer>/;
  assert.match(flat(await render()), expected);
  assert.match(flat(await render({})), expected);

  // Object options + custom labels; value coercion (number vs string) still selects.
  const html = flat(await render({
    rows: { name: "rows", value: "50", options: [{ value: 50, label: "50 / page" }], label: "Per page", submitLabel: "Set" },
  }));
  assert.match(html, /<label for="pager-rows">Per page<\/label>/);
  assert.match(html, /<option value="50" selected>50 \/ page<\/option>/);
  assert.match(html, /<button class="page-btn" type="submit">Set<\/button>/);
});
