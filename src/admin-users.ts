// Built-in Users admin screen (todo §5): list Kratos identities (filter/sort/paginate) and
// create / edit / deactivate / delete / trigger-recovery them. Writes go only to Kratos via the
// admin client (README "stateless"); the app holds no user store. The pure builders here turn
// identities + the request URL into the building-block view models; `handleAdminUsers` is the
// imperative shell app.ts dispatches to — it gates (admin only), CSRF-guards every mutation, and
// maps each action to a RouteResult (render a page, or redirect after a write — PRG).

import { ADMIN_PERMISSION, ADMIN_USERS_BASE, adminNav } from "./admin-nav.ts";
import { readFormBody } from "./body.ts";
import type { RequestContext, User } from "./context.ts";
import { CSRF_FIELD, verifyCsrfRequest } from "./csrf.ts";
import { GuardError } from "./guards.ts";
import type { Identity, KratosAdmin, RecoveryCode } from "./kratos-admin.ts";
import { KratosError } from "./kratos-public.ts";
import { parseListQuery } from "./list-query.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import { paginate } from "./paginate.ts";
import type { RouteResult } from "./plugin.ts";
import { buildShellContext } from "./shell-context.ts";

const SCHEMA_ID = "default"; // matches kratos.yml identity.default_schema_id
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];
// One Kratos page is fetched and filtered/sorted/paged in memory — the admin API offers no
// full-text search or sort. Ample for an admin tool; raise if a deployment outgrows it.
const LIST_FETCH_SIZE = 250;
const STATE_TONE: Record<string, string> = { active: "pos", inactive: "warn" };

export interface UserView {
  email: string;
  id: string;
  initials: string;
  name: string;
  state: string; // Kratos identity state: "active" | "inactive"
}

export interface UserInput {
  email: string;
  first: string;
  last: string;
  password: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function nameParts(identity: Identity): { first: string; last: string } {
  const nm = ((identity.traits?.name ?? {}) as { first?: unknown; last?: unknown });
  return {
    first: typeof nm.first === "string" ? nm.first.trim() : "",
    last: typeof nm.last === "string" ? nm.last.trim() : "",
  };
}

export function toUserView(identity: Identity): UserView {
  const email = typeof identity.traits?.email === "string" ? (identity.traits.email as string) : "";
  const { first, last } = nameParts(identity);
  const full = `${first} ${last}`.trim();
  const name = full || email.split("@")[0] || email;
  const initials = (first && last ? first[0]! + last[0]! : name.slice(0, 2) || "U").toUpperCase();
  return { email, id: identity.id, initials, name, state: identity.state ?? "active" };
}

// ---- Kratos payloads ----

export function createIdentityPayload(input: UserInput): Record<string, unknown> {
  const traits: Record<string, unknown> = { email: input.email };
  if (input.first || input.last) traits.name = { first: input.first, last: input.last };
  const payload: Record<string, unknown> = { schema_id: SCHEMA_ID, state: "active", traits };
  if (input.password) payload.credentials = { password: { config: { password: input.password } } };
  return payload;
}

// A full-identity PUT must carry schema/state/traits. Keep the existing email (the form's email is
// read-only) and other traits; rewrite name from the input (cleared ⇒ drop it).
export function updateIdentityPayload(identity: Identity, input: UserInput): Record<string, unknown> {
  const traits: Record<string, unknown> = { ...(identity.traits ?? {}) };
  if (input.first || input.last) traits.name = { first: input.first, last: input.last };
  else delete traits.name;
  return { schema_id: identity.schema_id ?? SCHEMA_ID, state: identity.state ?? "active", traits };
}

export function setStatePayload(identity: Identity, state: "active" | "inactive"): Record<string, unknown> {
  return { schema_id: identity.schema_id ?? SCHEMA_ID, state, traits: { ...(identity.traits ?? {}) } };
}

// ---- view models ----

interface ListState {
  page: number;
  pageSize: number;
  q: string;
  sort: string | null;
  status: string;
}

const SORT: Record<string, (u: UserView) => string> = {
  email: (u) => u.email,
  name: (u) => u.name,
  status: (u) => u.state,
};
const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "status", label: "Status" },
];

