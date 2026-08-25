import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { ENGLISH_LOCALS } from "../i18n/view-locals.ts";

const filterBar = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "views", "partials", "filter-bar.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(filterBar, { ...ENGLISH_LOCALS, ...data });
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

const config = {
  label: "Filter people",
  rows: [
    [
      { type: "search", name: "q", placeholder: "Search people…", value: "ann", label: "Search people" },
      {
        type: "segmented",
        name: "status",
        legend: "Status",
        value: "active",
        options: [
          { value: "all", label: "All", count: "1,284" },
          { value: "active", label: "Active" },
          { value: "archived", label: "Archived" },
        ],
      },
      { type: "select", name: "team", label: "Team", value: "design", options: [{ value: "", label: "All teams" }, { value: "design", label: "Design" }] },
      { type: "spacer" },
    ],
    [
      {
        type: "chips",
        name: "tag",
        legend: "Tags",
        value: ["engineering", "oncall"],
        options: [{ value: "engineering", label: "Engineering" }, { value: "design", label: "Design" }, { value: "oncall", label: "On-call" }],
      },
      { type: "daterange", legend: "Joined", from: { name: "joined_from", value: "2026-01-01", label: "Joined from" }, to: { name: "joined_to", value: "2026-06-14", label: "Joined to" } },
      {
        type: "multiselect",
        name: "owner",
        legend: "Owner",
        note: "30 of 45",
        value: ["ann"],
        options: [{ value: "ann", label: "Ann Berg" }, { value: "bo", label: "Bo Falk" }],
      },
      { type: "multiselect", name: "room", legend: "Room", options: [{ value: "lab", label: "Lab" }] },
    ],
  ],
  pills: [{ label: "Team", value: "Engineering", remove: "?tag=oncall" }],
  clearHref: "?",
};

test("filter-bar renders a GET form with every control type, reflecting current values", async () => {
  const html = flat(await render(config));

  // GET form (server-side filtering, zero-JS).
  assert.match(html, /<form class="filters" method="get" aria-label="Filter people">/);

  // search — icon + value reflected.
  assert.match(html, /<label class="search"><span class="sr-only">Search people<\/span><svg class="ico ico-sm" aria-hidden="true"><use href="#i-search"\s*\/?><\/svg><input type="search" name="q" placeholder="Search people…" value="ann"><\/label>/);

  // segmented — current value checked, others not, optional count badge.
  assert.match(html, /<input type="radio" name="status" value="all"><span>All<\/span><span class="seg-count">1,284<\/span>/);
  assert.match(html, /<input type="radio" name="status" value="active" checked><span>Active<\/span>/);

  // select — matching option selected.
  assert.match(html, /<select id="f-team" name="team"><option value="">All teams<\/option><option value="design" selected>Design<\/option><\/select>/);

  // chips — checkbox group, only current values checked.
  assert.match(html, /<input type="checkbox" name="tag" value="engineering" checked>Engineering/);
  assert.match(html, /<input type="checkbox" name="tag" value="oncall" checked>On-call/);
  assert.match(html, /<input type="checkbox" name="tag" value="design">Design/);

  // multiselect — a disclosure: the trigger names the filter and counts what is chosen, the options
  // are checkboxes in a fieldset the popover holds, so a long list costs one line of the bar.
  assert.match(html, /<div class="menu"><button class="btn btn-menu" type="button" popovertarget="f-owner-menu" aria-label="Owner, 1 selected">Owner<span class="badge">1<\/span><\/button><div id="f-owner-menu" class="menu-pop left" popover>/);
  assert.match(html, /popover><div class="menu-head">30 of 45<\/div><fieldset class="menu-field"><legend class="menu-head">Owner<\/legend><label class="menu-check"><input type="checkbox" name="owner" value="ann" checked>Ann Berg<\/label><label class="menu-check"><input type="checkbox" name="owner" value="bo">Bo Falk<\/label><\/fieldset>/);

  // Nothing chosen — no badge and no count in the accessible name.
  assert.match(html, /<button class="btn btn-menu" type="button" popovertarget="f-room-menu">Room<\/button>/);

  // daterange — calendar icon + two date inputs with values.
  assert.match(html, /<div class="daterange"><svg class="ico ico-sm" aria-hidden="true"><use href="#i-cal"\s*\/?><\/svg>.*?<input type="date" id="f-joined_from" name="joined_from" value="2026-01-01">.*?<span class="to" aria-hidden="true">to<\/span>.*?<input type="date" id="f-joined_to" name="joined_to" value="2026-06-14">/);

  // spacer.
  assert.match(html, /<div class="spacer"><\/div>/);

  // applied pills + clear-all + Reset/Apply actions.
  assert.match(html, /<div class="active-pills" aria-label="Applied filters"><span class="filter-legend">Applied<\/span><span class="pill"><b>Team:<\/b> Engineering <a class="pill-x" href="\?tag=oncall" aria-label="Remove Team filter">/);
  assert.match(html, /<a class="pill-clear" href="\?">Clear all<\/a>/);
  assert.match(html, /<button type="reset" class="btn">Reset<\/button>/);
  assert.match(html, /<button type="submit" class="btn btn-primary"><svg class="ico ico-sm" aria-hidden="true"><use href="#i-search"\s*\/?><\/svg>Apply filters<\/button>/);
});

test("filter-bar renders with defaults: form + actions, no pills, never throws", async () => {
  const html = flat(await render());
  assert.match(html, /<form class="filters" method="get"/);
  assert.match(html, /<button type="submit" class="btn btn-primary"/);
  assert.doesNotMatch(html, /active-pills/);
});
