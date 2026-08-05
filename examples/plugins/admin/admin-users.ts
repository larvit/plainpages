// Users admin screen: list Kratos identities (filter/sort/paginate) +
// create/edit/deactivate/delete/trigger-recovery. Pure builders turn identities + the request URL
// into building-block view models; below them are thin per-route handlers keyed on ctx.params, over
// a shared `withUser` gate.

import { can, type Identity, type KetoClient, type KratosAdmin, KratosError, paginate, parseListQuery, type RecoveryCode, type RequestContext, type RouteHandler, type RouteResult, type Translate, type User } from "#plugin-api";
import { applyGrants, buildPermissionPicker, effectivePermissions, grantDiff, heldPermissions, type PermissionPicker, PERMISSIONS_FIELD, userSubject } from "./admin-grants.ts";
import { ADMIN_EN, type AdminAction, ADMIN_USERS_BASE, buildConfirmModel, guardedForm, notFound, permissionName, requirePermission, unavailable } from "./admin-shared.ts";

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
  { key: "name", label: "admin.users.column.name" },
  { key: "email", label: "admin.users.column.email" },
  { key: "status", label: "admin.users.column.status" },
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
  canWrite?: boolean;
  csrfToken?: string;
  identities: Identity[];
  t?: Translate;
  url: URL | URLSearchParams | string;
}) {
  const t = opts.t ?? ADMIN_EN;
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
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: t("admin.nav.section") }, { label: t("admin.users.title") }],
    canWrite: opts.canWrite !== false,
    filterBar: listFilterBar(state, all.length, t),
    pagination: listPagination(state, page, t),
    table: listTable(rows, state, sort, t),
    title: t("admin.users.title"),
  };
}

function listTable(rows: UserView[], state: ListState, sort: { dir: "asc" | "desc"; field: string } | null, t: Translate) {
  return {
    actions: true,
    caption: t("admin.users.title"),
    columns: COLUMNS.map((c) => {
      const dir = sort && sort.field === c.key ? sort.dir : undefined;
      const next = dir === "asc" ? `-${c.key}` : c.key; // asc→desc, else→asc
      return { href: listHref(state, { page: 1, sort: next }), label: t(c.label), sort: dir, sortable: true };
    }),
    rows: rows.map((u) => ({
      actions: [{ href: `${ADMIN_USERS_BASE}/${encodeURIComponent(u.id)}`, icon: "i-edit", label: t("common.edit") }],
      cells: [
        { user: { initials: u.initials, name: u.name } },
        u.email,
        { badge: { label: t(`admin.users.status.${u.state}`), tone: STATE_TONE[u.state] ?? "info" } },
      ],
      name: u.name,
    })),
  };
}

function listFilterBar(state: ListState, total: number, t: Translate) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: t("filter.search"), remove: listHref(state, { page: 1, q: "" }), value: state.q });
  if (state.status !== "all") pills.push({ label: t("admin.users.status.label"), remove: listHref(state, { page: 1, status: "all" }), value: t(`admin.users.status.${state.status}`) });
  return {
    applyLabel: t("filter.apply"), // an untranslated core key still resolves: the host catalog is the fallback
    clearHref: ADMIN_USERS_BASE,
    label: t("admin.users.filter"),
    pills,
    rows: [[
      { label: t("admin.users.searchLabel"), name: "q", placeholder: t("admin.users.searchPlaceholder"), type: "search", value: state.q },
      { legend: t("admin.users.status.label"), name: "status", options: [
        { count: total, label: t("admin.users.status.all"), value: "all" },
        { label: t("admin.users.status.active"), value: "active" },
        { label: t("admin.users.status.inactive"), value: "inactive" },
      ], type: "segmented", value: state.status },
      { type: "spacer" },
    ]],
  };
}

