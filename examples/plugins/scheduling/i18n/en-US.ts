// This plugin's own catalog, and the baseline its other locales are written against. Keys are
// looked up here first and fall back to the host's, so a plugin owns its words without prefixing
// them, and `shifts.count` shows the plural form (host: README → Translating).

import type { PluralMessage } from "@plainpages/plugin-api";

const messages = {
  "scheduling.field.assignee": "Assignee",
  "scheduling.field.end": "End",
  "scheduling.field.start": "Start",
  "scheduling.field.title": "Shift title",
  "scheduling.filter.label": "Filter shifts",
  "scheduling.filter.searchLabel": "Search shifts",
  "scheduling.filter.searchPlaceholder": "Search title or assignee…",
  "scheduling.form.submit": "Create shift",
  "scheduling.mine.empty": "No shifts are assigned to {{email}}.",
  "scheduling.mine.title": "My shifts",
  "scheduling.nav.mine": "My shifts",
  "scheduling.nav.overview": "Overview",
  "scheduling.nav.section": "Scheduling",
  "scheduling.nav.shifts": "Shifts",
  "scheduling.new.title": "New shift",
  "scheduling.overview.lead":
    "Scheduling coordinates shifts across your team. Anyone can read this overview; the shift list itself is available to people with the <code>scheduling:read</code> permission.",
  "scheduling.overview.mine": "See my shifts",
  "scheduling.overview.signIn": "Sign in to view shifts",
  "scheduling.overview.title": "Scheduling",
  "scheduling.overview.view": "View shifts",
  "scheduling.shifts.count": { one: "{{count}} shift", other: "{{count}} shifts" } as PluralMessage,
  "scheduling.shifts.new": "New shift",
  "scheduling.shifts.title": "Shifts",
  "scheduling.table.assignee": "Assignee",
  "scheduling.table.end": "End",
  "scheduling.table.shift": "Shift",
  "scheduling.table.start": "Start",
  "scheduling.upstream.create": "Couldn't save the shift — the scheduling service is unavailable.",
  "scheduling.upstream.list": "Couldn't reach the scheduling service — try again shortly.",
  "scheduling.validation.assignee": "Assign the shift to someone.",
  "scheduling.validation.title": "A shift needs a title.",
};

export type SchedulingMessages = typeof messages;

export default messages;
