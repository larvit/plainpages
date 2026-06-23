// Built-in Groups admin screen (todo §5): list / create / delete Keto groups and manage membership.
// A group is a Keto subject set `Group:<name>#members`; a member is a user or a nested group (see
// parseSubject). Writes go only to Keto (README "stateless"). Keto has no "create object" — a group
// exists exactly while it has ≥1 member, so create writes its first-member tuple and delete removes
// every member tuple. Pure builders turn tuples + the request URL into view models; `handleAdminGroups`
// is the imperative shell app.ts dispatches to — gated admin-only, CSRF-guarded, mapping each action
// to a RouteResult.

import { ADMIN_GROUPS_BASE, buildConfirmModel, guardedForm, requireAdmin } from "./admin-nav.ts";
import type { FieldConfig } from "./admin-users.ts";
import type { RequestContext, User } from "./context.ts";
import type { KetoClient, RelationQuery, RelationTuple, SubjectSet } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import { parseListQuery } from "./list-query.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import type { NavNode } from "./nav.ts";
import { paginate } from "./paginate.ts";
import type { RouteResult } from "./plugin.ts";
import { buildShellContext } from "./shell-context.ts";

const GROUP_NS = "Group";
const MEMBERS = "members";
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];
// One Keto page of candidate users is fetched for the member pickers (mirrors admin-users).
const LIST_FETCH_SIZE = 250;
const GROUP_NAME = /^[a-z0-9][a-z0-9_-]*$/; // URL-safe; doubles as the path segment
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a Kratos identity id

export interface GroupView {
  memberCount: number;
  name: string;
}

// A member's view model: a user (label = email) or a nested group (label = group name). `subject`
// is the form value that round-trips it — `user:<id>` or `group:<name>` (see parseSubject).
export interface MemberView {
  kind: "group" | "user";
  label: string;
  subject: string;
}

// One option in a member <select>.
export interface MemberOption {
  label: string;
  value: string; // `user:<id>` | `group:<name>`
}

export function isValidGroupName(name: string): boolean {
  return name.length <= 64 && GROUP_NAME.test(name);
}

// Map a member-picker value → the Keto subject (subject_id for a user, subject_set for a nested
// group). Returns null for anything unrecognised (a crafted/empty POST).
export function parseSubject(value: string): { subject_id: string } | { subject_set: SubjectSet } | null {
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const rest = value.slice(sep + 1);
  if (!rest) return null;
  // Validate both subject forms so a crafted POST can't write a dangling tuple (the pickers only
  // ever offer real users/groups): a user id is a Kratos UUID, a nested group a valid group name.
  if (value.slice(0, sep) === "user") return UUID.test(rest) ? { subject_id: `user:${rest}` } : null;
  if (value.slice(0, sep) === "group") return isValidGroupName(rest) ? { subject_set: { namespace: GROUP_NS, object: rest, relation: MEMBERS } } : null;
  return null;
}

// The full membership tuple for adding/removing `value` to/from `group` (null if value is invalid).
export function memberTuple(group: string, value: string): RelationTuple | null {
  const subject = parseSubject(value);
  return subject ? { namespace: GROUP_NS, object: group, relation: MEMBERS, ...subject } : null;
}