function listPagination(state: ListState, page: ReturnType<typeof paginate>, t: Translate) {
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  if (state.status !== "all") hidden.push({ name: "status", value: state.status });
  if (state.sort) hidden.push({ name: "sort", value: state.sort });
  return {
    label: t("admin.users.pagination"),
    next: { href: page.next ? listHref(state, { page: page.next }) : undefined },
    pages: page.pages.map((p) =>
      p.ellipsis ? { ellipsis: true }
        : p.current ? { current: true, label: String(p.page) }
          : { href: listHref(state, { page: p.page as number }), label: String(p.page) }),
    prev: { href: page.prev ? listHref(state, { page: page.prev }) : undefined },
    rows: { hidden, label: t("pagination.rows"), name: "pageSize", options: PAGE_SIZES, submitLabel: t("pagination.go"), value: state.pageSize },
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
  canWrite?: boolean; // false ⇒ a `users:read` holder: show the state, render no write affordance
  csrfToken?: string;
  error?: string;
  identity?: Identity | null;
  permissions?: PermissionPicker; // editing only — a user that doesn't exist yet can hold nothing
  recovery?: RecoveryCode;
  t?: Translate;
  values?: Partial<UserInput>;
}) {
  const t = opts.t ?? ADMIN_EN;
  const editing = opts.identity != null;
  const view = editing ? toUserView(opts.identity!) : null;
  const np = editing ? nameParts(opts.identity!) : { first: opts.values?.first ?? "", last: opts.values?.last ?? "" };
  const email = editing ? view!.email : (opts.values?.email ?? "");
  const idPath = editing ? `${ADMIN_USERS_BASE}/${encodeURIComponent(view!.id)}` : ADMIN_USERS_BASE;

  const fields: FieldConfig[] = [
    { autocomplete: "email", icon: "i-mail", id: "email", label: t("admin.users.field.email"), name: "email", required: !editing, type: "email", value: email,
      ...(editing ? { hint: t("admin.users.field.emailHint"), readonly: true } : {}) },
    { id: "first", label: t("admin.users.field.first"), name: "first", optional: true, value: np.first },
    { id: "last", label: t("admin.users.field.last"), name: "last", optional: true, value: np.last },
  ];
  if (!editing) fields.push({ autocomplete: "new-password", hint: t("admin.users.field.passwordHint"), icon: "i-lock", id: "password", label: t("admin.users.field.password"), name: "password", optional: true, type: "password" });

  const canWrite = opts.canWrite !== false;
  return {
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: t("admin.users.title") }, { label: editing ? t("common.edit") : t("common.new") }],
    canWrite, // the view drops every write affordance when false; the host already 403s the POSTs
    edit: editing ? {
      deleteAction: `${idPath}/delete`,
      id: view!.id,
      nextLabel: view!.state === "inactive" ? t("admin.users.reactivate") : t("admin.users.deactivate"),
      recoveryAction: `${idPath}/recovery`,
      state: view!.state,
      stateAction: `${idPath}/state`,
    } : undefined,
    error: opts.error,
    form: { action: idPath, cancelHref: ADMIN_USERS_BASE, csrfToken: opts.csrfToken ?? "", fields, submitLabel: editing ? t("admin.users.save") : t("admin.users.create") },
    permissions: editing ? opts.permissions : undefined,
    recovery: opts.recovery,
    title: editing ? t("admin.users.edit") : t("admin.users.new"),
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

// Shared per-request deps for the Users screen, resolved by `withUser`: the gate (`users:read` on a
// GET, `users:write` on a POST) and the Kratos capability (else a themed 503). Each route below is a
// thin handler over these.
// `keto` is optional the way every other capability here is: without it the page still lists and
// edits users, it just can't show the permission picker.
interface UsersDeps { ctx: RequestContext; keto: KetoClient | undefined; kratosAdmin: KratosAdmin; revoke: ((sub: string) => void) | undefined; user: User; }

// Resolve the shared deps, then run `inner`. The route's own `permission` already gated at the host;
// `requirePermission` is defence-in-depth and yields the user. GuardError (auth/CSRF) → host maps it.
function withUser(inner: (deps: UsersDeps) => Promise<RouteResult>, action?: AdminAction): RouteHandler {
  return async (ctx) => {
    const user = requirePermission(ctx, "users", action);
    const kratosAdmin = ctx.system?.kratosAdmin;
    if (!kratosAdmin) return unavailable(ctx, ctx.t("admin.capability.kratos"));
    return inner({ ctx, keto: ctx.system?.keto, kratosAdmin, revoke: ctx.system?.revoke, user });
  };
}

// Same, plus the target identity from ctx.params.id (unknown id → themed 404). The router already
// decoded the id and 404s malformed %-encoding, so no manual decode is needed here.
function withTarget(inner: (deps: UsersDeps, identity: Identity, id: string) => Promise<RouteResult>, action?: AdminAction): RouteHandler {
  return withUser(async (deps) => {
    const id = deps.ctx.params["id"] ?? "";
    const identity = await deps.kratosAdmin.getIdentity(id);
    if (!identity) return notFound(deps.ctx);
    return inner(deps, identity, id);
  }, action);
}

