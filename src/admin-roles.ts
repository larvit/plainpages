// Built-in Roles & permissions admin screen (todo §5): list / create / delete Keto roles and assign
// them to users and groups. A role is a Keto subject set `Role:<name>#members` (OPL: members are
// users or groups, resolved transitively) — the source of truth for the JWT `roles` claim. It shares
// the user|group membership model of the Groups screen, so the pure helpers (parseSubject, member
// pickers, tuple paging) are reused from admin-groups. The one role-specific piece is the **effective
// access** view: `keto.expand(Role:<name>#members)` returns the membership tree, which we flatten to
// the distinct set of users who hold the role directly or transitively via a group. (The coarse JWT
// projection reads only direct grants per the README's one-read-per-login design; this view is where
// group→role inheritance is surfaced.) Writes go only to Keto; Kratos is read only to label members.
// `handleAdminRoles` is the imperative shell app.ts dispatches to — gated admin-only, CSRF-guarded.

import { ADMIN_PERMISSION, ADMIN_ROLES_BASE, adminNav } from "./admin-nav.ts";
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
  safeDecode,
} from "./admin-groups.ts";
import type { FieldConfig } from "./admin-users.ts";
import { readFormBody } from "./body.ts";
import type { RequestContext, User } from "./context.ts";
import { CSRF_FIELD, verifyCsrfRequest } from "./csrf.ts";
import { GuardError } from "./guards.ts";
import type { ExpandTree, KetoClient, RelationTuple } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import { parseListQuery } from "./list-query.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import { paginate } from "./paginate.ts";
import type { RouteResult } from "./plugin.ts";
import { buildShellContext } from "./shell-context.ts";

const ROLE_NS = "Role";
const MEMBERS = "members";
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];
// Expand far past any sane group-nesting depth so the effective-access view never silently
// under-reports the deepest members (Keto's own default is shallow).
const EXPAND_MAX_DEPTH = 50;

// A role and a group share the URL-safe name rule and the user|group membership model.
export type RoleView = GroupView;
export const isValidRoleName = isValidGroupName;
export const rolesFromTuples = groupsFromTuples;
export interface EffectiveUser {
  label: string; // email (or the raw id when unresolved)
}

// The full membership tuple for assigning/revoking `value` to/from `role` (null if value is invalid).
export function roleMemberTuple(role: string, value: string): RelationTuple | null {
  const subject = parseSubject(value);
  return subject ? { namespace: ROLE_NS, object: role, relation: MEMBERS, ...subject } : null;
}

// Flatten a Keto `expand` tree → the sorted, distinct user ids that effectively hold the role
// (direct leaves + users reached through member groups, any depth). The subject rides on each
// node's `tuple`; subject-set nodes (the groups) contribute nothing directly — their members
// surface as leaves under them.
export function expandToEffectiveUsers(tree: ExpandTree | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (node?: ExpandTree | null): void => {
    if (!node) return;
    const subjectId = node.tuple?.subject_id;
    if (subjectId?.startsWith("user:")) ids.add(subjectId.slice("user:".length));
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

const SORT: Record<string, (r: RoleView) => number | string> = {
  members: (r) => r.memberCount,
  name: (r) => r.name,
};
const COLUMNS = [
  { key: "name", label: "Role" },
  { key: "members", label: "Members" },
];

function detailHref(name: string): string {
  return `${ADMIN_ROLES_BASE}/${encodeURIComponent(name)}`;
}

function listHref(state: ListState, overrides: Partial<ListState> = {}): string {
  const s = { ...state, ...overrides };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.sort) p.set("sort", s.sort);
  if (s.page > 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(s.pageSize));
  const qs = p.toString();
  return qs ? `${ADMIN_ROLES_BASE}?${qs}` : ADMIN_ROLES_BASE;
}

export function buildRolesListModel(opts: {
  csrfToken?: string;
  menu?: MenuConfig;
  roles: RoleView[];
  url: URL | URLSearchParams | string;
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const query = parseListQuery(opts.url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const sort = query.sort && SORT[query.sort.field] ? query.sort : null;
  const sortToken = sort ? (sort.dir === "desc" ? `-${sort.field}` : sort.field) : null;
  const needle = query.q.toLowerCase();

  let list = opts.roles.filter((r) => !needle || r.name.toLowerCase().includes(needle));
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
    filterBar: listFilterBar(state),
    nav: adminNav(opts.user?.roles ?? [], menu, "roles"),
    pagination: listPagination(state, page),
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_ROLES_BASE, label: "Admin" }, { label: "Roles" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "Roles",
      user: opts.user ?? null,
    }),
    table: listTable(rows, state, sort),
  };
}

