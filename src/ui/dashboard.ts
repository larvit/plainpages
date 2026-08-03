// Dashboard view model: the gated "/dashboard" app home. By default a short instructional
// starter — what the dashboard is and how to replace it by exporting a `dashboard` handler from a
// plugin (views/index.ejs holds the prose). A plugin owns the real one (PluginManifest.dashboard);
// this placeholder renders until then. Pure: `nav` is the one global menu (ctx.chrome.nav), built
// once per request by the host, so the dashboard shows the exact same menu as every other page.

import type { User } from "../http/context.ts";
import { ENGLISH } from "../i18n/english.ts";
import type { Translate } from "../i18n/translate.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import type { NavNode } from "./nav.ts";
import { buildShellContext } from "./shell-context.ts";

export function buildDashboardModel(opts: { csrfToken?: string; menu?: MenuConfig; nav?: NavNode[]; t?: Translate; user?: User | null } = {}) {
  const t = opts.t ?? ENGLISH;
  return {
    nav: opts.nav ?? [],
    shell: buildShellContext({
      breadcrumbs: [{ label: t("dashboard.title") }],
      csrfToken: opts.csrfToken ?? "",
      menu: opts.menu ?? DEFAULT_MENU,
      t,
      title: t("dashboard.title"),
      user: opts.user ?? null,
    }),
  };
}

export type DashboardModel = ReturnType<typeof buildDashboardModel>;