const formResult = (ctx: RequestContext, extra: Parameters<typeof buildUserFormModel>[0]): RouteResult =>
  ({ data: { chrome: ctx.chrome, model: buildUserFormModel({ csrfToken: ctx.chrome.csrfToken, t: ctx.t, ...extra }) }, view: "user-form" });

// GET /admin/users — the filtered/sorted/paged list.
export const usersList = withUser(async ({ ctx, kratosAdmin }) => {
  const { identities } = await kratosAdmin.listIdentities({ pageSize: LIST_FETCH_SIZE });
  return { data: { chrome: ctx.chrome, model: buildUsersListModel({ canWrite: canWriteUsers(ctx), csrfToken: ctx.chrome.csrfToken, identities, t: ctx.t, url: ctx.url }) }, view: "users" };
});

// POST /admin/users — create; a Kratos 4xx re-renders the form (400), keeping the input.
export const usersCreate = withUser(async ({ ctx, kratosAdmin, user }) => {
  const input = readUserInput((await guardedForm(ctx))!);
  try {
    await kratosAdmin.createIdentity(createIdentityPayload(input));
  } catch (err) {
    if (err instanceof KratosError) return { ...formResult(ctx, { error: createError(err, ctx.t), values: input }), status: 400 };
    throw err;
  }
  ctx.log.info("admin: user created", { actor: user.id, email: input.email });
  return { redirect: ADMIN_USERS_BASE };
});

// GET /admin/users/new — the empty create form.
export const usersNewForm = withUser(({ ctx }) => Promise.resolve(formResult(ctx, {})), "write");

// GET /admin/users/:id — the edit form, prefilled.
export const usersEditForm = withTarget(async (deps, identity, id) => {
  const permissions = await userPermissionPicker(deps, id);
  return formResult(deps.ctx, { canWrite: canWriteUsers(deps.ctx), identity, ...(permissions ? { permissions } : {}) });
});

const canWriteUsers = (ctx: RequestContext): boolean => can(ctx, permissionName("users", "write"));

// The checkbox list of declared permissions: ticked where this user holds one, and disabled where
// the grant comes from a group (real, but removed on that group). Undefined when Keto isn't wired —
// the rest of the edit page still works.
async function userPermissionPicker(deps: UsersDeps, id: string, error?: string): Promise<PermissionPicker | undefined> {
  if (!deps.keto) return undefined;
  const subject = userSubject(id);
  const [direct, effective] = await Promise.all([
    heldPermissions(deps.keto, subject),
    effectivePermissions(deps.keto, subject, deps.ctx.declaredPermissions),
  ]);
  return {
    ...buildPermissionPicker({
      action: `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}/permissions`,
      declared: deps.ctx.declaredPermissions,
      direct,
      effective,
      readOnly: !canWriteUsers(deps.ctx),
      t: deps.ctx.t,
    }),
    ...(error ? { error } : {}),
  };
}

// POST /admin/users/:id/permissions — the submitted checkboxes are the desired set of *direct*
// grants; grant what's newly ticked, revoke what's newly unticked. A change to a user's own grants
// revokes their live tokens so it lands now rather than at the next re-mint.
export const usersPermissions = withTarget(async (deps, identity, id) => {
  const { ctx, keto, revoke, user } = deps;
  const form = (await guardedForm(ctx))!;
  if (!keto) return unavailable(ctx, ctx.t("admin.capability.keto"));
  const subject = userSubject(id);
  const diff = grantDiff(ctx.declaredPermissions, await heldPermissions(keto, subject), form.getAll(PERMISSIONS_FIELD));
  // Self-lockout guard, matching the self-deactivate/self-delete ones: revoking your own grants can
  // remove the last `users:write` on the deployment, and the instant-revoke hook lands it on the very
  // next request. Recovery would be a curl against Keto — not something the operator persona can do.
  if (id === user.id && diff.revoke.length > 0) {
    ctx.log.warn("admin: refused a self-revoke of permissions", { actor: user.id, refused: diff.revoke.join(",") });
    const permissions = await userPermissionPicker(deps, id, ctx.t("admin.grants.selfRevoke"));
    return { ...formResult(ctx, { canWrite: canWriteUsers(ctx), identity, ...(permissions ? { permissions } : {}) }), status: 400 };
  }
  await applyGrants(keto, subject, diff);
  if (diff.grant.length > 0 || diff.revoke.length > 0) {
    revoke?.(id);
    ctx.log.info("admin: user permissions changed", { actor: user.id, granted: diff.grant.join(","), revoked: diff.revoke.join(","), target: id });
  }
  return { redirect: `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}` };
});

