import type { IncomingMessage, ServerResponse } from "node:http";

// The request context threaded to every route handler (plugin + built-in), built once
// per request by `buildContext`: the router supplies matched path `params`, the §4 JWT
// middleware supplies `user` (null until then). The host's single handler argument.

// The authenticated user, projected from verified session JWT claims (§4):
// `id` = `sub`, plus `email` and the coarse `roles` carried in the token.
export interface User {
  email: string;
  id: string;
  roles: string[];
}

export interface RequestContext {
  params: Record<string, string>; // path params from the route match, e.g. /users/:id → { id }
  query: URLSearchParams; // alias of url.searchParams, for ctx.query.get("q")
  req: IncomingMessage;
  res: ServerResponse;
  roles: string[]; // user?.roles ?? [] — coarse gate without a null-check
  url: URL;
  user: User | null;
}

export interface BuildContextOptions {
  params?: Record<string, string>;
  user?: User | null;
}

export function buildContext(
  req: IncomingMessage,
  res: ServerResponse,
  options: BuildContextOptions = {},
): RequestContext {
  const url = new URL(req.url ?? "/", "http://localhost");
  const user = options.user ?? null;
  return {
    params: options.params ?? {},
    query: url.searchParams,
    req,
    res,
    roles: user?.roles ?? [],
    url,
    user,
  };
}
