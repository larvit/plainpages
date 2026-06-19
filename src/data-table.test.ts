import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const dataTable = join(dirname(fileURLToPath(import.meta.url)), "..", "views", "partials", "data-table.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(dataTable, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

const config = {
  caption: "People in the directory",
  selectable: true,
  actions: true,
  columns: [
    { label: "Name", sortable: true, sort: "asc", href: "?sort=name&dir=desc" }, // active ascending
    { label: "Email", sortable: true, href: "?sort=email&dir=asc" }, // sortable, inactive
    { label: "Team" }, // not sortable
    { label: "Status" },
    { label: "Detail" },
  ],
  rows: [
    {
      name: "Mara Delgado",
      cells: [
        { user: { name: "Mara Delgado", initials: "MD" } },
        { text: "mara@x.io", className: "cell-muted cell-mono" },
        { text: "Engineering", className: "cell-muted" },
        { badge: { tone: "pos", label: "Active" } },
        { html: '<a href="/x">open</a>' },
      ],
      actions: [
        { label: "Edit", icon: "i-edit", href: "/people/1/edit" },
        { label: "Delete", icon: "i-trash", danger: true, separatorBefore: true },
      ],
    },
  ],
};

test("data-table renders sortable headers, row-select, typed cells, badges and kebab actions", async () => {
  const html = flat(await render(config));

  assert.match(html, /<div class="table-wrap"><table class="table"><caption class="sr-only">People in the directory<\/caption>/);

  // Row-select: header select-all + per-row checkbox with a descriptive label.
  assert.match(html, /<th class="col-check" scope="col"><input type="checkbox" aria-label="Select all rows"><\/th>/);
  assert.match(html, /<td class="col-check"><input type="checkbox" class="row-select" aria-label="Select Mara Delgado"><\/td>/);

  // Sortable header — active ascending: aria-sort + link + up icon (& escaped in href).
  assert.match(html, /<th scope="col" aria-sort="ascending"><a class="th-sort" href="\?sort=name&amp;dir=desc">Name <svg class="ico ico-sm sort-ico"><use href="#i-up"\s*\/?><\/svg><\/a><\/th>/);
  // Sortable header — inactive: no aria-sort, neutral sort icon.
  assert.match(html, /<th scope="col"><a class="th-sort" href="\?sort=email&amp;dir=asc">Email <svg class="ico ico-sm sort-ico"><use href="#i-sort"\s*\/?><\/svg><\/a><\/th>/);
  // Non-sortable header — plain text, no button/link.
  assert.match(html, /<th scope="col">Team<\/th>/);
  // Actions header.
  assert.match(html, /<th class="col-actions" scope="col"><span class="sr-only">Actions<\/span><\/th>/);

  // Typed cells: user identifies the row → <th scope="row">; classed text, badge tone, raw html.
  assert.match(html, /<th scope="row"><span class="cell-user"><span class="avatar" aria-hidden="true">MD<\/span><span class="cell-strong">Mara Delgado<\/span><\/span><\/th>/);
  assert.match(html, /<td class="cell-muted cell-mono">mara@x.io<\/td>/);
  assert.match(html, /<td class="cell-muted">Engineering<\/td>/);
  assert.match(html, /<td><span class="badge pos"><span class="dot"><\/span>Active<\/span><\/td>/);
  assert.match(html, /<td><a href="\/x">open<\/a><\/td>/);

  // Kebab row actions: link item, danger button, separator.
  assert.match(html, /<td class="col-actions"><details class="menu kebab"><summary aria-label="Row actions for Mara Delgado"><svg class="ico ico-sm"><use href="#i-kebab"\s*\/?><\/svg><\/summary><div class="menu-pop">/);
  assert.match(html, /<a class="menu-item" href="\/people\/1\/edit"><svg class="ico"><use href="#i-edit"\s*\/?><\/svg>Edit<\/a>/);
  assert.match(html, /<div class="menu-sep"><\/div><button class="menu-item danger" type="button"><svg class="ico"><use href="#i-trash"\s*\/?><\/svg>Delete<\/button>/);
});

test("data-table rowHeader cell is a <th scope=row> identifier — a link when given href, else plain text", async () => {
  const linked = flat(await render({ columns: [{ label: "Group" }], rows: [{ cells: [{ rowHeader: { href: "/admin/groups/eng", text: "eng" } }] }] }));
  assert.match(linked, /<th scope="row"><a class="cell-strong" href="\/admin\/groups\/eng">eng<\/a><\/th>/);
  const plain = flat(await render({ columns: [{ label: "Group" }], rows: [{ cells: [{ rowHeader: { text: "eng" } }] }] }));
  assert.match(plain, /<th scope="row"><span class="cell-strong">eng<\/span><\/th>/);
});

test("data-table renders a minimal table (plain string cells, no select/actions) and never throws", async () => {
  const html = flat(await render({ columns: [{ label: "Name" }], rows: [{ cells: ["Plain"] }] }));
  assert.match(html, /<table class="table"><thead><tr><th scope="col">Name<\/th><\/tr><\/thead><tbody><tr><td>Plain<\/td><\/tr><\/tbody><\/table>/);
  assert.doesNotMatch(html, /col-check|col-actions/);

  assert.match(flat(await render()), /<table class="table"><thead><tr><\/tr><\/thead><tbody><\/tbody><\/table>/);
});

test("data-table shows an empty-state row spanning all columns when there are no rows", async () => {
  // colspan covers the data columns + the select + actions columns (2 + 1 + 1 = 4).
  const html = flat(await render({ actions: true, columns: [{ label: "Name" }, { label: "Email" }], rows: [], selectable: true }));
  assert.match(html, /<tbody><tr><td class="table-empty" colspan="4">Nothing here yet\.<\/td><\/tr><\/tbody>/);

  // a caller-supplied message overrides the default
  assert.match(flat(await render({ columns: [{ label: "Shift" }], emptyText: "No shifts yet.", rows: [] })), /<td class="table-empty" colspan="1">No shifts yet\.<\/td>/);

  // a populated table has no empty-state row
  assert.doesNotMatch(flat(await render({ columns: [{ label: "Name" }], rows: [{ cells: ["A"] }] })), /table-empty/);
});