// Collapse the namespace's membership tuples → distinct groups + member counts, sorted by name.
export function groupsFromTuples(tuples: RelationTuple[]): GroupView[] {
  const counts = new Map<string, number>();
  for (const t of tuples) counts.set(t.object, (counts.get(t.object) ?? 0) + 1);
  return [...counts].map(([name, memberCount]) => ({ memberCount, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function memberView(tuple: RelationTuple, emailById: Map<string, string>): MemberView {
  if (tuple.subject_set) return { kind: "group", label: tuple.subject_set.object, subject: `group:${tuple.subject_set.object}` };
  const subjectId = tuple.subject_id ?? "";
  const id = subjectId.startsWith("user:") ? subjectId.slice("user:".length) : subjectId;
  return { kind: "user", label: emailById.get(id) ?? subjectId, subject: subjectId };
}

// ---- list view model ----

interface ListState {
  page: number;
  pageSize: number;
  q: string;
  sort: string | null;
}

const SORT: Record<string, (g: GroupView) => number | string> = {
  members: (g) => g.memberCount,
  name: (g) => g.name,
};
const COLUMNS = [
  { key: "name", label: "Group" },
  { key: "members", label: "Members" },
];

function detailHref(name: string): string {
  return `${ADMIN_GROUPS_BASE}/${encodeURIComponent(name)}`;
}

function listHref(state: ListState, overrides: Partial<ListState> = {}): string {
  const s = { ...state, ...overrides };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.sort) p.set("sort", s.sort);
  if (s.page > 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(s.pageSize));
  const qs = p.toString();
  return qs ? `${ADMIN_GROUPS_BASE}?${qs}` : ADMIN_GROUPS_BASE;
}

export function buildGroupsListModel(opts: {
  csrfToken?: string;
  groups: GroupView[];
  menu?: MenuConfig;
  nav?: NavNode[];
  url: URL | URLSearchParams | string;
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const query = parseListQuery(opts.url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const sort = query.sort && SORT[query.sort.field] ? query.sort : null;
  const sortToken = sort ? (sort.dir === "desc" ? `-${sort.field}` : sort.field) : null;
  const needle = query.q.toLowerCase();

  let list = opts.groups.filter((g) => !needle || g.name.toLowerCase().includes(needle));
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
    nav: opts.nav ?? [],
    pagination: listPagination(state, page),
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: "Admin" }, { label: "Groups" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "Groups",
      user: opts.user ?? null,
    }),
    table: listTable(rows, state, sort),
  };
}

function listTable(rows: GroupView[], state: ListState, sort: { dir: "asc" | "desc"; field: string } | null) {
  return {
    caption: "Groups",
    columns: COLUMNS.map((c) => {
      const dir = sort && sort.field === c.key ? sort.dir : undefined;
      const next = dir === "asc" ? `-${c.key}` : c.key;
      return { href: listHref(state, { page: 1, sort: next }), label: c.label, sort: dir, sortable: true };
    }),
    rows: rows.map((g) => ({
      cells: [{ rowHeader: { href: detailHref(g.name), text: g.name } }, String(g.memberCount)],
      name: g.name,
    })),
  };
}

function listFilterBar(state: ListState) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: "Search", remove: listHref(state, { page: 1, q: "" }), value: state.q });
  return {
    applyLabel: "Apply",
    clearHref: ADMIN_GROUPS_BASE,
    label: "Filter groups",
    pills,
    rows: [[
      { label: "Search groups", name: "q", placeholder: "Search group name…", type: "search", value: state.q },
      { type: "spacer" },
    ]],
  };
}

function listPagination(state: ListState, page: ReturnType<typeof paginate>) {
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  if (state.sort) hidden.push({ name: "sort", value: state.sort });
  return {
    label: "Groups pagination",
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

export function buildGroupFormModel(opts: {
  csrfToken?: string;
  error?: string;
  memberOptions: MemberOption[];
  menu?: MenuConfig;
  nav?: NavNode[];
  user?: User | null;
  values?: { member?: string; name?: string };
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const nameField: FieldConfig = {
    autocomplete: "off", hint: "Lowercase letters, digits, dashes and underscores.", icon: "i-layers",
    id: "name", label: "Group name", name: "name", required: true, value: opts.values?.name ?? "",
  };
  return {
    error: opts.error,
    form: {
      action: ADMIN_GROUPS_BASE,
      cancelHref: ADMIN_GROUPS_BASE,
      csrfToken: opts.csrfToken ?? "",
      memberOptions: opts.memberOptions,
      nameField,
      selectedMember: opts.values?.member ?? "",
      submitLabel: "Create group",
    },
    nav: opts.nav ?? [],
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: "Groups" }, { label: "New" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "New group",
      user: opts.user ?? null,
    }),
  };
}

export function buildGroupDetailModel(opts: {
  candidates: MemberOption[];
  csrfToken?: string;
  error?: string;
  group: { name: string };
  members: MemberView[];
  menu?: MenuConfig;
  nav?: NavNode[];
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const name = opts.group.name;
  const base = detailHref(name);
  const taken = new Set(opts.members.map((m) => m.subject));
  const self = `group:${name}`; // a group can't be a member of itself
  const options = opts.candidates.filter((c) => c.value !== self && !taken.has(c.value));
  return {
    add: { action: `${base}/members`, options },
    csrfToken: opts.csrfToken ?? "",
    delete: { action: `${base}/delete` },
    error: opts.error,
    group: { name },
    members: { action: `${base}/members/delete`, rows: opts.members },
    nav: opts.nav ?? [],
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: "Groups" }, { label: name }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: name,
      user: opts.user ?? null,
    }),
  };
}