// Canonical list URL from the current state + per-link overrides; omits defaults so links stay tidy.
function listHref(state: ListState, overrides: Partial<ListState> = {}): string {
  const s = { ...state, ...overrides };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.status && s.status !== "all") p.set("status", s.status);
  if (s.sort) p.set("sort", s.sort);
  if (s.page > 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(s.pageSize));
  const qs = p.toString();
  return qs ? `${ADMIN_USERS_BASE}?${qs}` : ADMIN_USERS_BASE;
}

export function buildUsersListModel(opts: {
  csrfToken?: string;
  identities: Identity[];
  menu?: MenuConfig;
  url: URL | URLSearchParams | string;
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const query = parseListQuery(opts.url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const status = query.filters.status?.[0] ?? "all";
  const sort = query.sort && SORT[query.sort.field] ? query.sort : null;
  const sortToken = sort ? (sort.dir === "desc" ? `-${sort.field}` : sort.field) : null;
  const needle = query.q.toLowerCase();

  const all = opts.identities.map(toUserView);
  let list = all.filter((u) =>
    (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)) &&
    (status === "all" || u.state === status));
  if (sort) {
    const get = SORT[sort.field] as (u: UserView) => string;
    const dir = sort.dir === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => get(a).localeCompare(get(b)) * dir);
  }

  const page = paginate(list.length, query.page, query.pageSize, { boundaries: 1, siblings: 1 });
  const start = (page.page - 1) * page.pageSize;
  const rows = list.slice(start, start + page.pageSize);
  const state: ListState = { page: page.page, pageSize: page.pageSize, q: query.q, sort: sortToken, status };

  return {
    filterBar: listFilterBar(state, all.length),
    nav: adminNav(opts.user?.roles ?? [], menu, "users"),
    pagination: listPagination(state, page),
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Admin" }, { label: "Users" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "Users",
      user: opts.user ?? null,
    }),
    table: listTable(rows, state, sort),
  };
}

function listTable(rows: UserView[], state: ListState, sort: { dir: "asc" | "desc"; field: string } | null) {
  return {
    actions: true,
    caption: "Users",
    columns: COLUMNS.map((c) => {
      const dir = sort && sort.field === c.key ? sort.dir : undefined;
      const next = dir === "asc" ? `-${c.key}` : c.key; // asc→desc, else→asc
      return { href: listHref(state, { page: 1, sort: next }), label: c.label, sort: dir, sortable: true };
    }),
    rows: rows.map((u) => ({
      actions: [{ href: `${ADMIN_USERS_BASE}/${encodeURIComponent(u.id)}`, icon: "i-edit", label: "Edit" }],
      cells: [
        { user: { initials: u.initials, name: u.name } },
        u.email,
        { badge: { label: cap(u.state), tone: STATE_TONE[u.state] ?? "info" } },
      ],
      name: u.name,
    })),
  };
}

function listFilterBar(state: ListState, total: number) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: "Search", remove: listHref(state, { page: 1, q: "" }), value: state.q });
  if (state.status !== "all") pills.push({ label: "Status", remove: listHref(state, { page: 1, status: "all" }), value: cap(state.status) });
  return {
    applyLabel: "Apply filters",
    clearHref: ADMIN_USERS_BASE,
    label: "Filter users",
    pills,
    rows: [[
      { label: "Search users", name: "q", placeholder: "Search name or email…", type: "search", value: state.q },
      { legend: "Status", name: "status", options: [
        { count: total, label: "All", value: "all" },
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
      ], type: "segmented", value: state.status },
      { type: "spacer" },
    ]],
  };
}

