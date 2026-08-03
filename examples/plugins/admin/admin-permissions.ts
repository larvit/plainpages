// Permissions admin screen: list / create / delete Keto permissions and assign
// them to users and groups. A permission is a Keto subject set `Permission:<name>#members` (OPL: members are users
// or groups, resolved transitively) — the source of truth for the JWT `permissions` claim. It shares the
// Groups screen's membership model, so the pure helpers (parseSubject, member pickers, tuple paging)
// are reused from admin-groups. The permission-specific piece is the **effective access** view:
// `keto.expand(Permission:<name>#members)` flattened to the distinct users who hold the permission directly or via
// a group — matching what login projects into the JWT (login.ts readPermissions). Writes go only to Keto;
// Kratos is read only to label members. Below the builders are thin per-route handlers (keyed on
// ctx.params) over a shared `withRoles` gate — admin-only, CSRF-guarded.

import { type ExpandTree, type KetoClient, type KratosAdmin, paginate, parseListQuery, type RelationTuple, type RequestContext, type RouteHandler, type RouteResult, type SessionIdentity } from "#plugin-api";
import { ADMIN_PERMISSION, ADMIN_PERMISSIONS_BASE, buildConfirmModel, guardedForm, notFound, requireAdmin, unavailable } from "./admin-shared.ts";
import {
  type GroupView,
  groupsFromTuples,
  isValidGroupName,
  memberCandidates,
  type MemberOption,
  type MemberView,
  memberView,
  pagedTuples,
  parseSubject,
} from "./admin-groups.ts";
import type { FieldConfig } from "./admin-users.ts";

const PERMISSION_NS = "Permission";
const GRANTED = "granted";
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];
// Expand far past any sane group-nesting depth so the effective-access view never silently
// under-reports the deepest members (Keto's own default is shallow).
const EXPAND_MAX_DEPTH = 50;

// A permission and a group share the URL-safe name rule and the user|group membership model.
export type PermissionView = GroupView;
export const isValidRoleName = isValidGroupName;
export const permissionsFromTuples = groupsFromTuples;
export interface EffectiveUser {
  label: string; // email (or the raw id when unresolved)
}

// The full membership tuple for assigning/revoking `value` to/from `permission` (null if value is invalid).
export function permissionGrantTuple(permission: string, value: string): RelationTuple | null {
  const subject = parseSubject(value);
  return subject ? { namespace: PERMISSION_NS, object: permission, relation: GRANTED, ...subject } : null;
}

// Flatten a Keto `expand` tree → the sorted, distinct user ids that effectively hold the permission
// (direct leaves + users reached through member groups, any depth). The subject rides on each
// node's `tuple`; subject-set nodes (the groups) contribute nothing directly — their members
// surface as leaves under them.
export function expandToEffectiveUsers(tree: ExpandTree | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (node?: ExpandTree | null): void => {
    if (!node) return;
    const subjectId = node.tuple?.subject_id;
    if (subjectId?.startsWith("identity:")) ids.add(subjectId.slice("identity:".length));
    node.children?.forEach(walk);
  };
  walk(tree);
  return [...ids].sort();
}

// ---- list view model ----

interface ListState {
  page: number;
  pageSize: number;
  q: string;
  sort: string | null;
}

const SORT: Record<string, (r: PermissionView) => number | string> = {
  members: (r) => r.memberCount,
  name: (r) => r.name,
};
const COLUMNS = [
  { key: "name", label: "Permission" },
  { key: "members", label: "Members" },
];

function detailHref(name: string): string {
  return `${ADMIN_PERMISSIONS_BASE}/${encodeURIComponent(name)}`;
}

function listHref(state: ListState, overrides: Partial<ListState> = {}): string {
  const s = { ...state, ...overrides };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.sort) p.set("sort", s.sort);
  if (s.page > 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(s.pageSize));
  const qs = p.toString();
  return qs ? `${ADMIN_PERMISSIONS_BASE}?${qs}` : ADMIN_PERMISSIONS_BASE;
}

