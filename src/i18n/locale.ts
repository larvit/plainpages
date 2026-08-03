// Which language a request is served in, and how a chosen one travels.
//
// Precedence: `?locale=sv-SE` → Accept-Language (by q) → en-US. Matching is exact on a full tag —
// asking for sv-FI when only sv-SE is installed lands on en-US rather than a neighbouring region —
// but a lone language ("sv", as browsers send) resolves to the first regional catalog for it.
// There is no locale cookie: the URL is the only place a choice is stored, so a link is shareable
// and a page is what its address says it is. `localeHref` is how the choice survives a click.

import { DEFAULT_LOCALE } from "./catalog.ts";

// Accept-Language tags, best first. Wildcards and malformed entries are dropped, not guessed at.
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)).find((m) => m !== null);
      return { index, q: q ? Number(q[1]) : 1, tag: tag.trim() };
    })
    .filter((entry) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(entry.tag) && Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

// The installed locale a request for `requested` should be served in, or null when none fits.
export function matchLocale(requested: string | null | undefined, available: string[]): string | null {
  const canonical = canonicalize(requested);
  if (canonical === null) return null;
  const exact = available.find((tag) => tag.toLowerCase() === canonical.toLowerCase());
  if (exact !== undefined) return exact;
  if (canonical.includes("-")) return null; // a region was asked for; another region is a different locale
  const language = `${canonical.toLowerCase()}-`;
  return [...available].sort().find((tag) => tag.toLowerCase().startsWith(language)) ?? null;
}

export interface ResolveInput {
  acceptLanguage?: string | undefined;
  available: string[];
  param?: string | null | undefined; // the ?locale query value
}

export interface ResolvedLocale {
  explicit: boolean; // the URL asked for this locale — the host then carries it on the links it renders
  locale: string;
}

export function resolveLocale({ acceptLanguage, available, param }: ResolveInput): ResolvedLocale {
  const asked = matchLocale(param, available);
  if (asked !== null) return { explicit: true, locale: asked };
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const matched = matchLocale(tag, available);
    if (matched !== null) return { explicit: false, locale: matched };
  }
  return { explicit: false, locale: DEFAULT_LOCALE };
}

// Carry `locale` on a host-relative link. Off-site and protocol-relative URLs are left alone — the
// locale is ours to state, not theirs. `locale` null (the visitor never asked for one) ⇒ unchanged.
export function localeHref(href: string, locale: string | null): string {
  // An absent href is a shape the building blocks document as optional (a non-linked page item, a
  // header with no sort target) — it must not throw here, or a page renders for every visitor
  // except the ones who chose a language.
  if (locale === null || !href || href.startsWith("//")) return href;
  // A query-only href ("?" — the filter bar's documented "clear" target) keeps that shape; anything
  // else must be host-relative, or it is someone else's URL to state a language for.
  const queryOnly = href.startsWith("?");
  if (!queryOnly && !href.startsWith("/")) return href;
  const url = new URL(href, "http://localhost/");
  url.searchParams.set("locale", locale);
  return queryOnly ? `${url.search}${url.hash}` : `${url.pathname}${url.search}${url.hash}`;
}

// Both are asked for on every render (the <html> tag, the language picker) but depend only on the
// tag, so each locale pays the ICU lookup once per process.
const directions = new Map<string, "ltr" | "rtl">();
const labels = new Map<string, string>();

interface TextInfoLocale {
  getTextInfo?: () => { direction?: string };
  textInfo?: { direction?: string };
}

// The document direction for <html dir>. Derived from the locale's script, so an RTL catalog flips
// the document the day it is added.
export function textDirection(locale: string): "ltr" | "rtl" {
  const cached = directions.get(locale);
  if (cached !== undefined) return cached;
  const direction = readDirection(locale);
  directions.set(locale, direction);
  return direction;
}

function readDirection(locale: string): "ltr" | "rtl" {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & TextInfoLocale;
    const direction = info.getTextInfo?.().direction ?? info.textInfo?.direction;
    return direction === "rtl" ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

// A locale named in its own language ("svenska (Sverige)") — what a language picker should show.
export function localeLabel(locale: string): string {
  const cached = labels.get(locale);
  if (cached !== undefined) return cached;
  let label: string;
  try {
    label = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  } catch {
    label = locale;
  }
  labels.set(locale, label);
  return label;
}

function canonicalize(tag: string | null | undefined): string | null {
  if (typeof tag !== "string" || tag === "") return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}
