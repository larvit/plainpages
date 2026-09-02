// Reference plugin — Scheduling/Shifts handlers + the upstream client. Shows the blessed
// shape: a thin handler parses ctx, calls an upstream REST service, and returns a RouteResult the
// host renders. The plugin holds no state of its own (README "Stateless") — data lives upstream.
//
// Handlers are factories bound to a ShiftsUpstream, and `fetch` is injectable, so they unit-test as
// pure functions against a mock upstream with no network (README.md → Local dev & test story).

// One import from the host's @plainpages/plugin-api barrel — the stable author surface (see README.md → Building plugins).
import { can, CSRF_FIELD, englishTranslator, GuardError, type PageChrome, parseListQuery, readFormBody, requireSession, type RouteHandler, type Translate, tracedFetch } from "@plainpages/plugin-api";
import enUS from "./i18n/en-US.ts";

// The plugin's own English (its catalog, then the host's), for a view model built outside a request:
// its unit tests. At runtime a handler passes ctx.t, which reads this catalog in the visitor's
// locale first, then the host's.
const EN: Translate = englishTranslator(enUS);

export const SCHEDULING_PATH = "/scheduling"; // the plugin's public overview page
export const SHIFTS_PATH = "/scheduling/shifts";
export const MINE_PATH = "/scheduling/mine"; // the visitor's own shifts — a session is the whole gate
export const READ = "scheduling:read"; // the permission gating the list + nav
export const WRITE = "scheduling:write"; // the permission gating create

export interface Shift {
  id: string;
  assignee: string;
  end: string;
  start: string;
  title: string;
}

export interface ShiftInput {
  assignee: string;
  end: string;
  start: string;
  title: string;
}

// Thrown when the upstream errors; the handler degrades to a recoverable page, never a host 500.
export class UpstreamError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export interface ShiftsUpstream {
  create(input: ShiftInput): Promise<void>;
  // `assignee` scopes the read at the source, which is where an ownership rule belongs (README →
  // Three tiers of "may I?"); without it the caller would hold everyone's rows to render one page.
  list(opts?: { assignee?: string }): Promise<Shift[]>;
}

