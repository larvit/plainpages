// README → "Two browser floors", checked against MDN's compat data: a feature one of FLOOR's engines
// lacks passes only inside an `@supports` whose condition names it. Checked: at-rules, media features,
// pseudo-classes and -elements, properties, and in a value its functions, its units and the keywords
// MDN lists for that property. A partial implementation counts as support. A vendor-prefixed name is
// one engine's by design and is skipped, as are `font-family` names: an engine skips a family it lacks.
// Not checked: the body of an at-rule other than @media and @supports, and syntax MDN has no entry for,
// such as media range syntax.
import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { CompatStatement, Identifier, SimpleSupportStatement } from "@mdn/browser-compat-data";

const FLOOR = { chrome: "87", safari: "15", firefox: "115" };

interface Feature {
  label: string;
  path: string | undefined;
  // Matches the feature in an `@supports` condition that tests for it.
  guard: RegExp;
  offset: number;
}

interface Sheet {
  css: string;
  out: string[];
}

export function floorViolations(css: string): string[] {
  const sheet = { css: blank(css), out: [] };
  walk(sheet, 0, sheet.css.length, []);
  return [...new Set(sheet.out)];
}

// Comments, string contents and url() contents become spaces, so nothing inside one reads as syntax
// and every offset keeps its line.
function blank(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\([^)]*\)/g, (m) => {
    if (m.startsWith("/*")) return m.replace(/[^\n]/g, " ");
    const keep = m.startsWith("url(") ? 4 : 1;
    return m.slice(0, keep) + " ".repeat(m.length - keep - 1) + m.slice(-1);
  });
}