function listPagination(state: ListState, page: ReturnType<typeof paginate>) {
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  if (state.status !== "all") hidden.push({ name: "status", value: state.status });
  if (state.sort) hidden.push({ name: "sort", value: state.sort });
  return {
    label: "Users pagination",
    next: { href: page.next ? listHref(state, { page: page.next }) : undefined },
    pages: page.pages.map((p) =>
      p.ellipsis ? { ellipsis: true }
        : p.current ? { current: true, label: String(p.page) }
          : { href: listHref(state, { page: p.page as number }), label: String(p.page) }),
    prev: { href: page.prev ? listHref(state, { page: page.prev }) : undefined },
    rows: { hidden, label: "Rows", name: "pageSize", options: PAGE_SIZES, submitLabel: "Go", value: state.pageSize },
    summary: { from: page.from, to: page.to, total: page.total },
  };
}

export interface FieldConfig {
  autocomplete?: string;
  hint?: string;
  icon?: string;
  id: string;
  label: string;
  name: string;
  optional?: boolean;
  readonly?: boolean;
  required?: boolean;
  type?: string;
  value?: string;
}

export function buildUserFormModel(opts: {
  csrfToken?: string;
  error?: string;
  identity?: Identity | null;
  menu?: MenuConfig;
  recovery?: RecoveryCode;
  user?: User | null;
  values?: Partial<UserInput>;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const editing = opts.identity != null;
  const view = editing ? toUserView(opts.identity!) : null;
  const np = editing ? nameParts(opts.identity!) : { first: opts.values?.first ?? "", last: opts.values?.last ?? "" };
  const email = editing ? view!.email : (opts.values?.email ?? "");
  const idPath = editing ? `${ADMIN_USERS_BASE}/${encodeURIComponent(view!.id)}` : ADMIN_USERS_BASE;

  const fields: FieldConfig[] = [
    { autocomplete: "email", icon: "i-mail", id: "email", label: "Email", name: "email", required: !editing, type: "email", value: email,
      ...(editing ? { hint: "The login identifier — can't be changed here.", readonly: true } : {}) },
    { id: "first", label: "First name", name: "first", optional: true, value: np.first },
    { id: "last", label: "Last name", name: "last", optional: true, value: np.last },
  ];
  if (!editing) fields.push({ autocomplete: "new-password", hint: "Optional — leave blank to have the user set one via a recovery link.", icon: "i-lock", id: "password", label: "Password", name: "password", optional: true, type: "password" });

  return {
    edit: editing ? {
      deleteAction: `${idPath}/delete`,
      id: view!.id,
      nextLabel: view!.state === "inactive" ? "Reactivate" : "Deactivate",
      recoveryAction: `${idPath}/recovery`,
      state: view!.state,
      stateAction: `${idPath}/state`,
    } : undefined,
    error: opts.error,
    form: { action: idPath, cancelHref: ADMIN_USERS_BASE, csrfToken: opts.csrfToken ?? "", fields, submitLabel: editing ? "Save changes" : "Create user" },
    nav: adminNav(opts.user?.roles ?? [], menu, "users"),
    recovery: opts.recovery,
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Users" }, { label: editing ? "Edit" : "New" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: editing ? "Edit user" : "New user",
      user: opts.user ?? null,
    }),
  };
}

// ---- request handler (imperative shell) ----

export interface AdminUsersDeps {
  csrfSecret: string;
  kratosAdmin: KratosAdmin;
  menu: MenuConfig;
  render: (view: string, data: Record<string, unknown>) => Promise<string>;
}

function readUserInput(form: URLSearchParams): UserInput {
  return {
    email: (form.get("email") ?? "").trim(),
    first: (form.get("first") ?? "").trim(),
    last: (form.get("last") ?? "").trim(),
    password: form.get("password") ?? "",
  };
}

