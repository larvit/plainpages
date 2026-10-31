// The limits and the counting are ESLint's defaults: `max-lines-per-function` (blank lines and
// comments count, an IIFE is not held to it) and `complexity`. Not ESLint itself: parsing TypeScript
// takes typescript-eslint, which needs the compiler API TypeScript 7 no longer ships. So acorn parses
// what Node's own type stripping leaves, which is the code Node runs.
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { parse } from "acorn";

const LIMITS = { lines: 50, complexity: 20 };

// Each function over a limit, at its measurement. A ceiling follows its function down, and a metric
// leaves the entry once it fits, so a function that shrank can't grow back.
const grandfathered: Record<string, { lines?: number; complexity?: number }> = {
  "src/http/app.ts createApp": { lines: 318, complexity: 28 },
  "src/http/app.ts createApp > handleRequest": { lines: 168, complexity: 43 },
  "src/auth/flow-view.ts buildFlowView": { complexity: 24 },
  "src/auth/hydra-admin.ts createHydraAdmin": { lines: 87 },
  "src/auth/kratos-admin.ts createKratosAdmin": { lines: 68 },
  "src/auth/kratos-public.ts createKratosPublic": { lines: 60 },
  "src/plugin-host/discovery.ts discoverPlugins": { lines: 74, complexity: 22 },
  "src/plugin-host/discovery.ts shapeError": { complexity: 23 },
  "src/config.ts loadConfig": { lines: 52 },
  "release-tooling/dockerhub-overview.ts main": { lines: 57 },
  "examples/plugins/admin/admin-users.ts buildUserFormModel": { complexity: 21 },
};

interface AstNode {
  type: string;
  loc: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
}

interface Measured {
  name: string;
  lines: number;
  complexity: number;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const BRANCHES = new Set([
  "IfStatement", "ConditionalExpression", "LogicalExpression", "ForStatement", "ForInStatement",
  "ForOfStatement", "WhileStatement", "DoWhileStatement", "CatchClause", "AssignmentPattern",
]);

function branches(node: AstNode): number {
  if (BRANCHES.has(node.type)) return 1;
  if (node.type === "SwitchCase") return node.test ? 1 : 0;
  if (node.type === "AssignmentExpression") return ["&&=", "||=", "??="].includes(String(node.operator)) ? 1 : 0;
  if (node.type === "MemberExpression" || node.type === "CallExpression") return node.optional === true ? 1 : 0;
  return 0;
}

function nameOf(fn: AstNode, parent: AstNode | undefined): string {
  let id = fn.id;
  if (!id && parent?.type === "VariableDeclarator") id = parent.id;
  if (!id && (parent?.type === "Property" || parent?.type === "MethodDefinition")) id = parent.key;
  return isNode(id) && typeof id.name === "string" ? id.name : "anonymous";
}

// A function is named by the path of names from the outermost one, e.g. `createApp > handleRequest`,
// so an entry above doesn't depend on line numbers.
function measure(source: string): Measured[] {
  const found: Measured[] = [];
  const visit = (node: AstNode, parent: AstNode | undefined, enclosing: Measured | undefined): void => {
    let current = enclosing;
    if (FUNCTIONS.has(node.type)) {
      const name = nameOf(node, parent);
      const iife = parent?.type === "CallExpression" && parent.callee === node;
      const lines = iife ? 0 : node.loc.end.line - node.loc.start.line + 1;
      current = { name: enclosing ? `${enclosing.name} > ${name}` : name, lines, complexity: 1 };
      found.push(current);
    } else if (current) {
      current.complexity += branches(node);
    }
    for (const value of Object.values(node)) {
      for (const child of [value].flat()) if (isNode(child)) visit(child, node, current);
    }
  };
  const program: unknown = parse(stripTypeScriptTypes(source), { ecmaVersion: "latest", sourceType: "module", locations: true });
  assert.ok(isNode(program));
  visit(program, undefined, undefined);
  return found;
}

const root = new URL("..", import.meta.url);
// The drop-in mounts hold an operator's code, not this repo's. Tests are left out: each is a flat
// script, and a `describe` block wraps many of them.
const files = globSync("**/*.ts", {
  cwd: root,
  exclude: ["**/node_modules/**", "plugins/**", "config/**", "locales/**", "**/*.d.ts", "**/*.test.ts", "**/*.spec.ts"],
});
// A list, not a map: two unnamed siblings share a key, and each must be checked.
const measured = files.flatMap((file) =>
  measure(readFileSync(new URL(file, root), "utf8")).map((m) => ({ ...m, key: `${file} ${m.name}` })),
);
const METRICS = ["lines", "complexity"] as const;

test("measure counts lines and complexity as ESLint does", () => {
  const source = [
    "function outer(a = 1): void {",
    "  if (a && b?.c) {}",
    "  for (const x of y) {}",
    "  for (const k in y) {}",
    "  for (;;) break;",
    "  while (a) a--;",
    "  do {} while (a);",
    "  try {} catch {}",
    "  switch (a) { case 1: break; default: }",
    "  a ||= 2; a &&= 3; a ??= 4;",
    "  b?.();",
    "  y.map(() => {});",
    "  const inner = () => (a ? 1 : 2);",
    "  const o = { prop() {}, key: function () {} };",
    "  (function () { if (a) {} })();",
    "}",
    "class K { method() {} }",
  ].join("\n");
  assert.deepEqual(measure(source), [
    { name: "outer", lines: 16, complexity: 16 },
    { name: "outer > anonymous", lines: 1, complexity: 1 },
    { name: "outer > inner", lines: 1, complexity: 2 },
    { name: "outer > prop", lines: 1, complexity: 1 },
    { name: "outer > key", lines: 1, complexity: 1 },
    { name: "outer > anonymous", lines: 0, complexity: 2 },
    { name: "method", lines: 1, complexity: 1 },
  ]);
});

test(`every function fits ${LIMITS.lines} lines and complexity ${LIMITS.complexity}, or its grandfathered ceiling`, () => {
  assert.ok(files.length > 50, "found too few files: is the glob broken?");
  const over = measured.flatMap((m) =>
    METRICS.filter((metric) => m[metric] > (grandfathered[m.key]?.[metric] ?? LIMITS[metric])).map(
      (metric) => `${m.key}: ${metric} ${m[metric]}`,
    ),
  );
  assert.deepEqual(over, [], "split the function; never raise a ceiling");
});

test("every grandfathered ceiling equals its function's measurement, which is over the limit", () => {
  const stale = Object.entries(grandfathered).flatMap(([key, ceiling]) => {
    const found = measured.filter((m) => m.key === key);
    if (found.length === 0) return [`${key}: no such function; rename the entry if it moved, else delete it`];
    return METRICS.flatMap((metric) => {
      const allowed = ceiling[metric];
      if (allowed === undefined) return [];
      const now = Math.max(...found.map((m) => m[metric]));
      if (now <= LIMITS[metric]) return [`${key}: ${metric} ${now} fits; delete it`];
      return now < allowed ? [`${key}: ${metric} ${now}; lower the ceiling to it`] : [];
    });
  });
  assert.deepEqual(stale, []);
});