function closing(text: string, open: number): number {
  const [opener, closer] = text[open] === "(" ? ["(", ")"] : ["{", "}"];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    if (text[i] === closer && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${opener} at offset ${open}`);
}

function walk(sheet: Sheet, start: number, end: number, guards: string[]): void {
  let i = start;
  while (i < end) {
    const stop = sheet.css.slice(i, end).search(/[{;]/);
    if (stop < 0) return;
    const at = i + stop;
    const raw = sheet.css.slice(i, at);
    const prelude = raw.trim();
    const offset = i + raw.length - raw.trimStart().length;
    const blockEnd = sheet.css[at] === "{" ? closing(sheet.css, at) : at;
    if (prelude.startsWith("@")) atRule(sheet, prelude, offset, guards, [at + 1, blockEnd]);
    else styleRule(sheet, prelude, offset, guards, [at + 1, blockEnd]);
    i = blockEnd + 1;
  }
}

function atRule(sheet: Sheet, prelude: string, offset: number, guards: string[], [from, to]: [number, number]): void {
  const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
  if (name.startsWith("-")) return;
  check(sheet, guards, { label: `@${name}`, path: `css.at-rules.${name}`, guard: never, offset });
  const condition = prelude.slice(name.length + 1);
  if (name === "media") {
    for (const m of condition.matchAll(/\(\s*(?:min-|max-)?([a-z][\w-]*)\s*[:)]/gi)) {
      check(sheet, guards, { label: `(${m[1]})`, path: `css.at-rules.media.${m[1]}`, guard: never, offset });
    }
  }
  if (name === "supports" && /(?<![\w-])selector\(/i.test(condition)) {
    check(sheet, guards, { label: "selector()", path: "css.at-rules.supports.selector", guard: never, offset });
  }
  if (name === "media" || name === "supports") {
    walk(sheet, from, to, name === "supports" ? [...guards, positive(condition)] : guards);
  }
}

// The parts of an @supports condition that hold inside it: a `not (…)` group holds only outside.
function positive(condition: string): string {
  let rest = condition;
  for (let at = rest.search(/(?<![\w-])not\s/i); at >= 0; at = rest.search(/(?<![\w-])not\s/i)) {
    const open = rest.indexOf("(", at);
    if (open < 0) return rest.slice(0, at);
    rest = rest.slice(0, at) + rest.slice(closing(rest, open) + 1);
  }
  return rest;
}

function styleRule(sheet: Sheet, selector: string, offset: number, guards: string[], [from, to]: [number, number]): void {
  for (const m of selector.matchAll(/::?([a-z][\w-]*)/gi)) {
    const name = (m[1] ?? "").toLowerCase();
    check(sheet, guards, { label: `:${name}`, path: `css.selectors.${name}`, guard: new RegExp(`:${name}(?![\\w-])`, "i"), offset: offset + (m.index ?? 0) });
  }
  const body = sheet.css.slice(from, to);
  if (body.includes("{")) {
    check(sheet, guards, { label: "a nested rule", path: "css.selectors.nesting", guard: never, offset: from });
    return;
  }
  let at = from;
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0) property(sheet, guards, declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1), at + declaration.search(/\S/));
    at += declaration.length + 1;
  }
}

function property(sheet: Sheet, guards: string[], name: string, value: string, offset: number): void {
  if (name.startsWith("-") && !name.startsWith("--")) return;
  const custom = name.startsWith("--");
  const known = custom || check(sheet, guards, { label: name, path: `css.properties.${name}`, guard: word(name), offset });
  for (const m of value.matchAll(/(?<![\w-])([a-z][\w-]*)\(/gi)) {
    const fn = m[1] ?? "";
    check(sheet, guards, { label: `${fn}()`, path: functionPath(name, fn), guard: new RegExp(`(?<![\\w-])${fn}\\(`, "i"), offset });
  }
  for (const m of value.replace(/#[\da-f]+/gi, "").matchAll(/(?<![\w.])\d*\.?\d+([a-z]+|%)/gi)) {
    const unit = (m[1] ?? "").toLowerCase();
    check(sheet, guards, { label: unit, path: unitPath(unit), guard: new RegExp(`\\d${unit}(?![\\w-])`, "i"), offset });
  }
  if (custom || !known || name === "font-family") return;
  for (const m of value.matchAll(/(?<![\w-])([a-z][\w-]*)(?![\w(-])/gi)) {
    const path = `css.properties.${name}.${(m[1] ?? "").toLowerCase()}`;
    if (entry(path)) check(sheet, guards, { label: `${name}: ${m[1]}`, path, guard: word(m[1] ?? ""), offset });
  }
}

const never = /(?!)/;
const word = (name: string): RegExp => new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "i");

// A name two types share, like rect() in <shape> and <basic-shape>, passes where the floor has either.
function functionPath(property: string, fn: string): string | undefined {
  const name = fn === "rgba" ? "rgb" : fn; // MDN files rgba() under rgb(), its alias
  const types = Object.keys(bcd.css.types ?? {}).map((type) => `css.types.${type}.${name}`);
  const paths = [`css.properties.${property}.${name}`, `css.types.${name}`, ...types].filter((path) => entry(path));
  return paths.find((path) => lacking(entry(path)).length === 0) ?? paths[0];
}

const VIEWPORT: Record<string, string> = { d: "dynamic", s: "small", l: "large" };
const UNIT_TYPES: Record<string, string> = {
  px: "css.types.length",
  "%": "css.types.percentage",
  fr: "css.types.flex",
  s: "css.types.time",
  ms: "css.types.time",
};

function unitPath(unit: string): string | undefined {
  const viewport = /^([dsl])v(?:h|w|i|b|min|max)$/.exec(unit)?.[1];
  if (viewport) return `css.types.length.viewport_percentage_units_${VIEWPORT[viewport]}`;
  return UNIT_TYPES[unit] ?? ["length", "angle", "resolution"].map((type) => `css.types.${type}.${unit}`).find((path) => entry(path));
}

function entry(path: string | undefined): CompatStatement | undefined {
  if (!path) return undefined;
  let node: Identifier | undefined = bcd as unknown as Identifier;
  for (const key of path.split(".")) node = node && Object.hasOwn(node, key) ? node[key] : undefined;
  return node?.__compat;
}

// Reports the feature unless a guard names it; true when it is fine as written.
function check(sheet: Sheet, guards: string[], feature: Feature): boolean {
  if (guards.some((condition) => feature.guard.test(condition))) return true;
  const line = sheet.css.slice(0, feature.offset).split("\n").length;
  const compat = entry(feature.path);
  if (!compat) {
    sheet.out.push(`line ${line}: ${feature.label} has no MDN compat entry`);
    return false;
  }
  const missing = lacking(compat);
  if (missing.length > 0) sheet.out.push(`line ${line}: ${feature.label} needs ${missing.join(", ")} (${feature.path})`);
  return missing.length === 0;
}

// Each floor engine without the feature, with the release that brought it, as "safari 15.4".
function lacking(compat: CompatStatement | undefined): string[] {
  return Object.entries(FLOOR).flatMap(([browser, floor]) => {
    const support = compat?.support[browser as keyof typeof compat.support];
    const statements = [support ?? []].flat().filter((s: SimpleSupportStatement) => !s.prefix && !s.alternative_name && !s.flags);
    const has = (s: SimpleSupportStatement): boolean => {
      const added = release(s.version_added);
      return added !== undefined && !newer(added, floor) && !(s.version_removed && !newer(s.version_removed, floor));
    };
    if (statements.some(has)) return [];
    const releases = statements.flatMap((s) => release(s.version_added) ?? []).sort((x, y) => (newer(x, y) ? 1 : -1));
    return [`${browser} ${releases[0] ?? "(none yet)"}`];
  });
}

// A shipped release number; "≤79" counts as 79, "preview" and false as none.
function release(version: string | false): string | undefined {
  return typeof version === "string" && /^≤?\d/.test(version) ? version.replace("≤", "") : undefined;
}

function newer(version: string, than: string): boolean {
  const [a, b] = [version, than].map((v) => v.split(".").map(Number));
  for (let i = 0; i < Math.max(a?.length ?? 0, b?.length ?? 0); i++) {
    if ((a?.[i] ?? 0) !== (b?.[i] ?? 0)) return (a?.[i] ?? 0) > (b?.[i] ?? 0);
  }
  return false;
}