// Handle a request under /admin/users. Returns null when the path isn't ours (app.ts falls
// through to its 404). Throws GuardError for auth/CSRF failures (app.ts maps it to a response).
export async function handleAdminUsers(ctx: RequestContext, csrfToken: string, deps: AdminUsersDeps): Promise<RouteResult | null> {
  const path = ctx.url.pathname;
  if (path !== ADMIN_USERS_BASE && !path.startsWith(`${ADMIN_USERS_BASE}/`)) return null;

  if (!ctx.user) throw new GuardError(401, "authentication required", "/login");
  if (!ctx.roles.includes(ADMIN_PERMISSION)) throw new GuardError(403, "admin role required");

  const { kratosAdmin, menu, render } = deps;
  const user = ctx.user;
  const method = (ctx.req.method ?? "GET").toUpperCase();
  const seg = path.slice(ADMIN_USERS_BASE.length).split("/").filter(Boolean);

  // Every mutation is a first-party form → CSRF-guard it (the host doesn't gate plugin routes,
  // but it owns these). Reads the body once; the action handlers reuse the parsed form.
  let form: URLSearchParams | undefined;
  if (method === "POST") {
    form = await readFormBody(ctx.req);
    if (!verifyCsrfRequest({ cookieHeader: ctx.req.headers.cookie, secret: deps.csrfSecret, submitted: form.get(CSRF_FIELD) })) {
      throw new GuardError(403, "invalid CSRF token");
    }
  }

  const renderList = async (): Promise<RouteResult> => {
    const { identities } = await kratosAdmin.listIdentities({ pageSize: LIST_FETCH_SIZE });
    return { html: await render("admin/users", { model: buildUsersListModel({ csrfToken, identities, menu, url: ctx.url, user }) }) };
  };
  const renderForm = async (extra: Parameters<typeof buildUserFormModel>[0]): Promise<RouteResult> =>
    ({ html: await render("admin/user-form", { model: buildUserFormModel({ csrfToken, menu, user, ...extra }) }) });

  // /admin/users  — list (GET) · create (POST)
  if (seg.length === 0) {
    if (method === "GET") return renderList();
    if (method === "POST") {
      const input = readUserInput(form!);
      try {
        await kratosAdmin.createIdentity(createIdentityPayload(input));
      } catch (err) {
        if (err instanceof KratosError) return { ...(await renderForm({ error: createError(err), values: input })), status: 400 };
        throw err;
      }
      return { redirect: ADMIN_USERS_BASE };
    }
    return null;
  }

  // /admin/users/new — create form
  if (seg.length === 1 && seg[0] === "new" && method === "GET") return renderForm({});

  // /admin/users/:id …
  const targetId = decodeURIComponent(seg[0]!);
  const identity = await kratosAdmin.getIdentity(targetId);
  if (!identity) return { html: await render("404", { title: "Not found" }), status: 404 };
  const back = `${ADMIN_USERS_BASE}/${encodeURIComponent(targetId)}`;

  if (seg.length === 1) {
    if (method === "GET") return renderForm({ identity });
    if (method === "POST") {
      try {
        await kratosAdmin.updateIdentity(targetId, updateIdentityPayload(identity, readUserInput(form!)));
      } catch (err) {
        if (err instanceof KratosError) return { ...(await renderForm({ error: "Could not save changes — check the fields and try again.", identity })), status: 400 };
        throw err;
      }
      return { redirect: back };
    }
    return null;
  }

  if (seg.length === 2 && method === "POST") {
    if (seg[1] === "state") {
      await kratosAdmin.updateIdentity(targetId, setStatePayload(identity, identity.state === "inactive" ? "active" : "inactive"));
      return { redirect: back };
    }
    if (seg[1] === "delete") {
      await kratosAdmin.deleteIdentity(targetId);
      return { redirect: ADMIN_USERS_BASE };
    }
    if (seg[1] === "recovery") {
      const recovery = await kratosAdmin.createRecoveryCode(targetId);
      return renderForm({ identity, recovery });
    }
  }
  return null;
}

function createError(err: KratosError): string {
  return err.status === 409
    ? "A user with that email already exists."
    : "Could not create the user — check the email and try again.";
}
