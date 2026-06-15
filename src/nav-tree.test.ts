import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const navTree = join(dirname(fileURLToPath(import.meta.url)), "..", "views", "partials", "nav-tree.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(navTree, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

const nodes = [
  { label: "Overview", href: "/overview", icon: "i-grid" }, // leaf · clickable · icon
  {
    label: "Workspace",
    open: true, // header · static · open
    children: [
      {
        label: "Directory",
        href: "/dir",
        icon: "i-users",
        count: 4,
        open: true, // header · clickable · icon · count
        children: [
          { label: "People", href: "/people", count: "1,284", current: true }, // leaf · clickable · current
          { label: "Webhooks (soon)" }, // leaf · static
        ],
      },
      { label: "Roles & Access", children: [{ label: "Roles", href: "/roles" }] }, // header · static · closed
    ],
  },
];

test("nav-tree renders the header/leaf × clickable/static matrix with counts, icons and aria-current", async () => {
  const html = flat(await render({ nodes }));

  // Root list vs. recursive child lists.
  assert.match(html, /<ul class="nav-tree">/);
  assert.match(html, /<ul class="nav-children">/);

  // Leaf · clickable · icon — spacer (no toggle), <a>, inlined sprite ref.
  assert.match(
    html,
    /<span class="nav-spacer" aria-hidden="true"><\/span><a class="nav-self" href="\/overview"><svg class="ico"><use href="#i-grid"\s*\/?><\/svg><span class="nav-label">Overview<\/span><\/a>/,
  );

  // Header · static · open — disclosure with [open] + escaped aria-label, <span> self.
  assert.match(
    html,
    /<details class="nav-disc" open><summary class="nav-tog" aria-label="Toggle Workspace">.*?<\/summary><\/details><span class="nav-self"><span class="nav-label">Workspace<\/span><\/span>/,
  );

  // Header · clickable · icon · count.
  assert.match(html, /<a class="nav-self" href="\/dir"><svg class="ico"><use href="#i-users"\s*\/?><\/svg><span class="nav-label">Directory<\/span><span class="nav-count">4<\/span><\/a>/);

  // Leaf · clickable · current · count.
  assert.match(html, /<a class="nav-self" href="\/people" aria-current="page"><span class="nav-label">People<\/span><span class="nav-count">1,284<\/span><\/a>/);

  // Leaf · static (no href → <span>, no toggle).
  assert.match(html, /<span class="nav-self"><span class="nav-label">Webhooks \(soon\)<\/span><\/span>/);

  // Header · static · closed (no [open]) + label escaping in both label and aria-label.
  assert.match(html, /<details class="nav-disc"><summary class="nav-tog" aria-label="Toggle Roles &amp; Access">/);
  assert.match(html, /<span class="nav-label">Roles &amp; Access<\/span>/);
});

test("nav-tree renders an empty root list with no nodes and never throws", async () => {
  assert.match(flat(await render()), /<ul class="nav-tree"><\/ul>/);
});
