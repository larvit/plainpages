// The i18n block every rendered view receives. EJS passes a template's locals down into its
// includes, so injecting this at the top level is what lets any partial — core or plugin — call
// `t(...)` and read `locale` without its caller threading them through.

import { DEFAULT_LOCALE } from "./catalog.ts";
import { ENGLISH } from "./english.ts";
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
  // The locale to carry as a hidden field, or null when the visitor never asked for one. A GET form
  // replaces the whole query string, so a link-carrying wrapper can't reach it — the form must.
  localeParam: string | null;
  localeSwitch: LocaleChoice[];
  locales: string[];
  t: Translate;
}

// Just the request fields a render needs, so this module stays a leaf of src/i18n/ rather than
// depending on the HTTP layer that calls it.
export interface I18nRequest {
  locale: string;
  localeHref: (href: string) => string;
  locales: string[];
  t: Translate;
  url: URL;
}

// For a render with no request behind it — a partial exercised directly, a one-off render: English,
// left-to-right, no language picker.
export const ENGLISH_LOCALS: I18nLocals = {
  dir: "ltr",
  locale: DEFAULT_LOCALE,
  localeHref: (href) => href,
  localeParam: null,
  localeSwitch: [],
  locales: [DEFAULT_LOCALE],
  t: ENGLISH,
};

export function i18nLocals(ctx: I18nRequest): I18nLocals {
  const here = `${ctx.url.pathname}${ctx.url.search}`;
  // ctx.localeHref is a no-op unless the URL asked for a locale, so it is also the honest answer to
  // "did it?" — asking the function that decides keeps the two from drifting apart.
  const carried = ctx.localeHref("/") === "/" ? null : ctx.locale;
  return {
    dir: textDirection(ctx.locale),
    locale: ctx.locale,
    localeHref: (href) => ctx.localeHref(href),
    localeParam: carried,
    localeSwitch: ctx.locales.map((tag) => ({ current: tag === ctx.locale, href: localeHref(here, tag), label: localeLabel(tag), tag })),
    locales: ctx.locales,
    t: ctx.t,
  };
}
