// The translator: a key + vars → the string to render. Pure and synchronous — views call it
// as `t("shell.signOut")` and handlers as `ctx.t(...)`.
//
// Two rules the rest of the app leans on:
//   · the lookup walks a catalog chain (plugin locale → plugin en-US → core locale → core en-US) and,
//     when nothing has the key, returns the key itself. That is what makes a plain nav label like
//     "Shifts" its own fallback — a manifest needs no catalog to keep working.
//   · the result is raw text. Views escape with <%= %> exactly as they do for any other value, so a
//     translation is never double-escaped, and a message that carries markup is rendered with <%- %>.

import { isPluralMessage, type Catalog, type PluralMessage } from "./catalog.ts";

export type TranslateVars = Record<string, number | string>;
export type Translate = (key: string, vars?: TranslateVars) => string;

export interface TranslatorOptions {
  catalogs: Catalog[]; // lookup order, most specific first
  locale: string;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const pluralRules = new Map<string, Intl.PluralRules>();

export function createTranslator({ catalogs, locale }: TranslatorOptions): Translate {
  return (key, vars) => {
    for (const catalog of catalogs) {
      const message = catalog[key];
      if (message === undefined) continue;
      return interpolate(isPluralMessage(message) ? selectPlural(message, locale, vars?.["count"]) : message, vars);
    }
    return key;
  };
}

// The form for `count` in this locale, falling back to `other` (and then to any form present, so a
// half-filled catalog still renders words rather than a blank).
function selectPlural(message: PluralMessage, locale: string, count: number | string | undefined): string {
  const category = count === undefined ? "other" : rulesFor(locale).select(Number(count));
  return message[category] ?? message.other ?? Object.values(message)[0] ?? "";
}

function rulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules("en-US");
    }
    pluralRules.set(locale, rules);
  }
  return rules;
}

// An unsupplied {{var}} is left standing: a visible placeholder beats a silent blank.
function interpolate(text: string, vars: TranslateVars | undefined): string {
  if (vars === undefined) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}