export function buildPermissionsListModel(opts: {
  csrfToken?: string;
  permissions: PermissionView[];
  url: URL | URLSearchParams | string;
}) {
  const query = parseListQuery(opts.url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const sort = query.sort && SORT[query.sort.field] ? query.sort : null;
  const sortToken = sort ? (sort.dir === "desc" ? `-${sort.field}` : sort.field) : null;
  const needle = query.q.toLowerCase();

  let list = opts.permissions.filter((r) => !needle || r.name.toLowerCase().includes(needle));
  if (sort) {
    const get = SORT[sort.field]!;
    const dir = sort.dir === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => {
      const av = get(a), bv = get(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return cmp * dir;
    });
  }

  const page = paginate(list.length, query.page, query.pageSize, { boundaries: 1, siblings: 1 });
  const start = (page.page - 1) * page.pageSize;
  const rows = list.slice(start, start + page.pageSize);
  const state: ListState = { page: page.page, pageSize: page.pageSize, q: query.q, sort: sortToken };

  return {
    breadcrumbs: [{ href: ADMIN_PERMISSIONS_BASE, label: "Admin" }, { label: "Permissions" }],
    filterBar: listFilterBar(state),
    pagination: listPagination(state, page),
    table: listTable(rows, state, sort),
    title: "Permissions",
  };
}

function listTable(rows: PermissionView[], state: ListState, sort: { dir: "asc" | "desc"; field: string } | null) {
  return {
    caption: "Permissions",
    columns: COLUMNS.map((c) => {
      const dir = sort && sort.field === c.key ? sort.dir : undefined;
      const next = dir === "asc" ? `-${c.key}` : c.key;
      return { href: listHref(state, { page: 1, sort: next }), label: c.label, sort: dir, sortable: true };
    }),
    rows: rows.map((r) => ({
      cells: [{ rowHeader: { href: detailHref(r.name), text: r.name } }, String(r.memberCount)],
      name: r.name,
    })),
  };
}

function listFilterBar(state: ListState) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: "Search", remove: listHref(state, { page: 1, q: "" }), value: state.q });
  return {
    applyLabel: "Apply",
    clearHref: ADMIN_PERMISSIONS_BASE,
    label: "Filter permissions",
    pills,
    rows: [[
      { label: "Search permissions", name: "q", placeholder: "Search permission name…", type: "search", value: state.q },
      { type: "spacer" },
    ]],
  };
}

