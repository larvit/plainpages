// Groups admin screen: list / create / delete Keto groups and manage membership.
// A group is a Keto subject set `Group:<name>#members`; a member is a user or a nested group (see
// parseSubject). Writes go only to Keto (README "stateless"). Keto has no "create object" — a group
// exists exactly while it has ≥1 member, so create writes its first-member tuple and delete removes
// every member tuple. Pure builders turn tuples + the request URL into view models; below them are thin
// per-route handlers (keyed on ctx.params) over a shared `withGroups` gate — admin-only, CSRF-guarded,
// each returning a RouteResult.

import { can, type KetoClient, type KratosAdmin, paginate, parseListQuery, type RelationQuery, type RelationTuple, type RequestContext, type RouteHandler, type RouteResult, type SubjectSet, type Translate, type User } from "@plainpages/plugin-api";
import { applyGrants, buildPermissionPicker, effectivePermissions, grantDiff, grantTuple, groupSubject, heldPermissions, type PermissionPicker, PERMISSIONS_FIELD } from "./admin-grants.ts";
import { ADMIN_EN, type AdminAction, ADMIN_GROUPS_BASE, buildConfirmModel, guardedForm, notFound, permissionName, requirePermission, unavailable } from "./admin-shared.ts";
import type { FieldConfig } from "./admin-users.ts";

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
  { key: "name", label: "admin.groups.column.name" },
  { key: "members", label: "admin.groups.column.members" },
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
  canWrite?: boolean;
  csrfToken?: string;
  groups: GroupView[];
  t?: Translate;
  url: URL | URLSearchParams | string;
}) {
  const t = opts.t ?? ADMIN_EN;
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
    breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: t("admin.nav.section") }, { label: t("admin.groups.title") }],
    canWrite: opts.canWrite !== false,
    filterBar: listFilterBar(state, t),
    pagination: listPagination(state, page, t),
    table: listTable(rows, state, sort, t),
    title: t("admin.groups.title"),
  };
}

function listTable(rows: GroupView[], state: ListState, sort: { dir: "asc" | "desc"; field: string } | null, t: Translate) {
  return {
    caption: t("admin.groups.title"),
    columns: COLUMNS.map((c) => {
      const dir = sort && sort.field === c.key ? sort.dir : undefined;
      const next = dir === "asc" ? `-${c.key}` : c.key;
      return { href: listHref(state, { page: 1, sort: next }), label: t(c.label), sort: dir, sortable: true };
    }),
    rows: rows.map((g) => ({
      cells: [{ rowHeader: { href: detailHref(g.name), text: g.name } }, String(g.memberCount)],
      name: g.name,
    })),
  };
}

function listFilterBar(state: ListState, t: Translate) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: t("filter.search"), remove: listHref(state, { page: 1, q: "" }), value: state.q });
  return {
    applyLabel: t("filter.apply"),
    clearHref: ADMIN_GROUPS_BASE,
    label: t("admin.groups.filter"),
    pills,
    rows: [[
      { label: t("admin.groups.searchLabel"), name: "q", placeholder: t("admin.groups.searchPlaceholder"), type: "search", value: state.q },
      { type: "spacer" },
    ]],
  };
}

function listPagination(state: ListState, page: ReturnType<typeof paginate>, t: Translate) {
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  if (state.sort) hidden.push({ name: "sort", value: state.sort });
  return {
    label: t("admin.groups.pagination"),
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

// ---- create form + detail view models ----

export function buildGroupFormModel(opts: {
  csrfToken?: string;
  error?: string;
  memberOptions: MemberOption[];
  t?: Translate;
  values?: { member?: string; name?: string };
}) {
  const t = opts.t ?? ADMIN_EN;
  const nameField: FieldConfig = {
    autocomplete: "off", hint: t("admin.groups.field.nameHint"), icon: "i-layers",
    id: "name", label: t("admin.groups.field.name"), name: "name", required: true, value: opts.values?.name ?? "",
  };
  return {
    breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: t("admin.groups.title") }, { label: t("common.new") }],
    error: opts.error,
    form: {
      action: ADMIN_GROUPS_BASE,
      cancelHref: ADMIN_GROUPS_BASE,
      csrfToken: opts.csrfToken ?? "",
      memberOptions: opts.memberOptions,
      nameField,
      selectedMember: opts.values?.member ?? "",
      submitLabel: t("admin.groups.create"),
    },
    title: t("admin.groups.new"),
  };
}

