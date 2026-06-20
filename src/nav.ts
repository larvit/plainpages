// composeNav (todo §1): merge each plugin's nav fragment into one tree, apply the central
// override, then permission-filter per user. Pure and I/O-free — menu gating reads the JWT
// `roles` claim (README "The menu system"), never Keto. A node is visible iff it is `public`, or
// declares no `permission`, or `roles` includes that permission token; a gated header hides its whole
// subtree, and a pure header left with no children is dropped. The §2 config/menu.ts supplies
// the override (+ branding); this helper only transforms data, so its result is per-deployment
// up to the final role filter and emits clean nodes ready for nav-tree.ejs (no id/permission).

export interface NavNode {
  id?: string; // stable key for override targeting; stripped from the rendered tree
  children?: NavNode[];
  count?: number;
  current?: boolean;
  href?: string;
  icon?: string;
  label: string;
  open?: boolean;
  permission?: string; // required role token; consumed by the filter, never rendered
  public?: boolean; // §10: show to everyone, signed in or not — the blessed alias for "no permission", stated outright; consumed by the filter, never rendered. Mutually exclusive with permission (discovery refuses both).
}

// Central override (config/menu.ts, §2). Targets nodes by `id`; applied rename → group →
// order → hide, then the per-user permission filter runs last.
export interface NavOverride {
  groups?: NavGroupSpec[]; // wrap top-level nodes (by id) under a new header
  hide?: string[]; // remove nodes by id, at any depth (incl. a group's id)
  order?: string[]; // reorder top-level nodes by id; unlisted keep their order, after
  rename?: Record<string, string>; // id → replacement label
}

export interface NavGroupSpec {
  id: string;
  children: string[]; // ids of top-level nodes to pull under the group, in this order
  icon?: string;
  label: string;
  open?: boolean;
}

export function composeNav(
  fragments: NavNode[][] = [],
  override: NavOverride = {},
  roles: string[] = [],
): NavNode[] {
  let nodes: NavNode[] = fragments.flat();
  if (override.rename) nodes = renameTree(nodes, override.rename);
  if (override.groups?.length) nodes = applyGroups(nodes, override.groups);
  if (override.order?.length) nodes = applyOrder(nodes, override.order);
  if (override.hide?.length) nodes = hideTree(nodes, new Set(override.hide));
  return filterByRoles(nodes, new Set(roles)).map(toRenderNode);
}

function renameTree(nodes: NavNode[], rename: Record<string, string>): NavNode[] {
  return nodes.map((n) => {
    const renamed = n.id != null ? rename[n.id] : undefined;
    return {
      ...n,
      label: renamed != null ? renamed : n.label,
      ...(n.children ? { children: renameTree(n.children, rename) } : {}),
    };
  });
}

// Top-level only: each group becomes a header node placed where its first member sat;
// members are pulled out of the top level into the group, in the group's declared order.
function applyGroups(nodes: NavNode[], groups: NavGroupSpec[]): NavNode[] {
  const ofChild = new Map<string, NavGroupSpec>();
  for (const g of groups) for (const id of g.children) ofChild.set(id, g);
  const byId = new Map(nodes.filter((n) => n.id != null).map((n) => [n.id as string, n]));

  const build = (g: NavGroupSpec): NavNode => ({
    id: g.id,
    label: g.label,
    ...(g.icon ? { icon: g.icon } : {}),
    ...(g.open ? { open: g.open } : {}),
    children: g.children.map((id) => byId.get(id)).filter((n): n is NavNode => n != null),
  });

  const out: NavNode[] = [];
  const emitted = new Set<string>();
  for (const n of nodes) {
    const g = n.id != null ? ofChild.get(n.id) : undefined;
    if (!g) { out.push(n); continue; }
    if (!emitted.has(g.id)) { out.push(build(g)); emitted.add(g.id); }
  }
  return out;
}

function applyOrder(nodes: NavNode[], order: string[]): NavNode[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const rankOf = (n: NavNode): number => (n.id != null && rank.has(n.id) ? (rank.get(n.id) as number) : Infinity);
  return nodes
    .map((n, i) => ({ i, n }))
    .sort((a, b) => rankOf(a.n) - rankOf(b.n) || a.i - b.i) // stable: equal ranks keep input order
    .map((x) => x.n);
}

function hideTree(nodes: NavNode[], hide: Set<string>): NavNode[] {
  const out: NavNode[] = [];
  for (const n of nodes) {
    if (n.id != null && hide.has(n.id)) continue;
    out.push(n.children ? { ...n, children: hideTree(n.children, hide) } : n);
  }
  return out;
}

function filterByRoles(nodes: NavNode[], roles: Set<string>): NavNode[] {
  const out: NavNode[] = [];
  for (const n of nodes) {
    if (n.public !== true && n.permission != null && !roles.has(n.permission)) continue; // gated → drop node + subtree (public always shows)
    if (!n.children) { out.push(n); continue; }
    const children = filterByRoles(n.children, roles);
    if (children.length === 0 && n.href == null) continue; // empty pure header → drop
    out.push({ ...n, children });
  }
  return out;
}

// Strip the helper-only fields (id/permission) and drop absent ones, so the tree is exactly
// what nav-tree.ejs reads.
function toRenderNode(n: NavNode): NavNode {
  const out: NavNode = { label: n.label };
  if (n.icon != null) out.icon = n.icon;
  if (n.href != null) out.href = n.href;
  if (n.count != null) out.count = n.count;
  if (n.current != null) out.current = n.current;
  if (n.open != null) out.open = n.open;
  if (n.children && n.children.length) out.children = n.children.map(toRenderNode);
  return out;
}
