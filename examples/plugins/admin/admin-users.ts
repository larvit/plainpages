// Users admin screen: list Kratos identities (filter/sort/paginate) +
// create/edit/deactivate/delete/trigger-recovery. Writes go only to Kratos via the admin client
// (README "stateless"). Pure builders turn identities + the request URL into building-block view
// models; below them are thin per-route handlers (keyed on ctx.params) over a shared `withUser` gate
// — admin-only, CSRF-guarded, each returning a RouteResult (a view, or a redirect after a write — PRG).

import { type Identity, type KratosAdmin, KratosError, paginate, parseListQuery, type RecoveryCode, type RequestContext, type RouteHandler, type RouteResult, type User } from "#plugin-api";
import { ADMIN_USERS_BASE, buildConfirmModel, guardedForm, notFound, requireAdmin, unavailable } from "./admin-shared.ts";

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
  url: URL | URLSearchParams | string;
}) {
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
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Admin" }, { label: "Users" }],
    filterBar: listFilterBar(state, all.length),
    pagination: listPagination(state, page),
    table: listTable(rows, state, sort),
    title: "Users",
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
  recovery?: RecoveryCode;
  values?: Partial<UserInput>;
}) {
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
  if (!editing) fields.push({ autocomplete: "new-password", hint: "Optional — leave blank to have the user set one via a recovery code.", icon: "i-lock", id: "password", label: "Password", name: "password", optional: true, type: "password" });

  return {
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Users" }, { label: editing ? "Edit" : "New" }],
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
    recovery: opts.recovery,
    title: editing ? "Edit user" : "New user",
  };
}

// ---- request handler (imperative shell) ----

function readUserInput(form: URLSearchParams): UserInput {
  return {
    email: (form.get("email") ?? "").trim(),
    first: (form.get("first") ?? "").trim(),
    last: (form.get("last") ?? "").trim(),
    password: form.get("password") ?? "",
  };
}

// Shared per-request deps for the Users screen, resolved by `withUser`: the gate (admin only) and
// the Kratos capability (else a themed 503). Each route below is a thin handler over these.
interface UsersDeps { ctx: RequestContext; kratosAdmin: KratosAdmin; revoke: ((sub: string) => void) | undefined; user: User; }

// Resolve the shared deps, then run `inner`. The route's `permission: "admin"` already gated at the
// host; `requireAdmin` is defence-in-depth and yields the user. GuardError (auth/CSRF) → host maps it.
function withUser(inner: (deps: UsersDeps) => Promise<RouteResult>): RouteHandler {
  return async (ctx) => {
    const user = requireAdmin(ctx);
    const kratosAdmin = ctx.system?.kratosAdmin;
    if (!kratosAdmin) return unavailable(ctx, "Kratos identity admin");
    return inner({ ctx, kratosAdmin, revoke: ctx.system?.revoke, user });
  };
}

// Same, plus the target identity from ctx.params.id (unknown id → themed 404). The router already
// decoded the id and 404s malformed %-encoding, so no manual decode is needed here.
function withTarget(inner: (deps: UsersDeps, identity: Identity, id: string) => Promise<RouteResult>): RouteHandler {
  return withUser(async (deps) => {
    const id = deps.ctx.params["id"] ?? "";
    const identity = await deps.kratosAdmin.getIdentity(id);
    if (!identity) return notFound(deps.ctx);
    return inner(deps, identity, id);
  });
}

const formResult = (ctx: RequestContext, extra: Parameters<typeof buildUserFormModel>[0]): RouteResult =>
  ({ data: { chrome: ctx.chrome, model: buildUserFormModel({ csrfToken: ctx.chrome.csrfToken, ...extra }) }, view: "user-form" });

// GET /admin/users — the filtered/sorted/paged list.
export const usersList = withUser(async ({ ctx, kratosAdmin }) => {
  const { identities } = await kratosAdmin.listIdentities({ pageSize: LIST_FETCH_SIZE });
  return { data: { chrome: ctx.chrome, model: buildUsersListModel({ csrfToken: ctx.chrome.csrfToken, identities, url: ctx.url }) }, view: "users" };
});