// POST /admin/users/:id — save edits; a Kratos 4xx re-renders the form (400).
export const usersUpdate = withTarget(async (deps, identity, id) => {
  const { ctx, kratosAdmin } = deps;
  const input = readUserInput((await guardedForm(ctx))!);
  try {
    await kratosAdmin.updateIdentity(id, updateIdentityPayload(identity, input));
  } catch (err) {
    // Re-render with the picker, or the permissions section vanishes off the page on a failed save.
    if (err instanceof KratosError) return { ...formResult(ctx, { canWrite: canWriteUsers(ctx), error: ctx.t("admin.users.error.save"), identity, ...(await pickerOrNothing(deps, id)) }), status: 400 };
    throw err;
  }
  return { redirect: `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}` };
});

// POST /admin/users/:id/state — toggle active/inactive; a deactivation revokes the target's live
// tokens now (not after the JWT TTL). Self-protection: an admin can't deactivate their own account.
export const usersState = withTarget(async ({ ctx, kratosAdmin, revoke, user }, identity, id) => {
  await guardedForm(ctx); // CSRF-verify the POST (no fields read)
  if (id === user.id) return { ...formResult(ctx, { error: ctx.t("admin.users.error.selfDeactivate"), identity }), status: 400 };
  const nextState = identity.state === "inactive" ? "active" : "inactive";
  await kratosAdmin.updateIdentity(id, setStatePayload(identity, nextState));
  if (nextState === "inactive") revoke?.(id);
  ctx.log.info("admin: user state changed", { actor: user.id, state: nextState, target: id });
  return { redirect: `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}` };
});

// GET /admin/users/:id/delete — the deliberate confirm step (zero-JS). Refuses self-delete.
export const usersDeleteConfirm = withTarget((deps, identity, id) => {
  if (id === deps.user.id) return Promise.resolve({ ...formResult(deps.ctx, { error: deps.ctx.t("admin.users.error.selfDelete"), identity }), status: 400 });
  const back = `${ADMIN_USERS_BASE}/${encodeURIComponent(id)}`;
  const view = toUserView(identity);
  const tt = deps.ctx.t;
  return Promise.resolve({ data: { chrome: deps.ctx.chrome, model: buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: tt("admin.users.title") }, { href: back, label: view.name }, { label: tt("common.delete") }],
    cancelHref: back, confirmAction: `${back}/delete`, confirmLabel: tt("admin.users.delete"),
    message: tt("admin.users.deleteMessage", { email: view.email }), title: tt("admin.users.delete"),
  }) }, view: "confirm" });
}, "write");

// POST /admin/users/:id/delete — perform it; revoke the gone account's live tokens. Refuses self-delete.
export const usersDelete = withTarget(async ({ ctx, kratosAdmin, revoke, user }, identity, id) => {
  await guardedForm(ctx); // CSRF-verify the POST
  if (id === user.id) return { ...formResult(ctx, { error: ctx.t("admin.users.error.selfDelete"), identity }), status: 400 };
  await kratosAdmin.deleteIdentity(id);
  revoke?.(id);
  ctx.log.info("admin: user deleted", { actor: user.id, target: id });
  return { redirect: ADMIN_USERS_BASE };
});

// POST /admin/users/:id/recovery — mint a one-time recovery code, shown on the edit page.
export const usersRecovery = withTarget(async (deps, identity, id) => {
  const { ctx, kratosAdmin } = deps;
  await guardedForm(ctx); // CSRF-verify the POST
  const recovery = await kratosAdmin.createRecoveryCode(id);
  return formResult(ctx, { canWrite: canWriteUsers(ctx), identity, recovery, ...(await pickerOrNothing(deps, id)) });
});

// The picker as a spreadable fragment, so a re-render never silently drops the section.
async function pickerOrNothing(deps: UsersDeps, id: string): Promise<{ permissions?: PermissionPicker }> {
  const permissions = await userPermissionPicker(deps, id);
  return permissions ? { permissions } : {};
}

function createError(err: KratosError, t: Translate): string {
  return err.status === 409
    ? t("admin.users.error.duplicate")
    : t("admin.users.error.create");
}