function listPagination(state: ListState, page: ReturnType<typeof paginate>) {
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  if (state.sort) hidden.push({ name: "sort", value: state.sort });
  return {
    label: "Roles pagination",
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

// ---- create form + detail view models ----

export function buildPermissionFormModel(opts: {
  csrfToken?: string;
  error?: string;
  memberOptions: MemberOption[];
  values?: { member?: string; name?: string };
}) {
  const nameField: FieldConfig = {
    autocomplete: "off", hint: "Lowercase letters, digits, dashes and underscores.", icon: "i-shield",
    id: "name", label: "Permission name", name: "name", required: true, value: opts.values?.name ?? "",
  };
  return {
    breadcrumbs: [{ href: ADMIN_PERMISSIONS_BASE, label: "Permissions" }, { label: "New" }],
    error: opts.error,
    form: {
      action: ADMIN_PERMISSIONS_BASE,
      cancelHref: ADMIN_PERMISSIONS_BASE,
      csrfToken: opts.csrfToken ?? "",
      memberOptions: opts.memberOptions,
      nameField,
      selectedMember: opts.values?.member ?? "",
      submitLabel: "Create permission",
    },
    title: "New permission",
  };
}

export function buildPermissionDetailModel(opts: {
  candidates: MemberOption[];
  csrfToken?: string;
  effective: EffectiveUser[];
  error?: string;
  members: MemberView[];
  permission: { name: string };
}) {
  const name = opts.permission.name;
  const base = detailHref(name);
  const taken = new Set(opts.members.map((m) => m.subject));
  const options = opts.candidates.filter((c) => !taken.has(c.value)); // members are users/groups, never the permission itself
  return {
    add: { action: `${base}/members`, options },
    breadcrumbs: [{ href: ADMIN_PERMISSIONS_BASE, label: "Permissions" }, { label: name }],
    csrfToken: opts.csrfToken ?? "",
    delete: { action: `${base}/delete` },
    effective: opts.effective,
    error: opts.error,
    members: { action: `${base}/members/delete`, rows: opts.members },
    permission: { name },
    title: name,
  };
}

// ---- request handler (imperative shell) ----

// instant-revoke: a permission change for a `identity:<id>` member must take effect now, so revoke that
// user's live tokens (a re-mint then re-reads permissions from Keto). A `group:<name>` change is
// transitive across many users — left to lag (documented), so only direct user members revoke.
function revokeUserMember(revoke: ((sub: string) => void) | undefined, member: string): void {
  if (revoke && member.startsWith("identity:")) revoke(member.slice("identity:".length));
}

// A permission exists exactly while it has ≥1 member (Keto has no create-object).
async function roleExists(keto: KetoClient, name: string): Promise<boolean> {
  const page = await keto.listRelations({ namespace: PERMISSION_NS, object: name, relation: GRANTED, pageSize: 1 });
  return page.tuples.length > 0;
}

// The distinct users who effectively hold the permission (expand → flatten → label by email). Skipped for
// an empty permission (no member tuples) so we don't expand a non-existent Keto object.
async function effectiveUsers(keto: KetoClient, name: string, hasMembers: boolean, emailById: Map<string, string>): Promise<EffectiveUser[]> {
  if (!hasMembers) return [];
  const tree = await keto.expand({ namespace: PERMISSION_NS, object: name, relation: GRANTED }, { maxDepth: EXPAND_MAX_DEPTH });
  return expandToEffectiveUsers(tree)
    .map((id) => ({ label: emailById.get(id) ?? `identity:${id}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Shared per-request deps for the Roles screen, resolved by `withRoles`: the gate + the Keto and
// Kratos capabilities (else a themed 503). Each route below is a thin handler over these.
interface RolesDeps { ctx: RequestContext; keto: KetoClient; kratosAdmin: KratosAdmin; revoke: ((sub: string) => void) | undefined; user: SessionIdentity; }

function withRoles(inner: (deps: RolesDeps) => Promise<RouteResult>): RouteHandler {
  return async (ctx) => {
    const user = requireAdmin(ctx);
    const keto = ctx.system?.keto;
    const kratosAdmin = ctx.system?.kratosAdmin;
    if (!keto || !kratosAdmin) return unavailable(ctx, "Keto and Kratos identity admin");
    return inner({ ctx, keto, kratosAdmin, revoke: ctx.system?.revoke, user });
  };
}

// Same, plus the validated :name from ctx.params (an invalid permission name → themed 404).
function withRoleName(inner: (deps: RolesDeps, name: string) => Promise<RouteResult>): RouteHandler {
  return withRoles((deps) => {
    const name = deps.ctx.params["name"] ?? "";
    if (!isValidRoleName(name)) return Promise.resolve(notFound(deps.ctx));
    return inner(deps, name);
  });
}

const roleFormResult = async (deps: RolesDeps, extra: { error?: string; values?: { member?: string; name?: string } }): Promise<RouteResult> => {
  const { options } = await memberCandidates(deps.keto, deps.kratosAdmin);
  return { data: { chrome: deps.ctx.chrome, model: buildPermissionFormModel({ csrfToken: deps.ctx.chrome.csrfToken, memberOptions: options, ...extra }) }, view: "permission-form" };
};

// The permission detail (members + effective access). With `error` set it's a 400 (a rejected action).
const roleDetailResult = async (deps: RolesDeps, name: string, error?: string): Promise<RouteResult> => {
  const { emailById, options } = await memberCandidates(deps.keto, deps.kratosAdmin);
  const tuples = await pagedTuples(deps.keto, { namespace: PERMISSION_NS, object: name, relation: GRANTED });
  const members = tuples.map((t) => memberView(t, emailById));
  const effective = await effectiveUsers(deps.keto, name, tuples.length > 0, emailById);
  const result: RouteResult = { data: { chrome: deps.ctx.chrome, model: buildPermissionDetailModel({ candidates: options, csrfToken: deps.ctx.chrome.csrfToken, effective, members, permission: { name }, ...(error ? { error } : {}) }) }, view: "permission-detail" };
  return error ? { ...result, status: 400 } : result;
};

// GET /admin/permissions — the list.
export const rolesList = withRoles(async ({ ctx, keto }) => {
  const permissions = permissionsFromTuples(await pagedTuples(keto, { namespace: PERMISSION_NS, relation: GRANTED }));
  return { data: { chrome: ctx.chrome, model: buildPermissionsListModel({ csrfToken: ctx.chrome.csrfToken, permissions, url: ctx.url }) }, view: "permissions" };
});

// POST /admin/permissions — create + assign the first member (a *user* grant revokes their live tokens).
export const rolesCreate = withRoles(async (deps) => {
  const { ctx, keto, revoke, user } = deps;
  const form = (await guardedForm(ctx))!;
  const name = (form.get("name") ?? "").trim();
  const member = (form.get("member") ?? "").trim();
  const tuple = permissionGrantTuple(name, member);
  const reject = async (error: string): Promise<RouteResult> => ({ ...(await roleFormResult(deps, { error, values: { member, name } })), status: 400 });
  if (!isValidRoleName(name)) return reject("Permission names use lowercase letters, digits, dashes and underscores.");
  if (!tuple) return reject("Pick a user or group to assign the permission to.");
  if (await roleExists(keto, name)) return reject("A permission with that name already exists.");
  await keto.writeTuple(tuple);
  revokeUserMember(revoke, member);
  ctx.log.info("admin: permission created + first member assigned", { actor: user.id, member, permission: name });
  return { redirect: detailHref(name) };
});

// GET /admin/permissions/new — the create form.
export const rolesNewForm = withRoles((deps) => roleFormResult(deps, {}));

// GET /admin/permissions/:name — the detail (members + effective access via Keto expand).
export const rolesDetail = withRoleName((deps, name) => roleDetailResult(deps, name));

// POST /admin/permissions/:name/members — assign a user/group; a *user* grant revokes their live tokens.
export const rolesAddMember = withRoleName(async (deps, name) => {
  const { ctx, keto, revoke, user } = deps;
  const form = (await guardedForm(ctx))!;
  const member = (form.get("member") ?? "").trim();
  const tuple = permissionGrantTuple(name, member); // the picker only offers real users/groups
  if (tuple) { await keto.writeTuple(tuple); revokeUserMember(revoke, member); ctx.log.info("admin: permission assigned", { actor: user.id, member, permission: name }); }
  return { redirect: detailHref(name) };
});

// GET /admin/permissions/:name/delete — confirm, except the admin permission can't be deleted.
export const rolesDeleteConfirm = withRoleName((deps, name) => {
  if (name === ADMIN_PERMISSION) return roleDetailResult(deps, name, "The admin permission can't be deleted — it would remove all admin access.");
  const base = detailHref(name);
  return Promise.resolve({ data: { chrome: deps.ctx.chrome, model: buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_PERMISSIONS_BASE, label: "Permissions" }, { href: base, label: name }, { label: "Delete" }],
    cancelHref: base, confirmAction: `${base}/delete`, confirmLabel: "Delete permission",
    message: `Delete permission ${name}? This revokes it from everyone it's assigned to.`, title: "Delete permission",
  }) }, view: "confirm" });
});