// POST /admin/users — create; a Kratos 4xx re-renders the form (400), keeping the input.
export const usersCreate = withUser(async ({ ctx, kratosAdmin, user }) => {
  const input = readUserInput((await guardedForm(ctx))!);
  try {
    await kratosAdmin.createIdentity(createIdentityPayload(input));
  } catch (err) {
    if (err instanceof KratosError) return { ...formResult(ctx, { error: createError(err), values: input }), status: 400 };
    throw err;
  }
  ctx.log.info("admin: user created", { actor: user.id, email: input.email });
  return { redirect: ADMIN_USERS_BASE };
});

// GET /admin/users/new — the empty create form.
export const usersNewForm = withUser(({ ctx }) => Promise.resolve(formResult(ctx, {})));

// GET /admin/users/:id — the edit form, prefilled.
export const usersEditForm = withTarget((deps, identity) => Promise.resolve(formResult(deps.ctx, { identity })));

// POST /admin/users/:id — save edits; a Kratos 4xx re-renders the form (400).
export const usersUpdate = withTarget(async ({ ctx, kratosAdmin }, identity, id) => {
  const input = readUserInput((await guardedForm(ctx))!);
  try {
    await kratosAdmin.updateIdentity(id, updateIdentityPayload(identity, input));
  } catch (err) {
    if (err instanceof KratosError) return { ...formResult(ctx, { error: "Could not save changes — check the fields and try again.", identity }), status: 400 };
    throw err;
  }
  return { redirect: `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}` };
});

// POST /admin/users/:id/state — toggle active/inactive; a deactivation revokes the target's live
// tokens now (not after the JWT TTL). Self-protection: an admin can't deactivate their own account.
export const usersState = withTarget(async ({ ctx, kratosAdmin, revoke, user }, identity, id) => {
  await guardedForm(ctx); // CSRF-verify the POST (no fields read)
  if (id === user.id) return { ...formResult(ctx, { error: "You can't deactivate your own account.", identity }), status: 400 };
  const nextState = identity.state === "inactive" ? "active" : "inactive";
  await kratosAdmin.updateIdentity(id, setStatePayload(identity, nextState));
  if (nextState === "inactive") revoke?.(id);
  ctx.log.info("admin: user state changed", { actor: user.id, state: nextState, target: id });
  return { redirect: `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}` };
});

// GET /admin/users/:id/delete — the deliberate confirm step (zero-JS). Refuses self-delete.
export const usersDeleteConfirm = withTarget((deps, identity, id) => {
  if (id === deps.user.id) return Promise.resolve({ ...formResult(deps.ctx, { error: "You can't delete your own account.", identity }), status: 400 });
  const back = `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}`;
  const view = toUserView(identity);
  return Promise.resolve({ data: { chrome: deps.ctx.chrome, model: buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Users" }, { href: back, label: view.name }, { label: "Delete" }],
    cancelHref: back, confirmAction: `${back}/delete`, confirmLabel: "Delete user",
    message: `Delete ${view.email}? This permanently removes the account and can't be undone.`, title: "Delete user",
  }) }, view: "confirm" });
});

// POST /admin/users/:id/delete — perform it; revoke the gone account's live tokens. Refuses self-delete.
export const usersDelete = withTarget(async ({ ctx, kratosAdmin, revoke, user }, identity, id) => {
  await guardedForm(ctx); // CSRF-verify the POST
  if (id === user.id) return { ...formResult(ctx, { error: "You can't delete your own account.", identity }), status: 400 };
  await kratosAdmin.deleteIdentity(id);
  revoke?.(id);
  ctx.log.info("admin: user deleted", { actor: user.id, target: id });
  return { redirect: ADMIN_USERS_BASE };
});

// POST /admin/users/:id/recovery — mint a one-time recovery code, shown on the edit page.
export const usersRecovery = withTarget(async ({ ctx, kratosAdmin }, identity, id) => {
  await guardedForm(ctx); // CSRF-verify the POST
  const recovery = await kratosAdmin.createRecoveryCode(id);
  return formResult(ctx, { identity, recovery });
});

function createError(err: KratosError): string {
  return err.status === 409
    ? "A user with that email already exists."
    : "Could not create the user — check the email and try again.";
}
