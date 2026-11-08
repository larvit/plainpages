import type { NavNode } from "../ui/nav.ts";
import { declaredPermissions, fullPath, type Plugin } from "./plugin.ts";
import { envName } from "./settings.ts";

export interface PluginConflict {
  kind: "dashboard" | "home" | "id" | "nav-id" | "permission" | "route" | "setting";
  level: "error" | "warn";
  message: string;
  plugins: string[]; // unique ids involved
}

// Loud resolution, never last-write-wins: discovery throws on any "error" and logs every "warn".
// Mount-path uniqueness needs no rule of its own — it follows from the id check. Shared permission
// names are the one intentional overlap, so they warn rather than error.
export function findConflicts(plugins: Plugin[]): PluginConflict[] {
  const out: PluginConflict[] = [];

  const idCounts = new Map<string, number>();
  for (const plugin of plugins) idCounts.set(plugin.id, (idCounts.get(plugin.id) ?? 0) + 1);
  for (const [id, n] of idCounts) {
    if (n > 1) out.push({ kind: "id", level: "error", message: `${n} plugins share id "${id}"; ids must be globally unique`, plugins: [id] });
  }

  // The landing pages are single slots: "/" (home) and "/dashboard" (dashboard) take one owner
  // each — two plugins claiming either is a loud error, not a race.
  for (const slot of ["home", "dashboard"] as const) {
    const owners = plugins.filter((plugin) => plugin[slot]).map((plugin) => plugin.id);
    if (owners.length > 1) out.push({ kind: slot, level: "error", message: `${owners.length} plugins claim "${slot}" (${owners.join(", ")}); only one may own that page`, plugins: uniq(owners) });
  }

  collect(plugins, (plugin, push) => {
    for (const route of plugin.routes ?? []) push(`${route.method} ${fullPath(plugin.id, route.path)}`);
  }).forEach((owners, key) => {
    if (owners.length > 1) out.push({ kind: "route", level: "error", message: `${owners.length} routes resolve to "${key}"`, plugins: uniq(owners) });
  });

  const overrideTargets = (plugin: Plugin, push: (id: string) => void): void => {
    collectNavIds(plugin.nav, push);
    for (const entry of plugin.profileMenu ?? []) if (entry.id != null) push(entry.id);
  };
  collect(plugins, overrideTargets).forEach((owners, id) => {
    if (owners.length > 1) out.push({ kind: "nav-id", level: "error", message: `nav id "${id}" used ${owners.length}×; override targets ids, so they must be unique`, plugins: uniq(owners) });
  });

  collect(plugins, (plugin, push) => {
    for (const decl of plugin.permissions ?? []) push(decl.name);
  }).forEach((owners, name) => {
    if (owners.length > 1) out.push({ kind: "permission", level: "warn", message: `permission "${name}" declared by ${uniq(owners).length} plugins; pick a more specific "<resource>" unless shared on purpose`, plugins: uniq(owners) });
  });

  out.push(...undeclaredGates(plugins));

  // Both the id's dashes and the key's camel humps become underscores, so plugin "a-b" key "c" and
  // plugin "a" key "bC" name one variable — one plugin would silently read the other's value.
  collect(plugins, (plugin, push) => {
    for (const decl of plugin.settings ?? []) push(envName(plugin.id, decl.key));
  }).forEach((owners, name) => {
    if (owners.length > 1) out.push({ kind: "setting", level: "error", message: `${owners.length} settings resolve to "${name}"; rename a key or a plugin folder`, plugins: uniq(owners) });
  });

  return out;
}

// Declaring is optional, but the admin screens offer only declared names: a route gated on one nobody
// declares answers 403 (a nav node is hidden) until the Keto tuple is written by hand or
// ADMIN_PERMISSIONS seeds it.
function undeclaredGates(plugins: Plugin[]): PluginConflict[] {
  const declared = new Set(declaredPermissions(plugins).map((decl) => decl.name));
  const out: PluginConflict[] = [];
  for (const plugin of plugins) {
    const gated = new Set<string>();
    for (const route of plugin.routes ?? []) if (route.permission != null) gated.add(route.permission);
    collectNavPermissions(plugin.nav, (name) => gated.add(name));
    for (const entry of plugin.profileMenu ?? []) if (entry.permission != null) gated.add(entry.permission);
    for (const name of [...gated].sort()) {
      if (!declared.has(name)) out.push({ kind: "permission", level: "warn", message: `plugin "${plugin.id}" gates on "${name}", which no installed plugin declares, so the admin screens can't grant it; declare it in that plugin's \`permissions\``, plugins: [plugin.id] });
    }
  }
  return out;
}

function collectNavPermissions(nodes: NavNode[] | undefined, push: (name: string) => void): void {
  for (const node of nodes ?? []) {
    if (node.permission != null) push(node.permission);
    collectNavPermissions(node.children, push);
  }
}

// Map each emitted key → the plugin ids that emitted it (repeats kept, so within-plugin dups count).
function collect(plugins: Plugin[], emit: (plugin: Plugin, push: (key: string) => void) => void): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const plugin of plugins) emit(plugin, (key) => owners.set(key, [...(owners.get(key) ?? []), plugin.id]));
  return owners;
}

function collectNavIds(nodes: NavNode[] | undefined, push: (id: string) => void): void {
  for (const node of nodes ?? []) {
    if (node.id != null) push(node.id);
    collectNavIds(node.children, push);
  }
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