export function buildGroupDetailModel(opts: {
  canWrite?: boolean; // false ⇒ a `groups:read` holder: show the members, offer no edit
  candidates: MemberOption[];
  csrfToken?: string;
  error?: string;
  group: { name: string };
  members: MemberView[];
  permissions?: PermissionPicker;
  t?: Translate;
}) {
  const t = opts.t ?? ADMIN_EN;
  const name = opts.group.name;
  const base = detailHref(name);
  const taken = new Set(opts.members.map((m) => m.subject));
  const self = `group:${name}`; // a group can't be a member of itself
  const options = opts.candidates.filter((c) => c.value !== self && !taken.has(c.value));
  const canWrite = opts.canWrite !== false;
  return {
    add: { action: `${base}/members`, options },
    breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: t("admin.groups.title") }, { label: name }],
    canWrite, // the view drops add/remove/delete when false; the host already 403s those POSTs
    csrfToken: opts.csrfToken ?? "",
    delete: { action: `${base}/delete` },
    error: opts.error,
    group: { name },
    members: { action: `${base}/members/delete`, rows: opts.members },
    permissions: opts.permissions,
    title: name,
  };
}

// ---- request handler (imperative shell) ----

// Drain every page of a relation-tuple query.
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

// Shared per-request deps for the Groups screen, resolved by `withGroups`: the gate (`groups:read` on
// a GET, `groups:write` on a POST) + the Keto and Kratos capabilities (else a themed 503). Each route
// below is a thin handler over these.
interface GroupsDeps { ctx: RequestContext; keto: KetoClient; kratosAdmin: KratosAdmin; user: User; }

function withGroups(inner: (deps: GroupsDeps) => Promise<RouteResult>, action?: AdminAction): RouteHandler {
  return async (ctx) => {
    const user = requirePermission(ctx, "groups", action);
    const keto = ctx.system?.keto;
    const kratosAdmin = ctx.system?.kratosAdmin;
    if (!keto || !kratosAdmin) return unavailable(ctx, ctx.t("admin.capability.keto"));
    return inner({ ctx, keto, kratosAdmin, user });
  };
}

// Same, plus the validated :name from ctx.params (an invalid group name → themed 404).
function withGroupName(inner: (deps: GroupsDeps, name: string) => Promise<RouteResult>, action?: AdminAction): RouteHandler {
  return withGroups((deps) => {
    const name = deps.ctx.params["name"] ?? "";
    if (!isValidGroupName(name)) return Promise.resolve(notFound(deps.ctx));
    return inner(deps, name);
  }, action);
}

const groupFormResult = async (deps: GroupsDeps, extra: { error?: string; values?: { member?: string; name?: string } }): Promise<RouteResult> => {
  const { options } = await memberCandidates(deps.keto, deps.kratosAdmin);
  return { data: { chrome: deps.ctx.chrome, model: buildGroupFormModel({ csrfToken: deps.ctx.chrome.csrfToken, memberOptions: options, t: deps.ctx.t, ...extra }) }, view: "group-form" };
};

// GET /admin/groups — the list.
export const groupsList = withGroups(async ({ ctx, keto }) => {
  const groups = groupsFromTuples(await pagedTuples(keto, { namespace: GROUP_NS, relation: MEMBERS }));
  return { data: { chrome: ctx.chrome, model: buildGroupsListModel({ canWrite: can(ctx, permissionName("groups", "write")), csrfToken: ctx.chrome.csrfToken, groups, t: ctx.t, url: ctx.url }) }, view: "groups" };
});

// POST /admin/groups — create (a group exists once it has ≥1 member, so this writes the first tuple).
export const groupsCreate = withGroups(async (deps) => {
  const { ctx, keto, user } = deps;
  const form = (await guardedForm(ctx))!;
  const name = (form.get("name") ?? "").trim();
  const member = (form.get("member") ?? "").trim();
  const tuple = memberTuple(name, member);
  const reject = async (error: string): Promise<RouteResult> => ({ ...(await groupFormResult(deps, { error, values: { member, name } })), status: 400 });
  if (!isValidGroupName(name)) return reject(ctx.t("admin.groups.validation.name"));
  if (!tuple) return reject(ctx.t("admin.groups.validation.member"));
  if (await groupExists(keto, name)) return reject("A group with that name already exists.");
  await keto.writeTuple(tuple);
  ctx.log.info("admin: group created", { actor: user.id, group: name });
  return { redirect: detailHref(name) };
});

// GET /admin/groups/new — the create form.
export const groupsNewForm = withGroups((deps) => groupFormResult(deps, {}), "write");

