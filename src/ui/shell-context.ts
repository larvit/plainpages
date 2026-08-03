// Shell view-model builder: the brand/theme/user/title block every app-shell page
// (the home dashboard, the built-in admin screens) hands to shell.ejs. Pure. Extracted so the
// shell user is the *real* signed-in identity — no hardcoded demo profile — and branding is
// read from one place. The User carries no display name (the JWT holds only id/email/permissions), so
// the profile shows the email's local part as the name with the full email beneath, initials from
// the local part; anonymous ⇒ "Guest".

import type { User } from "../http/context.ts";
import { ENGLISH } from "../i18n/english.ts";
import type { Translate } from "../i18n/translate.ts";
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

export function shellUser(user: User | null | undefined, t: Translate = ENGLISH): ShellUser {
  if (!user) {
    const guest = t("shell.guest");
    return { email: "", initials: guest.slice(0, 1).toUpperCase(), name: guest };
  }
  const local = user.email.split("@")[0] || user.email;
  return { email: user.email, initials: (local.slice(0, 2) || "U").toUpperCase(), name: local };
}

export function buildShellContext(opts: {
  breadcrumbs?: { href?: string; label: string }[];
  csrfToken?: string;
  menu: MenuConfig;
  signInHref?: string;
  t?: Translate;
  title: string;
  user?: User | null;
}): ShellModel {
  const b = opts.menu.branding;
  const t = opts.t ?? ENGLISH;
  return {
    brand: { ...(b.logo != null ? { logo: b.logo } : {}), name: t(b.name), ...(b.sub != null ? { sub: t(b.sub) } : {}) },
    ...(opts.breadcrumbs ? { breadcrumbs: opts.breadcrumbs } : {}),
    csrfToken: opts.csrfToken ?? "",
    ...(opts.signInHref != null ? { signInHref: opts.signInHref } : {}),
    ...(b.theme != null ? { theme: b.theme } : {}),
    title: opts.title,
    user: shellUser(opts.user, t),
  };
}
