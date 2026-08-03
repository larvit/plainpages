// What a translation catalog is, and the boot-time parity rules that keep every locale
// in step with its en-US baseline. Pure: `load.ts` reads the files, this decides whether they are
// sound. A plural message carries exactly the categories its own locale needs (Intl.PluralRules),
// so a translator can't ship half a plural and a Czech catalog isn't held to English's two forms.

export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Message = PluralMessage | string;
export type Catalog = Record<string, Message>;

// The baseline every catalog set is checked against, and the locale served when a request matches
// nothing. A core catalog for it must exist — the host refuses to boot otherwise.
export const DEFAULT_LOCALE = "en-US";

const CATEGORIES: ReadonlySet<string> = new Set(["few", "many", "one", "other", "two", "zero"]);

export function isPluralMessage(value: Message): value is PluralMessage {
  return typeof value !== "string";
}

// Shape guard for an imported catalog module — a mounted plugin's file is untyped at runtime.
export function isCatalog(value: unknown): value is Catalog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((message) => {
    if (typeof message === "string") return true;
    if (typeof message !== "object" || message === null || Array.isArray(message)) return false;
    const forms = Object.entries(message);
    return forms.length > 0 && forms.every(([category, text]) => CATEGORIES.has(category) && typeof text === "string");
  });
}

export interface ParityInput {
  baseline: Catalog;
  baselineLocale: string;
  catalog: Catalog;
  locale: string;
}

// Every problem with `catalog` relative to `baseline`, as ready-to-print lines. Empty ⇒ sound.
// Run the baseline against itself too: that is what validates its own plural completeness.
export function checkCatalog({ baseline, baselineLocale, catalog, locale }: ParityInput): string[] {
  const problems: string[] = [];
  const categories = pluralCategories(locale);

  for (const [key, expected] of Object.entries(baseline)) {
    const actual = catalog[key];
    if (actual === undefined) {
      problems.push(`missing key "${key}"`);
      continue;
    }
    if (isPluralMessage(expected) !== isPluralMessage(actual)) {
      problems.push(`"${key}" must be a ${isPluralMessage(expected) ? "plural message" : "string"}, like ${baselineLocale}`);
      continue;
    }
    if (!isPluralMessage(actual)) continue;
    const forms = new Set(Object.keys(actual));
    const missing = categories.filter((category) => !forms.has(category));
    const selected = new Set<string>(categories);
    const unknown = [...forms].filter((category) => !selected.has(category)).sort();
    if (missing.length) problems.push(`"${key}" is missing the ${locale} plural forms: ${missing.join(", ")}`);
    if (unknown.length) problems.push(`"${key}" has plural forms ${locale} never selects: ${unknown.join(", ")}`);
  }

  for (const key of Object.keys(catalog)) {
    if (!(key in baseline)) problems.push(`unknown key "${key}" — add it to ${baselineLocale} first`);
  }

  return problems;
}

// The plural categories a locale actually selects, sorted; unknown tags fall back to English's.
export function pluralCategories(locale: string): Intl.LDMLPluralRule[] {
  try {
    return [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort();
  } catch {
    return ["one", "other"];
  }
}
