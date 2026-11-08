// floorViolations checks a stylesheet against FLOOR, the browser floor of README → "Two browser
// floors", using MDN's compat data. A feature one of its engines lacks passes only inside an
// `@supports` whose condition requires it; an at-rule or a nested rule the floor lacks fails even there.
// Checked: at-rules, media features, pseudo-classes and -elements, properties, and, in a property's
// value, its functions, its units and the keywords MDN lists for that property. A name MDN has no
// entry for fails. A media feature the floor lacks passes, since an engine without it reads the query
// as false; media range and `or` syntax fail. A partial implementation counts as support, since MDN
// marks edge gaps that way, such as `outline` ignoring `border-radius` before Chrome 94. A
// vendor-prefixed name is one engine's by design and is skipped, as are `font-family` names: an engine
// skips a family it lacks.
// Not checked: the body of an at-rule other than @media and @supports.
import bcd from "@mdn/browser-compat-data" with { type: "json" };
import type { CompatStatement, Identifier, SimpleSupportStatement, SupportBlock } from "@mdn/browser-compat-data";

const FLOOR = [["chrome", "87"], ["safari", "15"], ["firefox", "115"]] as const;

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
  const open = unclosed(sheet.css);
  if (open !== undefined) return [`line ${lineAt(sheet.css, open)}: ${sheet.css[open]} is never closed`];
  walk(sheet, 0, sheet.css.length, []);
  return [...new Set(sheet.out)];
}

// The innermost bracket nothing closes: a browser reads the rest of the sheet as inside it.
function unclosed(css: string): number | undefined {
  const open: { at: number; closer: string }[] = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{" || css[i] === "(") open.push({ at: i, closer: css[i] === "{" ? "}" : ")" });
    else if (css[i] === open.at(-1)?.closer) open.pop();
  }
  return open.at(-1)?.at;
}

const lineAt = (css: string, offset: number): number => css.slice(0, offset).split("\n").length;

// Comments, string contents and url() contents become spaces, so nothing inside one reads as syntax
// and every offset keeps its line.
function blank(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\([^)]*\)/g, (m) => {
    if (m.startsWith("/*")) return m.replace(/[^\n]/g, " ");
    const keep = m.startsWith("url(") ? 4 : 1;
    return m.slice(0, keep) + " ".repeat(m.length - keep - 1) + m.slice(-1);
  });
}

// The end of `text` when nothing closes the bracket. floorViolations refuses a sheet with one left
// open, so only an @supports condition cut at a `;` or `{` inside its parentheses gets there.
function closing(text: string, open: number): number {
  const [opener, closer] = text[open] === "(" ? ["(", ")"] : ["{", "}"];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    if (text[i] === closer && --depth === 0) return i;
  }
  return text.length;
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
  if (name === "media") mediaQuery(sheet, guards, condition, offset);
  if (name === "supports" && /(?<![\w-])selector\(/i.test(condition)) {
    check(sheet, guards, { label: "selector()", path: "css.at-rules.supports.selector", guard: never, offset });
  }
  if (name === "media" || name === "supports") {
    walk(sheet, from, to, name === "supports" ? [...guards, positive(condition)] : guards);
  }
}

// Range and `or` syntax each have a floor spelling (`min-`/`max-`, a comma list), so a query using
// one was meant for every engine, and a floor engine drops it whole.
function mediaQuery(sheet: Sheet, guards: string[], condition: string, offset: number): void {
  for (const m of condition.matchAll(/\(\s*(?:min-|max-)?([a-z][\w-]*)\s*[:)]/gi)) {
    const path = `css.at-rules.media.${m[1]}`;
    if (!entry(path)) check(sheet, guards, { label: `(${m[1]})`, path, guard: never, offset });
  }
  if (/[<>=]/.test(condition)) {
    check(sheet, guards, { label: "media range syntax", path: "css.at-rules.media.range_syntax", guard: never, offset });
  }
  if (OR.test(condition)) {
    check(sheet, guards, { label: "media or syntax", path: "css.at-rules.media.or_syntax", guard: never, offset });
  }
}

// The parts of an @supports condition that must hold for its block to apply: neither a `not (…)`
// group nor an operand of an `or`, at any depth.
function positive(condition: string): string {
  let top = "";
  let kept = "";
  let from = 0;
  for (let open = condition.indexOf("("); open >= 0; open = condition.indexOf("(", from)) {
    const close = closing(condition, open);
    const head = condition.slice(from, open);
    const inner = condition.slice(open + 1, close);
    top += head;
    if (NEGATED.test(head)) kept += head.replace(NEGATED, "");
    else if (/[\w-]$/.test(head)) kept += `${head}(${inner})`; // a function such as selector()
    else kept += `${head}(${positive(inner)})`;
    from = close + 1;
  }
  return OR.test(top + condition.slice(from)) ? "" : kept + condition.slice(from);
}

const OR = /(?<![\w-])or\s/i;
const NEGATED = /(?<![\w-])not\s+[\w-]*$/i;

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
  return paths.find((path) => lacking(entry(path)?.support ?? {}).length === 0) ?? paths[0];
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
  let node: Identifier | undefined = { css: bcd.css };
  for (const key of path.split(".")) node = node && Object.hasOwn(node, key) ? node[key] : undefined;
  return node?.__compat;
}

// Reports the feature unless a guard names it or the floor has it; returns true when either holds.
function check(sheet: Sheet, guards: string[], feature: Feature): boolean {
  if (guards.some((condition) => feature.guard.test(condition))) return true;
  const line = lineAt(sheet.css, feature.offset);
  const compat = entry(feature.path);
  if (!compat) {
    sheet.out.push(`line ${line}: ${feature.label} has no MDN compat entry`);
    return false;
  }
  const missing = lacking(compat.support);
  if (missing.length > 0) sheet.out.push(`line ${line}: ${feature.label} needs ${missing.join(", ")} (${feature.path})`);
  return missing.length === 0;
}

// Each floor engine without the feature, with the first later release that has it, as "safari 15.4".
export function lacking(support: SupportBlock): string[] {
  return FLOOR.flatMap(([browser, floor]) => {
    const statements = [support[browser] ?? []].flat().filter((s) => !s.prefix && !s.alternative_name && !s.flags);
    const has = (s: SimpleSupportStatement): boolean => {
      const added = release(s.version_added);
      return added !== undefined && !newer(added, floor) && !(s.version_removed && !newer(s.version_removed, floor));
    };
    if (statements.some(has)) return [];
    const releases = statements.flatMap((s) => release(s.version_added) ?? []).filter((v) => newer(v, floor));
    releases.sort((x, y) => (newer(x, y) ? 1 : -1));
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
