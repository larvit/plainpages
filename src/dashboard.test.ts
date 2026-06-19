import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardModel } from "./dashboard.ts";

// Pull the first data-table column ("Name") and the rendered row count for terse assertions.
const rowCount = (m: ReturnType<typeof buildDashboardModel>): number => m.table.rows.length;
const nameOf = (m: ReturnType<typeof buildDashboardModel>, i: number): string =>
  // first cell is the user cell { user: { name } }
  ((m.table.rows[i] as { cells: unknown[] }).cells[0] as { user: { name: string } }).user.name;
const col0 = (m: ReturnType<typeof buildDashboardModel>) =>
  m.table.columns[0] as { href?: string; label: string; sort?: string };

test("dashboard default: page 1, mock data, nav + shell wired", () => {
  const m = buildDashboardModel(new URL("http://x/"));

  assert.equal(m.shell.title, "People");
  assert.equal(m.shell.csrfToken, ""); // default empty; app.ts passes the per-request token
  assert.equal(buildDashboardModel(new URL("http://x/"), [], undefined, "tok.sig").shell.csrfToken, "tok.sig");
  assert.ok(m.nav.length > 0); // composeNav produced a tree
  assert.equal(col0(m).label, "Name");
  assert.equal(m.pagination.summary.total, 30); // full mock dataset
  assert.equal(m.pagination.summary.from, 1);
  assert.equal(rowCount(m), 12); // default page size
  assert.equal(m.pagination.prev.href, undefined); // first page → prev disabled
  assert.ok(m.pagination.next.href); // more pages → next enabled
});

test("dashboard search filters rows, shrinks the total and shows a pill", () => {
  const first = nameOf(buildDashboardModel(new URL("http://x/")), 0); // e.g. "Avery Kline"
  const m = buildDashboardModel(new URL(`http://x/?q=${encodeURIComponent(first)}`));

  assert.equal(m.pagination.summary.total, 1);
  assert.equal(rowCount(m), 1);
  assert.equal(nameOf(m, 0), first);
  assert.deepEqual(m.filterBar.pills.map((p) => p.label), ["Search"]);

  // A no-match query yields an empty table, not an error.
  const none = buildDashboardModel(new URL("http://x/?q=zzz-no-such-person"));
  assert.equal(none.pagination.summary.total, 0);
  assert.equal(rowCount(none), 0);
});

test("dashboard sorts by a column, reflects direction, and the header toggles", () => {
  const asc = buildDashboardModel(new URL("http://x/?sort=name"));
  const desc = buildDashboardModel(new URL("http://x/?sort=-name"));

  // asc first name ≤ desc first name (reverse order).
  assert.ok(nameOf(asc, 0) <= nameOf(asc, 1));
  assert.ok(nameOf(desc, 0) >= nameOf(desc, 1));

  // The Name column carries the current direction and its header links to the opposite.
  assert.equal(col0(asc).sort, "asc");
  assert.match(col0(asc).href ?? "", /sort=-name/); // asc → click flips to desc
  assert.equal(col0(desc).sort, "desc");
  assert.match(col0(desc).href ?? "", /sort=name(?!\w)/); // desc → click flips to asc

  // An unknown sort field is ignored (no crash, no sort indicator).
  const bad = buildDashboardModel(new URL("http://x/?sort=bogus"));
  assert.equal(col0(bad).sort, undefined);
});

test("dashboard applies the central menu config: branding + nav override (rename/hide)", () => {
  const m = buildDashboardModel(new URL("http://x/"), [], {
    branding: { logo: "/public/logo.svg", name: "Acme Ops", sub: "Admin", theme: "dark" },
    override: { hide: ["teams"], rename: { people: "Staff" } },
  });

  assert.deepEqual(m.shell.brand, { logo: "/public/logo.svg", name: "Acme Ops", sub: "Admin" });
  assert.equal(m.shell.theme, "dark");
  const labels = m.nav.map((n) => n.label);
  assert.ok(labels.includes("Staff")); // "People" renamed
  assert.ok(!labels.includes("Teams")); // "Teams" hidden
});

test("dashboard menu wires in the permission-gated Admin section (only for admins)", () => {
  // An admin sees the Admin section with the four built-in screens.
  const admin = buildDashboardModel(new URL("http://x/"), ["admin"]);
  const adminNode = admin.nav.find((n) => n.label === "Admin");
  assert.ok(adminNode, "admin role → Admin section present");
  assert.deepEqual(adminNode!.children?.map((c) => c.href), ["/admin/users", "/admin/groups", "/admin/roles", "/admin/clients"]);

  // A non-admin (default []) never sees it — composeNav drops the gated header + its subtree.
  const plain = buildDashboardModel(new URL("http://x/"));
  assert.equal(plain.nav.find((n) => n.label === "Admin"), undefined);
  assert.ok(!plain.nav.some((n) => n.children?.some((c) => c.href === "/admin/users")));
});

test("dashboard paginates: page 2 slices the next rows and preserves state in links", () => {
  const p2 = buildDashboardModel(new URL("http://x/?sort=-name&page=2"));
  assert.equal(p2.pagination.summary.from, 13); // 30 rows / 12 per page → page 2 starts at 13
  assert.equal(rowCount(p2), 12);

  // prev/next present on the middle page; both preserve the active sort.
  assert.match(p2.pagination.prev.href ?? "", /sort=-name/);
  assert.match(p2.pagination.next.href ?? "", /sort=-name/);

  // Team filter actually narrows the set and adds a pill.
  const eng = buildDashboardModel(new URL("http://x/?team=Engineering"));
  assert.ok(eng.pagination.summary.total < 30);
  assert.deepEqual(eng.filterBar.pills.map((p) => p.label), ["Team"]);
});