// REST client over the upstream service (a stand-in for the customer's real backend). `fetch`
// defaults to the host's tracedFetch, so each upstream call joins the request's trace (a client
// span + a propagated traceparent); it's injectable so handlers unit-test against a mock, no network.
// `baseUrl` is read per call: the plugin's settings arrive on onBoot, after the manifest that binds
// these handlers has already been built.
export function createUpstream(baseUrl: () => string, fetchImpl: typeof fetch = tracedFetch): ShiftsUpstream {
  const base = (): string => baseUrl().replace(/\/+$/, "");
  return {
    async create(input) {
      const res = await fetchImpl(`${base()}/shifts`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!res.ok) throw new UpstreamError(`create shift failed (${res.status})`, res.status);
    },
    async list(opts = {}) {
      const query = opts.assignee == null ? "" : `?${new URLSearchParams({ assignee: opts.assignee })}`;
      const res = await fetchImpl(`${base()}/shifts${query}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new UpstreamError(`list shifts failed (${res.status})`, res.status);
      const data: unknown = await res.json();
      return Array.isArray(data) ? data.map(toShift) : [];
    },
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function toShift(raw: unknown): Shift {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { assignee: str(r["assignee"]), end: str(r["end"]), id: str(r["id"]), start: str(r["start"]), title: str(r["title"]) };
}

// ---- view models (pure; the EJS views read these) -----------------------------------

export function buildListModel(opts: { canWrite: boolean; chrome: PageChrome; error?: string; q: string; shifts: Shift[]; t?: Translate }) {
  const t = opts.t ?? EN;
  return {
    breadcrumbs: [{ label: t("scheduling.shifts.title") }], // SHIFTS_PATH is the list itself; the form links back to it
    canWrite: opts.canWrite,
    chrome: opts.chrome,
    // A plural message: one catalog key, the right form per locale and count (Intl.PluralRules).
    count: t("scheduling.shifts.count", { count: opts.shifts.length }),
    ...(opts.error ? { error: opts.error } : {}),
    filterBar: {
      applyLabel: t("filter.search"),
      clearHref: SHIFTS_PATH,
      label: t("scheduling.filter.label"),
      pills: opts.q ? [{ label: t("filter.search"), remove: SHIFTS_PATH, value: opts.q }] : [],
      rows: [[
        { label: t("scheduling.filter.searchLabel"), name: "q", placeholder: t("scheduling.filter.searchPlaceholder"), type: "search", value: opts.q },
        { type: "spacer" },
      ]],
    },
    newHref: `${SHIFTS_PATH}/new`,
    table: {
      caption: t("scheduling.shifts.title"),
      columns: [{ label: t("scheduling.table.shift") }, { label: t("scheduling.table.assignee") }, { label: t("scheduling.table.start") }, { label: t("scheduling.table.end") }],
      rows: opts.shifts.map((s) => ({
        cells: [{ rowHeader: { text: s.title } }, s.assignee, s.start, s.end],
        name: s.title,
      })),
    },
    title: t("scheduling.shifts.title"),
  };
}

export function buildFormModel(opts: { chrome: PageChrome; errors?: Record<string, string>; formError?: string; t?: Translate; values?: Partial<ShiftInput> }) {
  const t = opts.t ?? EN;
  const v = opts.values ?? {};
  const e = opts.errors ?? {};
  const field = (cfg: { icon?: string; id: string; label: string; type?: string; value: string }) => ({
    ...cfg, name: cfg.id, ...(e[cfg.id] ? { error: e[cfg.id] } : {}), ...(cfg.id === "title" || cfg.id === "assignee" ? { required: true } : {}),
  });
  return {
    breadcrumbs: [{ href: SHIFTS_PATH, label: t("scheduling.shifts.title") }, { label: t("scheduling.new.title") }],
    chrome: opts.chrome,
    ...(opts.formError ? { formError: opts.formError } : {}),
    form: {
      action: SHIFTS_PATH,
      cancelHref: SHIFTS_PATH,
      csrfToken: opts.chrome.csrfToken,
      cancelLabel: t("common.cancel"),
      fields: [
        field({ icon: "i-cal", id: "title", label: t("scheduling.field.title"), value: v.title ?? "" }),
        field({ icon: "i-user", id: "assignee", label: t("scheduling.field.assignee"), value: v.assignee ?? "" }),
        field({ id: "start", label: t("scheduling.field.start"), type: "datetime-local", value: v.start ?? "" }),
        field({ id: "end", label: t("scheduling.field.end"), type: "datetime-local", value: v.end ?? "" }),
      ],
      submitLabel: t("scheduling.form.submit"),
    },
    title: t("scheduling.new.title"),
  };
}

// ---- input + validation -------------------------------------------------------------

export function readInput(form: URLSearchParams): ShiftInput {
  return {
    assignee: (form.get("assignee") ?? "").trim(),
    end: (form.get("end") ?? "").trim(),
    start: (form.get("start") ?? "").trim(),
    title: (form.get("title") ?? "").trim(),
  };
}

// Required-field validation → { field: message } or null. Kept deliberately small; the upstream
// owns the real domain rules (overlap, capacity, …) and rejects with a 4xx the handler surfaces.
export function validate(input: ShiftInput, t: Translate = EN): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.title) errors["title"] = t("scheduling.validation.title");
  if (!input.assignee) errors["assignee"] = t("scheduling.validation.assignee");
  return Object.keys(errors).length ? errors : null;
}

// ---- handlers (factories bound to the upstream) -------------------------------------

export function listShifts(upstream: ShiftsUpstream): RouteHandler {
  return async (ctx) => {
    const q = parseListQuery(ctx.url).q;
    let shifts: Shift[] = [];
    let error: string | undefined;
    try {
      shifts = await upstream.list();
    } catch (err) {
      ctx.log.warn("scheduling upstream unreachable", { error: String(err) }); // plugin logging via ctx.log
      error = ctx.t("scheduling.upstream.list");
    }
    const needle = q.toLowerCase();
    const rows = needle ? shifts.filter((s) => s.title.toLowerCase().includes(needle) || s.assignee.toLowerCase().includes(needle)) : shifts;
    return { data: buildListModel({ canWrite: can(ctx, WRITE), chrome: ctx.chrome, ...(error ? { error } : {}), q, shifts: rows, t: ctx.t }), view: "shifts" };
  };
}

export function newShiftForm(): RouteHandler {
  return (ctx) => ({ data: buildFormModel({ chrome: ctx.chrome, t: ctx.t }), view: "shift-new" });
}

export function myShifts(upstream: ShiftsUpstream): RouteHandler {
  return async (ctx) => {
    const user = requireSession(ctx);
    let shifts: Shift[] = [];
    let error: string | undefined;
    try {
      shifts = await upstream.list({ assignee: user.email });
    } catch (err) {
      ctx.log.warn("scheduling upstream unreachable", { error: String(err) });
      error = ctx.t("scheduling.upstream.list");
    }
    return { data: buildMineModel({ chrome: ctx.chrome, email: user.email, ...(error ? { error } : {}), shifts, t: ctx.t }), view: "mine" };
  };
}

export function buildMineModel(opts: { chrome: PageChrome; email: string; error?: string; shifts: Shift[]; t?: Translate }) {
  const t = opts.t ?? EN;
  return {
    breadcrumbs: [{ label: t("scheduling.mine.title") }],
    chrome: opts.chrome,
    count: t("scheduling.shifts.count", { count: opts.shifts.length }),
    ...(opts.error ? { error: opts.error } : {}),
    table: {
      caption: t("scheduling.mine.title"),
      columns: [{ label: t("scheduling.table.shift") }, { label: t("scheduling.table.start") }, { label: t("scheduling.table.end") }],
      // Only when the upstream answered: a failed read knows nothing about what is assigned.
      ...(opts.error === undefined ? { emptyText: t("scheduling.mine.empty", { email: opts.email }) } : {}),
      rows: opts.shifts.map((s) => ({ cells: [{ rowHeader: { text: s.title } }, s.start, s.end], name: s.title })),
    },
    title: t("scheduling.mine.title"),
  };
}

// Public overview: a page anyone may reach — its route + nav node are marked `public`, so the
// gate lets an anonymous visitor through and the menu option shows for everyone. The real data
// (the shifts list) stays behind `scheduling:read`; a reader gets a link straight to it, anyone
// else a prompt to sign in. ctx.user may be null here, so read the permission via can() (zero I/O).
export function overview(): RouteHandler {
  return (ctx) => ({
    data: {
      breadcrumbs: [{ label: ctx.t("scheduling.nav.overview") }],
      canRead: can(ctx, READ),
      chrome: ctx.chrome,
      shiftsHref: ctx.localeHref(SHIFTS_PATH), // a plugin carries the visitor's locale onto its own links
      signInHref: ctx.localeHref(`/login?return_to=${encodeURIComponent(ctx.localeHref(SHIFTS_PATH))}`),
      title: ctx.t("scheduling.overview.title"),
    },
    view: "overview",
  });
}

export function createShift(upstream: ShiftsUpstream): RouteHandler {
  return async (ctx) => {
    const form = await readFormBody(ctx.req);
    // A write is a first-party form, so guard it with the host's double-submit token (ctx.verifyCsrf).
    if (!ctx.verifyCsrf(form.get(CSRF_FIELD))) throw new GuardError(403, "invalid CSRF token");
    const input = readInput(form);
    const errors = validate(input, ctx.t);
    if (errors) return { data: buildFormModel({ chrome: ctx.chrome, errors, t: ctx.t, values: input }), status: 400, view: "shift-new" };
    try {
      await upstream.create(input);
    } catch (err) {
      ctx.log.warn("scheduling shift create failed (upstream)", { error: String(err) });
      return { data: buildFormModel({ chrome: ctx.chrome, formError: ctx.t("scheduling.upstream.create"), t: ctx.t, values: input }), status: 502, view: "shift-new" };
    }
    ctx.log.info("scheduling shift created", { assignee: input.assignee, title: input.title });
    return { redirect: SHIFTS_PATH }; // POST-redirect-GET
  };
}
