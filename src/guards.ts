// Auth guards (todo §4): in-handler authorization, the imperative counterpart to the
// declarative route `permission` gate. The middleware already verified the session JWT and put
// the User on ctx; these read it. `requireSession` asserts (throws GuardError, which app.ts maps
// to a response); `can`/`check` are predicates a handler branches on. `check` is the one live
// Keto call — the fine-grained "may I?" tier (README), reserved for relationship rules.
import type { RequestContext, User } from "./context.ts";
import type { KetoClient } from "./keto-client.ts";
import { localPath } from "./safe-url.ts";

// Build the sign-in redirect for a gated request, preserving where the user was headed as
// `return_to` so login can land them back there (§9). Only a safe GET/HEAD navigation to a
// non-home, host-relative path is remembered (a POST or "/" ⇒ a bare /login); the target is
// validated host-relative (localPath) so it can't become an open redirect.
export function loginRedirect(ctx: RequestContext): string {
  const method = (ctx.req.method ?? "GET").toUpperCase();
  const target = method === "GET" || method === "HEAD" ? localPath(ctx.url.pathname + ctx.url.search) : null;
  return target && target !== "/" ? `/login?return_to=${encodeURIComponent(target)}` : "/login";
}

// Thrown by an asserting guard; app.ts maps it to a response. `location` ⇒ a 303 redirect (an
// anonymous browser bounces to /login); otherwise `status` renders an error page (403 Forbidden).
// A handler may throw its own (e.g. `new GuardError(403, …)` after a failed `can`/`check`).
export class GuardError extends Error {
  location?: string | undefined;
  status: number;
  constructor(status: number, message: string, location?: string) {
    super(message);
    this.location = location;
    this.name = "GuardError";
    this.status = status;
  }
}

// Assert a signed-in session and return the user. Anonymous ⇒ GuardError → /login (return_to kept).
export function requireSession(ctx: RequestContext): User {
  if (!ctx.user) throw new GuardError(401, "authentication required", loginRedirect(ctx));
  return ctx.user;
}

// Coarse role check straight from the JWT claims — in-process, zero I/O. Anonymous ⇒ false.
export function can(ctx: RequestContext, role: string): boolean {
  return ctx.roles.includes(role);
}

// Live Keto relationship check at the point of action. The subject is the current user;
// anonymous ⇒ false (fail-closed, no Keto call).
export async function check(
  keto: KetoClient,
  ctx: RequestContext,
  tuple: { namespace: string; object: string; relation: string },
): Promise<boolean> {
  if (!ctx.user) return false;
  return keto.check({ ...tuple, subject_id: `user:${ctx.user.id}` });
}