// ---- request handler (imperative shell) ----

export interface AdminGroupsDeps {
  csrfSecret: string;
  keto: KetoClient;
  kratosAdmin: KratosAdmin;
  menu: MenuConfig;
  render: (view: string, data: Record<string, unknown>) => Promise<string>;
}

// Drain every page of a relation-tuple query. (Reused by the Roles screen — same membership model.)
export async function pagedTuples(keto: KetoClient, query: RelationQuery): Promise<RelationTuple[]> {
  const out: RelationTuple[] = [];
  let pageToken: string | undefined;
  do {
    const page = await keto.listRelations({ ...query, ...(pageToken ? { pageToken } : {}) });
    out.push(...page.tuples);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// Build the member-picker options (every user by email + every existing group) and the id→email map
// detail rows render with. One Kratos page + one Keto scan; ample for an admin tool.
export async function memberCandidates(keto: KetoClient, kratosAdmin: KratosAdmin): Promise<{ emailById: Map<string, string>; options: MemberOption[] }> {
  const { identities } = await kratosAdmin.listIdentities({ pageSize: LIST_FETCH_SIZE });
  const emailById = new Map<string, string>();
  const userOptions: MemberOption[] = [];
  for (const it of identities) {
    const trait = it.traits?.["email"];
    const email = typeof trait === "string" ? trait : it.id;
    emailById.set(it.id, email);
    userOptions.push({ label: email, value: `user:${it.id}` });
  }
  const groups = groupsFromTuples(await pagedTuples(keto, { namespace: GROUP_NS, relation: MEMBERS }));
  return { emailById, options: [...userOptions, ...groups.map((g) => ({ label: `${g.name} (group)`, value: `group:${g.name}` }))] };
}

// A group exists exactly while it has ≥1 member.
async function groupExists(keto: KetoClient, name: string): Promise<boolean> {
  const page = await keto.listRelations({ namespace: GROUP_NS, object: name, relation: MEMBERS, pageSize: 1 });
  return page.tuples.length > 0;
}

// Decode a path segment without letting malformed %-encoding throw (→ caller treats it as not found).
export function safeDecode(seg: string): string | null {
  try { return decodeURIComponent(seg); } catch { return null; }
}

export async function handleAdminGroups(ctx: RequestContext, csrfToken: string, deps: AdminGroupsDeps): Promise<RouteResult | null> {
  const path = ctx.url.pathname;
  if (path !== ADMIN_GROUPS_BASE && !path.startsWith(`${ADMIN_GROUPS_BASE}/`)) return null;

  const user = requireAdmin(ctx); // signed-in admin only (else GuardError → /login or 403)
  const { keto, kratosAdmin, menu, render } = deps;
  const nav = ctx.chrome.nav; // the one global menu, role-filtered + current-marked by the host
  const method = (ctx.req.method ?? "GET").toUpperCase();
  const seg = path.slice(ADMIN_GROUPS_BASE.length).split("/").filter(Boolean);
  const form = await guardedForm(ctx, deps.csrfSecret); // parsed + CSRF-verified on POST, else undefined

  const renderList = async (): Promise<RouteResult> => {
    const groups = groupsFromTuples(await pagedTuples(keto, { namespace: GROUP_NS, relation: MEMBERS }));
    return { html: await render("admin/groups", { model: buildGroupsListModel({ csrfToken, groups, menu, nav, url: ctx.url, user }) }) };
  };
  const renderForm = async (extra: { error?: string; values?: { member?: string; name?: string } }): Promise<RouteResult> => {
    const { options } = await memberCandidates(keto, kratosAdmin);
    return { html: await render("admin/group-form", { model: buildGroupFormModel({ csrfToken, memberOptions: options, menu, nav, user, ...extra }) }) };
  };
  const renderDetail = async (name: string): Promise<RouteResult> => {
    const { emailById, options } = await memberCandidates(keto, kratosAdmin);
    const members = (await pagedTuples(keto, { namespace: GROUP_NS, object: name, relation: MEMBERS })).map((t) => memberView(t, emailById));
    return { html: await render("admin/group-detail", { model: buildGroupDetailModel({ candidates: options, csrfToken, group: { name }, members, menu, nav, user }) }) };
  };

  // /admin/groups — list (GET) · create (POST)
  if (seg.length === 0) {
    if (method === "GET") return renderList();
    if (method === "POST") {
      const name = (form!.get("name") ?? "").trim();
      const tuple = memberTuple(name, (form!.get("member") ?? "").trim());
      const reject = (error: string): Promise<RouteResult> =>
        renderForm({ error, values: { member: form!.get("member") ?? "", name } }).then((r) => ({ ...r, status: 400 }));
      if (!isValidGroupName(name)) return reject("Group names use lowercase letters, digits, dashes and underscores.");
      if (!tuple) return reject("Pick a member to add as the group's first member.");
      if (await groupExists(keto, name)) return reject("A group with that name already exists.");
      await keto.writeTuple(tuple);
      ctx.log.info("admin: group created", { actor: user.id, group: name });
      return { redirect: detailHref(name) };
    }
    return null;
  }

  // /admin/groups/new — create form
  if (seg.length === 1 && seg[0] === "new" && method === "GET") return renderForm({});

  // /admin/groups/:name …
  const name = safeDecode(seg[0]!);
  if (name === null || !isValidGroupName(name)) return { html: await render("404", { title: "Not found" }), status: 404 };
  const base = detailHref(name);

  if (seg.length === 1 && method === "GET") return renderDetail(name);

  if (seg.length === 2 && seg[1] === "members" && method === "POST") {
    const tuple = memberTuple(name, (form!.get("member") ?? "").trim());
    // Skip an invalid member or a self-nest (the picker already excludes both).
    if (tuple && tuple.subject_set?.object !== name) await keto.writeTuple(tuple);
    return { redirect: base };
  }
  if (seg.length === 2 && seg[1] === "delete" && method === "GET") {
    return { html: await render("admin/confirm", { model: buildConfirmModel({
      breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: "Groups" }, { href: base, label: name }, { label: "Delete" }],
      cancelHref: base, confirmAction: `${base}/delete`, confirmLabel: "Delete group", csrfToken,
      menu, message: `Delete group ${name}? This removes the group and all its memberships.`, nav, title: "Delete group", user,
    }) }) };
  }
  if (seg.length === 2 && seg[1] === "delete" && method === "POST") {
    await keto.deleteTuple({ namespace: GROUP_NS, object: name, relation: MEMBERS }); // removes every member tuple
    ctx.log.info("admin: group deleted", { actor: user.id, group: name });
    return { redirect: ADMIN_GROUPS_BASE };
  }
  if (seg.length === 3 && seg[1] === "members" && seg[2] === "delete" && method === "POST") {
    const tuple = memberTuple(name, (form!.get("member") ?? "").trim());
    if (tuple) await keto.deleteTuple(tuple);
    return { redirect: base };
  }
  return null;
}