// POST /admin/permissions/:name/delete — remove every member tuple (a whole-permission delete lags per the
// documented instant-revoke tradeoff; the admin permission is protected).
export const rolesDelete = withRoleName(async (deps, name) => {
  const { ctx, keto, user } = deps;
  await guardedForm(ctx); // CSRF-verify the POST
  if (name === ADMIN_PERMISSION) return roleDetailResult(deps, name, "The admin permission can't be deleted — it would remove all admin access.");
  await keto.deleteTuple({ namespace: PERMISSION_NS, object: name, relation: GRANTED });
  ctx.log.info("admin: permission deleted", { actor: user.id, permission: name });
  return { redirect: ADMIN_PERMISSIONS_BASE };
});

// POST /admin/permissions/:name/members/delete — unassign; a *user* unassign revokes their live tokens.
// Self-protection: an admin can't revoke their own *direct* admin grant (a group-held admin isn't
// covered — the robust "last effective admin" check is deferred).
export const rolesRemoveMember = withRoleName(async (deps, name) => {
  const { ctx, keto, revoke, user } = deps;
  const form = (await guardedForm(ctx))!;
  const member = (form.get("member") ?? "").trim();
  if (name === ADMIN_PERMISSION && member === `identity:${user.id}`) return roleDetailResult(deps, name, "You can't revoke your own admin access.");
  const tuple = permissionGrantTuple(name, member);
  if (tuple) { await keto.deleteTuple(tuple); revokeUserMember(revoke, member); ctx.log.info("admin: permission unassigned", { actor: user.id, member, permission: name }); }
  return { redirect: detailHref(name) };
});
