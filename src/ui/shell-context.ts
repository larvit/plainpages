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

// The brand block both the chrome and the shell model carry. `name`/`sub` pass through `t`, so a
// catalog key is translated and an operator's own wording renders as written.
export function branding(menu: MenuConfig, t: Translate): { logo?: string; name: string; sub?: string; theme?: string } {
  const b = menu.branding;
  return {
    ...(b.logo != null ? { logo: b.logo } : {}),
    name: t(b.name),
    ...(b.sub != null ? { sub: t(b.sub) } : {}),
    ...(b.theme != null ? { theme: b.theme } : {}),
  };
}

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
    return { email: "", initials: ([...guest][0] ?? "?").toUpperCase(), name: guest }; // by character: the word is translated
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
  const t = opts.t ?? ENGLISH;
  const { theme, ...brand } = branding(opts.menu, t);
  return {
    brand,
    ...(opts.breadcrumbs ? { breadcrumbs: opts.breadcrumbs } : {}),
    csrfToken: opts.csrfToken ?? "",
    ...(opts.signInHref != null ? { signInHref: opts.signInHref } : {}),
    ...(theme != null ? { theme } : {}),
    title: opts.title,
    user: shellUser(opts.user, t),
  };
}
