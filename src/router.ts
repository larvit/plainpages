// Router (todo §2): pure core mapping method + pathname → a discovered plugin route. I/O-free;
// app.ts is the shell (build context, gate, call handler, render RouteResult). A route mounts at
// `/<id>` + its path (fullPath, shared with conflict detection); `:name` segments → path params.
// Specificity: a literal segment beats a `:param` (/users/new wins /users/:id), order-independent.

import { fullPath, type Plugin, type Route } from "./plugin.ts";

export interface RouteMatch {
  params: Record<string, string>;
  plugin: Plugin;
  route: Route;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function paramCount(path: string): number {
  return segments(path).filter((s) => s.startsWith(":")).length;
}

// Match a concrete pathname's segments against a route pattern's; return the params or null.
function matchSegments(pattern: string[], path: string[]): Record<string, string> | null {
  if (pattern.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const pat = pattern[i] as string;
    const seg = path[i] as string;
    if (pat.startsWith(":")) {
      try {
        params[pat.slice(1)] = decodeURIComponent(seg);
      } catch {
        return null; // malformed %-encoding → no match
      }
    } else if (pat !== seg) {
      return null;
    }
  }
  return params;
}

// Every plugin route whose path pattern matches `pathname`, regardless of method, with params.
function matchPath(plugins: Plugin[], pathname: string): RouteMatch[] {
  const path = segments(pathname);
  const out: RouteMatch[] = [];
  for (const plugin of plugins) {
    for (const route of plugin.routes ?? []) {
      const params = matchSegments(segments(fullPath(plugin.id, route.path)), path);
      if (params) out.push({ params, plugin, route });
    }
  }
  return out;
}

// The single route for `method` + `pathname`, or null. A GET route also answers HEAD. Among
// matches the most specific (fewest `:param` segments) wins; ties keep discovery order (plugins
// sorted by id, routes as declared) — sort is stable.
export function matchRoute(plugins: Plugin[], method: string, pathname: string): RouteMatch | null {
  const wanted = method.toUpperCase();
  const candidates = matchPath(plugins, pathname).filter(
    (m) => m.route.method === wanted || (wanted === "HEAD" && m.route.method === "GET"),
  );
  candidates.sort((a, b) => paramCount(a.route.path) - paramCount(b.route.path));
  return candidates[0] ?? null;
}

// Methods allowed at `pathname` (for a 405 `Allow` header); empty when no route matches the path.
export function allowedMethods(plugins: Plugin[], pathname: string): string[] {
  const methods = new Set<string>();
  for (const m of matchPath(plugins, pathname)) {
    methods.add(m.route.method);
    if (m.route.method === "GET") methods.add("HEAD");
  }
  return [...methods].sort();
}

// Coarse permission gate: a route marked `public` (or one with no `permission`) is open; otherwise
// the user's roles (from the session JWT, §4) must include the token. The same rule composeNav uses
// for the menu. `public` and `permission` are mutually exclusive (discovery refuses both, §10).
export function isAuthorized(route: Route, roles: string[]): boolean {
  return route.public === true || route.permission == null || roles.includes(route.permission);
}
