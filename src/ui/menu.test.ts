import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { ENGLISH_LOCALS } from "../i18n/view-locals.ts";

const menu = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "views", "partials", "menu.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(menu, { ...ENGLISH_LOCALS, ...data });
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

test("menu renders trigger, positioning, the item matrix and check groups", async () => {
  const html = flat(await render({
    id: "cols-menu",
    trigger: { icon: "i-cols", text: "Columns", label: "Column settings" },
    align: "left", up: true, width: 240,
    items: [
      { head: "Actions" },
      { label: "Profile", icon: "i-user" },          // button (default), with icon
      { label: "Docs", href: "/docs" },              // link
      { sep: true },
      { label: "Sign out", icon: "i-logout", danger: true },
      { group: { legend: "Permission", name: "permission", control: "radio", options: [
        { value: "", label: "Any permission", checked: true },
        { value: "admin", label: "Admin" },
      ] } },
      { group: { name: "col", options: [{ value: "name", label: "Name", checked: true }] } }, // checkbox default, no legend
    ],
  }));

  // Trigger: icon + text + aria-label, wired to the panel by id; popover carries align/up + width.
  // The panel is the trigger's next sibling inside the wrapper — the CSS open state reads that.
  assert.match(html, /<div class="menu"><button class="btn" type="button" popovertarget="cols-menu" aria-label="Column settings"><svg class="ico ico-sm"><use href="#i-cols"\s*\/?><\/svg>Columns<\/button><div id="cols-menu" class="menu-pop left up" popover style="min-width:240px">/);

  // Item matrix: head, button-with-icon, link, separator, danger button.
  assert.match(html, /<div class="menu-head">Actions<\/div>/);
  assert.match(html, /<button class="menu-item" type="button"><svg class="ico"><use href="#i-user"\s*\/?><\/svg>Profile<\/button>/);
  assert.match(html, /<a class="menu-item" href="\/docs">Docs<\/a>/);
  assert.match(html, /<div class="menu-sep"><\/div>/);
  assert.match(html, /<button class="menu-item danger" type="button"><svg class="ico"><use href="#i-logout"\s*\/?><\/svg>Sign out<\/button>/);

  // Check group: radios reflect `checked`; legend optional; control defaults to checkbox.
  assert.match(html, /<fieldset class="menu-field"><legend class="menu-head">Permission<\/legend><label class="menu-check"><input type="radio" name="permission" value="" checked>Any permission<\/label><label class="menu-check"><input type="radio" name="permission" value="admin">Admin<\/label><\/fieldset>/);
  assert.match(html, /<fieldset class="menu-field"><label class="menu-check"><input type="checkbox" name="col" value="name" checked>Name<\/label><\/fieldset>/);
});

test("menu supports a raw/kebab trigger, escapes labels, and renders empty by default", async () => {
  // Raw trigger HTML, no button class, kebab flag.
  const kebab = flat(await render({
    id: "row-menu", kebab: true,
    trigger: { class: "", label: "Row actions", html: '<svg class="ico ico-sm"><use href="#i-kebab"/></svg>' },
    items: [{ label: "Edit", href: "/e" }],
  }));
  assert.match(kebab, /<button class="kebab" type="button" popovertarget="row-menu" aria-label="Row actions"><svg class="ico ico-sm"><use href="#i-kebab"\s*\/?><\/svg><\/button>/);

  // Labels are escaped (item text + trigger text).
  assert.match(flat(await render({ id: "esc-menu", trigger: { text: "<x>" }, items: [{ label: "<y>" }] })), /&lt;x&gt;<\/button>.*&lt;y&gt;/);

  // Only an id → a valid empty menu, never throws.
  assert.equal(flat(await render({ id: "m" })), '<div class="menu"><button class="btn" type="button" popovertarget="m"></button><div id="m" class="menu-pop" popover></div></div>');
});

test("menu demands an id — a trigger wired to nothing is a dead button, so say so", async () => {
  await assert.rejects(render({ items: [{ label: "Edit", href: "/e" }] }), /`id` is required/);
});
