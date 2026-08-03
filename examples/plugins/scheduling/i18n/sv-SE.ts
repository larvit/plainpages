import type { SchedulingMessages } from "./en-US.ts";

const messages: SchedulingMessages = {
  "scheduling.cancel": "Avbryt",
  "scheduling.field.assignee": "Tilldelad",
  "scheduling.field.end": "Slut",
  "scheduling.field.start": "Start",
  "scheduling.field.title": "Passets namn",
  "scheduling.filter.label": "Filtrera pass",
  "scheduling.filter.search": "Sök",
  "scheduling.filter.searchLabel": "Sök pass",
  "scheduling.filter.searchPlaceholder": "Sök på namn eller person…",
  "scheduling.form.submit": "Skapa pass",
  "scheduling.nav.overview": "Översikt",
  "scheduling.nav.section": "Schemaläggning",
  "scheduling.nav.shifts": "Pass",
  "scheduling.new.title": "Nytt pass",
  "scheduling.overview.lead":
    "Schemaläggningen samordnar teamets pass. Alla kan läsa den här översikten; själva passlistan kräver behörigheten <code>scheduling:read</code>.",
  "scheduling.overview.signIn": "Logga in för att se passen",
  "scheduling.overview.title": "Schemaläggning",
  "scheduling.overview.view": "Visa pass",
  "scheduling.shifts.count": { one: "{{count}} pass", other: "{{count}} pass" },
  "scheduling.shifts.new": "Nytt pass",
  "scheduling.shifts.title": "Pass",
  "scheduling.table.assignee": "Tilldelad",
  "scheduling.table.end": "Slut",
  "scheduling.table.shift": "Pass",
  "scheduling.table.start": "Start",
  "scheduling.upstream.create": "Passet kunde inte sparas — schemaläggningstjänsten är otillgänglig.",
  "scheduling.upstream.list": "Vi når inte schemaläggningstjänsten — försök igen om en stund.",
  "scheduling.validation.assignee": "Passet måste tilldelas någon.",
  "scheduling.validation.title": "Passet behöver ett namn.",
};

export default messages;