function listTable(rows: RoleView[], state: ListState, sort: { dir: "asc" | "desc"; field: string } | null) {
  return {
    caption: "Roles",
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
    clearHref: ADMIN_ROLES_BASE,
    label: "Filter roles",
    pills,
    rows: [[
      { label: "Search roles", name: "q", placeholder: "Search role name…", type: "search", value: state.q },
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

export function buildRoleFormModel(opts: {
  csrfToken?: string;
  error?: string;
  memberOptions: MemberOption[];
  menu?: MenuConfig;
  user?: User | null;
  values?: { member?: string; name?: string };
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const nameField: FieldConfig = {
    autocomplete: "off", hint: "Lowercase letters, digits, dashes and underscores.", icon: "i-shield",
    id: "name", label: "Role name", name: "name", required: true, value: opts.values?.name ?? "",
  };
  return {
    error: opts.error,
    form: {
      action: ADMIN_ROLES_BASE,
      cancelHref: ADMIN_ROLES_BASE,
      csrfToken: opts.csrfToken ?? "",
      memberOptions: opts.memberOptions,
      nameField,
      selectedMember: opts.values?.member ?? "",
      submitLabel: "Create role",
    },
    nav: adminNav(opts.user?.roles ?? [], menu, "roles"),
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_ROLES_BASE, label: "Roles" }, { label: "New" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "New role",
      user: opts.user ?? null,
    }),
  };
}

export function buildRoleDetailModel(opts: {
  candidates: MemberOption[];
  csrfToken?: string;
  effective: EffectiveUser[];
  error?: string;
  members: MemberView[];
  menu?: MenuConfig;
  role: { name: string };
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const name = opts.role.name;
  const base = detailHref(name);
  const taken = new Set(opts.members.map((m) => m.subject));
  const options = opts.candidates.filter((c) => !taken.has(c.value)); // members are users/groups, never the role itself
  return {
    add: { action: `${base}/members`, options },
    csrfToken: opts.csrfToken ?? "",
    delete: { action: `${base}/delete` },
    effective: opts.effective,
    error: opts.error,
    members: { action: `${base}/members/delete`, rows: opts.members },
    nav: adminNav(opts.user?.roles ?? [], menu, "roles"),
    role: { name },
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_ROLES_BASE, label: "Roles" }, { label: name }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: name,
      user: opts.user ?? null,
    }),
  };
}

// ---- request handler (imperative shell) ----

export interface AdminRolesDeps {
  csrfSecret: string;
  keto: KetoClient;
  kratosAdmin: KratosAdmin;
  menu: MenuConfig;
  render: (view: string, data: Record<string, unknown>) => Promise<string>;
}

// A role exists exactly while it has ≥1 member (Keto has no create-object).
async function roleExists(keto: KetoClient, name: string): Promise<boolean> {
  const page = await keto.listRelations({ namespace: ROLE_NS, object: name, relation: MEMBERS, pageSize: 1 });
  return page.tuples.length > 0;
}

// The distinct users who effectively hold the role (expand → flatten → label by email). Skipped for
// an empty role (no member tuples) so we don't expand a non-existent Keto object.
async function effectiveUsers(keto: KetoClient, name: string, hasMembers: boolean, emailById: Map<string, string>): Promise<EffectiveUser[]> {
  if (!hasMembers) return [];
  const tree = await keto.expand({ namespace: ROLE_NS, object: name, relation: MEMBERS }, { maxDepth: EXPAND_MAX_DEPTH });
  return expandToEffectiveUsers(tree)
    .map((id) => ({ label: emailById.get(id) ?? `user:${id}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function handleAdminRoles(ctx: RequestContext, csrfToken: string, deps: AdminRolesDeps): Promise<RouteResult | null> {
  const path = ctx.url.pathname;
  if (path !== ADMIN_ROLES_BASE && !path.startsWith(`${ADMIN_ROLES_BASE}/`)) return null;

  if (!ctx.user) throw new GuardError(401, "authentication required", "/login");
  if (!ctx.roles.includes(ADMIN_PERMISSION)) throw new GuardError(403, "admin role required");

  const { keto, kratosAdmin, menu, render } = deps;
  const user = ctx.user;
  const method = (ctx.req.method ?? "GET").toUpperCase();
  const seg = path.slice(ADMIN_ROLES_BASE.length).split("/").filter(Boolean);

  let form: URLSearchParams | undefined;
  if (method === "POST") {
    form = await readFormBody(ctx.req);
    if (!verifyCsrfRequest({ cookieHeader: ctx.req.headers.cookie, secret: deps.csrfSecret, submitted: form.get(CSRF_FIELD) })) {
      throw new GuardError(403, "invalid CSRF token");
    }
  }

  const renderList = async (): Promise<RouteResult> => {
    const roles = rolesFromTuples(await pagedTuples(keto, { namespace: ROLE_NS, relation: MEMBERS }));
    return { html: await render("admin/roles", { model: buildRolesListModel({ csrfToken, menu, roles, url: ctx.url, user }) }) };
  };
  const renderForm = async (extra: { error?: string; values?: { member?: string; name?: string } }): Promise<RouteResult> => {
    const { options } = await memberCandidates(keto, kratosAdmin);
    return { html: await render("admin/role-form", { model: buildRoleFormModel({ csrfToken, memberOptions: options, menu, user, ...extra }) }) };
  };
  const renderDetail = async (name: string): Promise<RouteResult> => {
    const { emailById, options } = await memberCandidates(keto, kratosAdmin);
    const tuples = await pagedTuples(keto, { namespace: ROLE_NS, object: name, relation: MEMBERS });
    const members = tuples.map((t) => memberView(t, emailById));
    const effective = await effectiveUsers(keto, name, tuples.length > 0, emailById);
    return { html: await render("admin/role-detail", { model: buildRoleDetailModel({ candidates: options, csrfToken, effective, members, menu, role: { name }, user }) }) };
  };

  // /admin/roles — list (GET) · create (POST)
  if (seg.length === 0) {
    if (method === "GET") return renderList();
    if (method === "POST") {
      const name = (form!.get("name") ?? "").trim();
      const tuple = roleMemberTuple(name, (form!.get("member") ?? "").trim());
      const reject = (error: string): Promise<RouteResult> =>
        renderForm({ error, values: { member: form!.get("member") ?? "", name } }).then((r) => ({ ...r, status: 400 }));
      if (!isValidRoleName(name)) return reject("Role names use lowercase letters, digits, dashes and underscores.");
      if (!tuple) return reject("Pick a user or group to assign the role to.");
      if (await roleExists(keto, name)) return reject("A role with that name already exists.");
      await keto.writeTuple(tuple);
      return { redirect: detailHref(name) };
    }
    return null;
  }

  // /admin/roles/new — create form
  if (seg.length === 1 && seg[0] === "new" && method === "GET") return renderForm({});

  // /admin/roles/:name …
  const name = safeDecode(seg[0]!);
  if (name === null || !isValidRoleName(name)) return { html: await render("404", { title: "Not found" }), status: 404 };
  const base = detailHref(name);

  if (seg.length === 1 && method === "GET") return renderDetail(name);

  if (seg.length === 2 && seg[1] === "members" && method === "POST") {
    const tuple = roleMemberTuple(name, (form!.get("member") ?? "").trim());
    if (tuple) await keto.writeTuple(tuple); // the picker only offers real users/groups
    return { redirect: base };
  }
  if (seg.length === 2 && seg[1] === "delete" && method === "POST") {
    await keto.deleteTuple({ namespace: ROLE_NS, object: name, relation: MEMBERS }); // removes every member tuple
    return { redirect: ADMIN_ROLES_BASE };
  }
  if (seg.length === 3 && seg[1] === "members" && seg[2] === "delete" && method === "POST") {
    const tuple = roleMemberTuple(name, (form!.get("member") ?? "").trim());
    if (tuple) await keto.deleteTuple(tuple);
    return { redirect: base };
  }
  return null;
}
