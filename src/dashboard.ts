// Dashboard view model (todo §1): the app-shell "People" list that replaces the placeholder
// index. Pure — turns a request URL into the data the building-block partials render, wiring
// the §1 helpers end-to-end: parseListQuery → filter/sort/paginate the mock dataset →
// composeNav. The dataset stands in for upstream data until plugins/§4 land; everything below
// is real, so the filter form, sortable headers and pager round-trip through the URL (zero-JS).

import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode, type NavOverride } from "./nav.ts";
import { parseListQuery } from "./list-query.ts";
import { paginate } from "./paginate.ts";

interface Person {
  id: string;
  email: string;
  initials: string;
  lastActive: string;
  name: string;
  role: string;
  status: string;
  team: string;
}

const FIRST = ["Avery", "Blair", "Casey", "Devon", "Emerson", "Finley", "Gray", "Harper", "Iris", "Jordan", "Kai", "Logan", "Morgan", "Noor", "Oakley", "Parker", "Quinn", "Riley", "Sage", "Tatum", "Uma", "Vance", "Wren", "Yuki", "Zarah", "Aria", "Beau", "Cleo", "Dane", "Esme"];
const LAST = ["Kline", "Mora", "Nguyen", "Patel", "Rossi", "Stone", "Vega", "Wu", "Ahmed", "Boyd", "Cruz", "Diaz", "Engel", "Frost", "Gomez", "Hale", "Ito", "Jain", "Khan", "Lund", "Marsh", "Novak", "Ortiz", "Pace", "Reed", "Sato", "Tran", "Udall", "Voss", "Webb"];
const ROLES = ["Admin", "Member", "Viewer"];
const TEAMS = ["Engineering", "Design", "Sales", "Support"];
const STATUSES = ["active", "invited", "suspended"];
const ACTIVE = ["2m ago", "1h ago", "3h ago", "Yesterday", "2d ago", "Last week"];
const TONE: Record<string, string> = { active: "pos", invited: "info", suspended: "warn" };

// Cycle a fixed, non-empty list by index (parallel mock arrays — always in range).
const at = <T>(arr: T[], i: number): T => arr[i % arr.length] as T;

const PEOPLE: Person[] = FIRST.map((first, i) => {
  const last = LAST[i] as string;
  return {
    id: `${first}-${last}`.toLowerCase(),
    email: `${first}.${last}`.toLowerCase() + "@example.com",
    initials: first.charAt(0) + last.charAt(0),
    lastActive: at(ACTIVE, i),
    name: `${first} ${last}`,
    role: at(ROLES, i),
    status: at(STATUSES, i),
    team: at(TEAMS, i),
  };
});

const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZES = [12, 25, 50];
// Sortable columns → the value to compare on (also gates `?sort=` to known fields).
const SORT: Record<string, (p: Person) => string> = {
  email: (p) => p.email, name: (p) => p.name, role: (p) => p.role, status: (p) => p.status, team: (p) => p.team,
};
const COLUMNS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "team", label: "Team", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "lastActive", label: "Last active" },
];

interface State { page: number; pageSize: number; q: string; sort: string | null; status: string; team: string; }

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Canonical list URL from the current state plus per-link overrides; omits defaults so links stay tidy.
function href(state: State, overrides: Partial<State> = {}): string {
  const s = { ...state, ...overrides };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.status && s.status !== "all") p.set("status", s.status);
  if (s.team) p.set("team", s.team);
  if (s.sort) p.set("sort", s.sort);
  if (s.page > 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(s.pageSize));
  const qs = p.toString();
  return qs ? `?${qs}` : "?";
}

export function buildDashboardModel(url: URL | URLSearchParams | string, roles: string[] = [], menu: MenuConfig = DEFAULT_MENU) {
  const query = parseListQuery(url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const status = query.filters.status?.[0] ?? "all";
  const team = query.filters.team?.[0] ?? "";
  const sort = query.sort && SORT[query.sort.field] ? query.sort : null; // ignore unknown fields
  const sortToken = sort ? (sort.dir === "desc" ? `-${sort.field}` : sort.field) : null;
  const needle = query.q.toLowerCase();

  let list = PEOPLE.filter((p) =>
    (!needle || p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)) &&
    (status === "all" || p.status === status) &&
    (!team || p.team === team));
  if (sort) {
    const get = SORT[sort.field] as (p: Person) => string; // gated to known fields above
    const dir = sort.dir === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => get(a).localeCompare(get(b)) * dir);
  }

  const page = paginate(list.length, query.page, query.pageSize, { boundaries: 1, siblings: 1 });
  const start = (page.page - 1) * page.pageSize;
  const rows = list.slice(start, start + page.pageSize);
  const state: State = { page: page.page, pageSize: page.pageSize, q: query.q, sort: sortToken, status, team };

  return {
    filterBar: filterBar(state),
    nav: nav(roles, menu.override),
    pagination: pagination(state, page),
    shell: {
      brand: { name: menu.branding.name, ...(menu.branding.sub != null ? { sub: menu.branding.sub } : {}) },
      breadcrumbs: [{ href: "?", label: "Directory" }, { label: "People" }],
      title: "People",
      user: { email: "sam.rivers@example.com", initials: "SR", name: "Sam Rivers" }, // demo until §4
    },
    table: table(rows, state, sort),
  };
}

