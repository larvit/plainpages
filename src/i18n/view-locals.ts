// The i18n block every rendered view receives. EJS passes a template's locals down into its
// includes, so injecting this at the top level is what lets any partial — core or plugin — call
// `t(...)` and read `locale` without its caller threading them through.

import { DEFAULT_LOCALE } from "./catalog.ts";
import { ENGLISH } from "./english.ts";
import type { RequestContext } from "../http/context.ts";
import { localeHref, localeLabel, textDirection } from "./locale.ts";
import type { Translate } from "./translate.ts";

export interface LocaleChoice {
  current: boolean;
  href: string; // this same page in that locale
  label: string; // the locale named in its own language
  tag: string;
}

export interface I18nLocals {
  dir: "ltr" | "rtl";
  locale: string;
  localeHref: (href: string) => string;
  localeSwitch: LocaleChoice[];
  locales: string[];
  t: Translate;
}

// For a render with no request behind it — a partial exercised directly, a one-off render: English,
// left-to-right, no language picker.
export const ENGLISH_LOCALS: I18nLocals = {
  dir: "ltr",
  locale: DEFAULT_LOCALE,
  localeHref: (href) => href,
  localeSwitch: [],
  locales: [DEFAULT_LOCALE],
  t: ENGLISH,
};

export function i18nLocals(ctx: RequestContext): I18nLocals {
  const here = `${ctx.url.pathname}${ctx.url.search}`;
  return {
    dir: textDirection(ctx.locale),
    locale: ctx.locale,
    localeHref: (href) => ctx.localeHref(href),
    localeSwitch: ctx.locales.map((tag) => ({ current: tag === ctx.locale, href: localeHref(here, tag), label: localeLabel(tag), tag })),
    locales: ctx.locales,
    t: ctx.t,
  };
}