// GET /admin/groups/:name — the detail + membership page.
export const groupsDetail = withGroupName(async ({ ctx, keto, kratosAdmin }, name) => {
  const { emailById, options } = await memberCandidates(keto, kratosAdmin);
  const members = (await pagedTuples(keto, { namespace: GROUP_NS, object: name, relation: MEMBERS })).map((t) => memberView(t, emailById));
  const subject = groupSubject(name);
  const [direct, effective] = await Promise.all([heldPermissions(keto, subject), effectivePermissions(keto, subject, ctx.declaredPermissions)]);
  const permissions = buildPermissionPicker({
    action: `${detailHref(name)}/permissions`,
    declared: ctx.declaredPermissions,
    direct,
    effective, // a group nested in another group inherits its permissions too
    readOnly: !can(ctx, permissionName("groups", "write")),
    t: ctx.t,
    transitive: true, // members inherit, so a change here lands at their next re-mint, not at once
  });
  return { data: { chrome: ctx.chrome, model: buildGroupDetailModel({ canWrite: !permissions.readOnly, candidates: options, csrfToken: ctx.chrome.csrfToken, group: { name }, members, permissions, t: ctx.t }) }, view: "group-detail" };
});

// POST /admin/groups/:name/permissions — the submitted checkboxes are the desired set. Members hold
// a group's permissions transitively, so the change reaches them at their next login or re-mint —
// the documented instant-revoke tradeoff for anything held through a group.
export const groupsPermissions = withGroupName(async ({ ctx, keto, user }, name) => {
  const form = (await guardedForm(ctx))!;
  const subject = groupSubject(name);
  const diff = grantDiff(ctx.declaredPermissions, await heldPermissions(keto, subject), form.getAll(PERMISSIONS_FIELD));
  await applyGrants(keto, subject, diff);
  if (diff.grant.length > 0 || diff.revoke.length > 0) {
    ctx.log.info("admin: group permissions changed", { actor: user.id, granted: diff.grant.join(","), group: name, revoked: diff.revoke.join(",") });
  }
  return { redirect: detailHref(name) };
});

// POST /admin/groups/:name/members — add a member (skip an invalid member or a self-nest).
export const groupsAddMember = withGroupName(async ({ ctx, keto }, name) => {
  const form = (await guardedForm(ctx))!;
  const tuple = memberTuple(name, (form.get("member") ?? "").trim());
  if (tuple && tuple.subject_set?.object !== name) await keto.writeTuple(tuple);
  return { redirect: detailHref(name) };
});

// GET /admin/groups/:name/delete — the deliberate confirm step.
export const groupsDeleteConfirm = withGroupName((deps, name) => {
  const base = detailHref(name);
  const tt = deps.ctx.t;
  return Promise.resolve({ data: { chrome: deps.ctx.chrome, model: buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_GROUPS_BASE, label: tt("admin.groups.title") }, { href: base, label: name }, { label: tt("common.delete") }],
    cancelHref: base, confirmAction: `${base}/delete`, confirmLabel: tt("admin.groups.delete"),
    message: tt("admin.groups.deleteMessage", { name }), title: tt("admin.groups.delete"),
  }) }, view: "confirm" });
}, "write");

// POST /admin/groups/:name/delete — remove every member tuple (the group ceases to exist).
export const groupsDelete = withGroupName(async ({ ctx, keto, user }, name) => {
  await guardedForm(ctx); // CSRF-verify the POST
  // Drop what the group *holds* before what it *contains*: a Keto set exists only through its
  // tuples, so leaving the grants behind would resurrect every permission the moment someone
  // re-created a group with the same name.
  const subject = groupSubject(name);
  const held = await heldPermissions(keto, subject);
  for (const permission of held) await keto.deleteTuple(grantTuple(permission, subject));
  await keto.deleteTuple({ namespace: GROUP_NS, object: name, relation: MEMBERS });
  ctx.log.info("admin: group deleted", { actor: user.id, group: name, revoked: held.join(",") });
  return { redirect: ADMIN_GROUPS_BASE };
});

// POST /admin/groups/:name/members/delete — remove one member.
export const groupsRemoveMember = withGroupName(async ({ ctx, keto }, name) => {
  const form = (await guardedForm(ctx))!;
  const tuple = memberTuple(name, (form.get("member") ?? "").trim());
  if (tuple) await keto.deleteTuple(tuple);
  return { redirect: detailHref(name) };
});