export type DashboardModel = ReturnType<typeof buildDashboardModel>;

function nav(roles: string[], override: NavOverride): NavNode[] {
  return composeNav([[
    { count: PEOPLE.length, current: true, href: "/", icon: "i-users", id: "people", label: "People" },
    { href: "#teams", icon: "i-grid", id: "teams", label: "Teams" },
    { children: [
      { href: "#activity", id: "activity", label: "Activity" },
      { href: "#exports", id: "exports", label: "Exports" },
    ], icon: "i-chart", id: "reports", label: "Reports", open: true },
    { href: "#settings", icon: "i-gear", id: "settings", label: "Settings", permission: "admin" },
  ]], override, roles);
}

function table(rows: Person[], state: State, sort: { dir: "asc" | "desc"; field: string } | null) {
  return {
    actions: true,
    caption: "People",
    columns: COLUMNS.map((c) => {
      if (!c.sortable) return { label: c.label };
      const dir = sort && sort.field === c.key ? sort.dir : undefined;
      const next = dir === "asc" ? `-${c.key}` : c.key; // asc→desc, else→asc
      return { href: href(state, { page: 1, sort: next }), label: c.label, sort: dir, sortable: true };
    }),
    rows: rows.map((p) => ({
      cells: [
        { user: { initials: p.initials, name: p.name } },
        p.email,
        p.role,
        p.team,
        { badge: { label: cap(p.status), tone: TONE[p.status] } },
        p.lastActive,
      ],
      name: p.name,
      actions: [
        { href: "#", icon: "i-user", label: "View" },
        { href: "#", icon: "i-edit", label: "Edit" },
        { danger: true, icon: "i-trash", label: "Deactivate", separatorBefore: true },
      ],
    })),
    selectable: true,
  };
}

function filterBar(state: State) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: "Search", remove: href(state, { page: 1, q: "" }), value: state.q });
  if (state.status !== "all") pills.push({ label: "Status", remove: href(state, { page: 1, status: "all" }), value: cap(state.status) });
  if (state.team) pills.push({ label: "Team", remove: href(state, { page: 1, team: "" }), value: state.team });

  return {
    applyLabel: "Apply filters",
    clearHref: "?",
    label: "Filter people",
    pills,
    rows: [[
      { label: "Search people", name: "q", placeholder: "Search people…", type: "search", value: state.q },
      { legend: "Status", name: "status", options: [
        { count: PEOPLE.length, label: "All", value: "all" },
        { label: "Active", value: "active" },
        { label: "Invited", value: "invited" },
        { label: "Suspended", value: "suspended" },
      ], type: "segmented", value: state.status },
      { label: "Team", name: "team", options: [{ label: "All teams", value: "" }, ...TEAMS.map((t) => ({ label: t, value: t }))], type: "select", value: state.team },
      { type: "spacer" },
    ]],
  };
}

function pagination(state: State, page: ReturnType<typeof paginate>) {
  // Hidden inputs carry the list state through the rows-per-page GET form (page resets on change).
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  if (state.status !== "all") hidden.push({ name: "status", value: state.status });
  if (state.team) hidden.push({ name: "team", value: state.team });
  if (state.sort) hidden.push({ name: "sort", value: state.sort });

  return {
    label: "People pagination",
    next: { href: page.next ? href(state, { page: page.next }) : undefined },
    pages: page.pages.map((p) =>
      p.ellipsis ? { ellipsis: true }
        : p.current ? { current: true, label: String(p.page) }
          : { href: href(state, { page: p.page as number }), label: String(p.page) }),
    prev: { href: page.prev ? href(state, { page: page.prev }) : undefined },
    rows: { hidden, label: "Rows", name: "pageSize", options: PAGE_SIZES, submitLabel: "Go", value: state.pageSize },
    summary: { from: page.from, to: page.to, total: page.total },
  };
}
