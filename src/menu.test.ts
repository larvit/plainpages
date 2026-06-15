import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const menu = join(dirname(fileURLToPath(import.meta.url)), "..", "views", "partials", "menu.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(menu, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

test("menu renders trigger, positioning, the item matrix and check groups", async () => {
  const html = flat(await render({
    trigger: { icon: "i-cols", text: "Columns", label: "Column settings" },
    align: "left", up: true, width: 240,
    items: [
      { head: "Actions" },
      { label: "Profile", icon: "i-user" },          // button (default), with icon
      { label: "Docs", href: "/docs" },              // link
      { sep: true },
      { label: "Sign out", icon: "i-logout", danger: true },
      { group: { legend: "Role", name: "role", control: "radio", options: [
        { value: "", label: "Any role", checked: true },
        { value: "admin", label: "Admin" },
      ] } },
      { group: { name: "col", options: [{ value: "name", label: "Name", checked: true }] } }, // checkbox default, no legend
    ],
  }));

  // Trigger: icon + text + aria-label; popover carries align/up classes + width.
  assert.match(html, /<details class="menu"><summary class="btn" aria-label="Column settings"><svg class="ico ico-sm"><use href="#i-cols"\s*\/?><\/svg>Columns<\/summary>/);
  assert.match(html, /<div class="menu-pop left up" style="min-width:240px">/);

  // Item matrix: head, button-with-icon, link, separator, danger button.
  assert.match(html, /<div class="menu-head">Actions<\/div>/);
  assert.match(html, /<button class="menu-item" type="button"><svg class="ico"><use href="#i-user"\s*\/?><\/svg>Profile<\/button>/);
  assert.match(html, /<a class="menu-item" href="\/docs">Docs<\/a>/);
  assert.match(html, /<div class="menu-sep"><\/div>/);
  assert.match(html, /<button class="menu-item danger" type="button"><svg class="ico"><use href="#i-logout"\s*\/?><\/svg>Sign out<\/button>/);

  // Check group: radios reflect `checked`; legend optional; control defaults to checkbox.
  assert.match(html, /<fieldset class="menu-field"><legend class="menu-head">Role<\/legend><label class="menu-check"><input type="radio" name="role" value="" checked>Any role<\/label><label class="menu-check"><input type="radio" name="role" value="admin">Admin<\/label><\/fieldset>/);
  assert.match(html, /<fieldset class="menu-field"><label class="menu-check"><input type="checkbox" name="col" value="name" checked>Name<\/label><\/fieldset>/);
});

test("menu supports a raw/kebab trigger, escapes labels, and renders empty by default", async () => {
  // Raw trigger HTML, no summary class, kebab + open flags.
  const kebab = flat(await render({
    kebab: true, open: true,
    trigger: { class: "", label: "Row actions", html: '<svg class="ico ico-sm"><use href="#i-kebab"/></svg>' },
    items: [{ label: "Edit", href: "/e" }],
  }));
  assert.match(kebab, /<details class="menu kebab" open><summary aria-label="Row actions"><svg class="ico ico-sm"><use href="#i-kebab"\s*\/?><\/svg><\/summary>/);

  // Labels are escaped (item text + trigger text).
  assert.match(flat(await render({ trigger: { text: "<x>" }, items: [{ label: "<y>" }] })), /<summary class="btn">&lt;x&gt;<\/summary>.*&lt;y&gt;/);

  // No locals → a valid empty menu, never throws.
  assert.equal(flat(await render()), '<details class="menu"><summary class="btn"></summary><div class="menu-pop"></div></details>');
});
