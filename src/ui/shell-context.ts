// Shell view-model builder: the brand/theme/user/title block every app-shell page
// (the home dashboard, the built-in admin screens) hands to shell.ejs. Pure. Extracted so the
// shell user is the *real* signed-in identity — no hardcoded demo profile — and branding is
// read from one place. The User carries no display name (the JWT holds only id/email/permissions), so
// the profile shows the email's local part as the name with the full email beneath, initials from
// the local part; anonymous ⇒ "Guest".

import type { SessionIdentity } from "../http/context.ts";
import { type MenuConfig } from "./menu-config.ts";

export interface ShellUser {
  email: string;
  initials: string;
  name: string;
}

export interface ShellModel {
  brand: { logo?: string; name: string; sub?: string };
  breadcrumbs?: { href?: string; label: string }[];
  csrfToken: string;
  signInHref?: string; // anonymous "Sign in" target (mirrors PageChrome.signInHref); a gated screen omits it
  theme?: string;
  title: string;
  user: ShellUser;
}

export function shellUser(identity: SessionIdentity | null | undefined): ShellUser {
  if (!identity) return { email: "", initials: "G", name: "Guest" };
  const local = identity.email.split("@")[0] || identity.email;
  return { email: identity.email, initials: (local.slice(0, 2) || "U").toUpperCase(), name: local };
}

export function buildShellContext(opts: {
  breadcrumbs?: { href?: string; label: string }[];
  csrfToken?: string;
  menu: MenuConfig;
  signInHref?: string;
  title: string;
  identity?: SessionIdentity | null;
}): ShellModel {
  const b = opts.menu.branding;
  return {
    brand: { ...(b.logo != null ? { logo: b.logo } : {}), name: b.name, ...(b.sub != null ? { sub: b.sub } : {}) },
    ...(opts.breadcrumbs ? { breadcrumbs: opts.breadcrumbs } : {}),
    csrfToken: opts.csrfToken ?? "",
    ...(opts.signInHref != null ? { signInHref: opts.signInHref } : {}),
    ...(b.theme != null ? { theme: b.theme } : {}),
    title: opts.title,
    user: shellUser(opts.identity),
  };
}
