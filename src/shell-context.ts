// Shell view-model builder (todo §5): the brand/theme/user/title block every app-shell page
// (the home dashboard, the built-in admin screens) hands to shell.ejs. Pure. Extracted so the
// shell user is the *real* signed-in identity (§4) — no hardcoded demo profile — and branding is
// read from one place. The User carries no display name (the JWT holds only id/email/roles), so
// the profile shows the email's local part as the name with the full email beneath, initials from
// the local part; anonymous ⇒ "Guest".

import type { User } from "./context.ts";
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

export function shellUser(user: User | null | undefined): ShellUser {
  if (!user) return { email: "", initials: "G", name: "Guest" };
  const local = user.email.split("@")[0] || user.email;
  return { email: user.email, initials: (local.slice(0, 2) || "U").toUpperCase(), name: local };
}

export function buildShellContext(opts: {
  breadcrumbs?: { href?: string; label: string }[];
  csrfToken?: string;
  menu: MenuConfig;
  signInHref?: string;
  title: string;
  user?: User | null;
}): ShellModel {
  const b = opts.menu.branding;
  return {
    brand: { ...(b.logo != null ? { logo: b.logo } : {}), name: b.name, ...(b.sub != null ? { sub: b.sub } : {}) },
    ...(opts.breadcrumbs ? { breadcrumbs: opts.breadcrumbs } : {}),
    csrfToken: opts.csrfToken ?? "",
    ...(opts.signInHref != null ? { signInHref: opts.signInHref } : {}),
    ...(b.theme != null ? { theme: b.theme } : {}),
    title: opts.title,
    user: shellUser(opts.user),
  };
}
