// Reference plugin (todo §7) — Scheduling/Shifts handlers + the upstream client. Shows the blessed
// shape: a thin handler parses ctx, calls an upstream REST service, and returns a RouteResult the
// host renders. The plugin holds no state of its own (README "Stateless") — data lives upstream.
//
// Handlers are factories bound to a ShiftsUpstream, and `fetch` is injectable, so they unit-test as
// pure functions against a mock upstream with no network (docs/plugin-contract.md → dev/test story).

// One import from the host's plugin-api barrel — the stable author surface (see docs/plugin-contract.md).
import { can, CSRF_FIELD, GuardError, type PageChrome, parseListQuery, readFormBody, type RouteHandler } from "../../src/plugin-api.ts";

export const SHIFTS_PATH = "/scheduling/shifts";
export const READ = "scheduling:read"; // permission token gating the list + nav
export const WRITE = "scheduling:write"; // permission token gating create

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
  list(): Promise<Shift[]>;
}

// Fail loud at boot (the plugin's onBoot hook) on a malformed/non-http upstream URL — a config
// typo surfaces at startup, not as a degraded page later. Reachability stays a runtime concern.
export function assertHttpUrl(value: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must be an http(s) URL: ${JSON.stringify(value)}`);
}

// REST client over the upstream service (a stand-in for the customer's real backend). `fetch` is
// injectable so handlers test without a network; the base URL comes from the plugin's own env.
export function createUpstream(baseUrl: string, fetchImpl: typeof fetch = fetch): ShiftsUpstream {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async create(input) {
      const res = await fetchImpl(`${base}/shifts`, {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!res.ok) throw new UpstreamError(`create shift failed (${res.status})`, res.status);
    },
    async list() {
      const res = await fetchImpl(`${base}/shifts`, { headers: { accept: "application/json" } });
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

export function buildListModel(opts: { canWrite: boolean; chrome: PageChrome; error?: string; q: string; shifts: Shift[] }) {
  return {
    breadcrumbs: [{ href: SHIFTS_PATH, label: "Scheduling" }, { label: "Shifts" }],
    canWrite: opts.canWrite,
    chrome: opts.chrome,
    ...(opts.error ? { error: opts.error } : {}),
    filterBar: {
      applyLabel: "Search",
      clearHref: SHIFTS_PATH,
      label: "Filter shifts",
      pills: opts.q ? [{ label: "Search", remove: SHIFTS_PATH, value: opts.q }] : [],
      rows: [[
        { label: "Search shifts", name: "q", placeholder: "Search title or assignee…", type: "search", value: opts.q },
        { type: "spacer" },
      ]],
    },
    newHref: `${SHIFTS_PATH}/new`,
    table: {
      caption: "Shifts",
      columns: [{ label: "Shift" }, { label: "Assignee" }, { label: "Start" }, { label: "End" }],
      rows: opts.shifts.map((s) => ({
        cells: [{ rowHeader: { text: s.title } }, s.assignee, s.start, s.end],
        name: s.title,
      })),
    },
    title: "Shifts",
  };
}

export function buildFormModel(opts: { chrome: PageChrome; errors?: Record<string, string>; formError?: string; values?: Partial<ShiftInput> }) {
  const v = opts.values ?? {};
  const e = opts.errors ?? {};
  const field = (cfg: { icon?: string; id: string; label: string; type?: string; value: string }) => ({
    ...cfg, name: cfg.id, ...(e[cfg.id] ? { error: e[cfg.id] } : {}), ...(cfg.id === "title" || cfg.id === "assignee" ? { required: true } : {}),
  });
  return {
    breadcrumbs: [{ href: SHIFTS_PATH, label: "Shifts" }, { label: "New shift" }],
    chrome: opts.chrome,
    ...(opts.formError ? { formError: opts.formError } : {}),
    form: {
      action: SHIFTS_PATH,
      cancelHref: SHIFTS_PATH,
      csrfToken: opts.chrome.csrfToken,
      fields: [
        field({ icon: "i-cal", id: "title", label: "Shift title", value: v.title ?? "" }),
        field({ icon: "i-user", id: "assignee", label: "Assignee", value: v.assignee ?? "" }),
        field({ id: "start", label: "Start", type: "datetime-local", value: v.start ?? "" }),
        field({ id: "end", label: "End", type: "datetime-local", value: v.end ?? "" }),
      ],
      submitLabel: "Create shift",
    },
    title: "New shift",
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
export function validate(input: ShiftInput): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.title) errors["title"] = "A shift needs a title.";
  if (!input.assignee) errors["assignee"] = "Assign the shift to someone.";
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
    } catch {
      error = "Couldn't reach the scheduling service — try again shortly.";
    }
    const needle = q.toLowerCase();
    const rows = needle ? shifts.filter((s) => s.title.toLowerCase().includes(needle) || s.assignee.toLowerCase().includes(needle)) : shifts;
    return { data: buildListModel({ canWrite: can(ctx, WRITE), chrome: ctx.chrome, ...(error ? { error } : {}), q, shifts: rows }), view: "shifts" };
  };
}

export function newShiftForm(): RouteHandler {
  return (ctx) => ({ data: buildFormModel({ chrome: ctx.chrome }), view: "shift-new" });
}

export function createShift(upstream: ShiftsUpstream): RouteHandler {
  return async (ctx) => {
    const form = await readFormBody(ctx.req);
    // A write is a first-party form, so guard it with the host's double-submit token (ctx.verifyCsrf).
    if (!ctx.verifyCsrf(form.get(CSRF_FIELD))) throw new GuardError(403, "invalid CSRF token");
    const input = readInput(form);
    const errors = validate(input);
    if (errors) return { data: buildFormModel({ chrome: ctx.chrome, errors, values: input }), status: 400, view: "shift-new" };
    try {
      await upstream.create(input);
    } catch {
      return { data: buildFormModel({ chrome: ctx.chrome, formError: "Couldn't save the shift — the scheduling service is unavailable.", values: input }), status: 502, view: "shift-new" };
    }
    return { redirect: SHIFTS_PATH }; // POST-redirect-GET
  };
}
