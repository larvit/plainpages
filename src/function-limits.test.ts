// Fails the gate on a function over ESLint's default limits, measured as ESLint measures them:
// `max-lines-per-function` (50 lines, blanks and comments included, IIFEs skipped) and `complexity`
// (20). acorn parses what Node's own type stripping leaves, which is the code Node runs. Not ESLint
// itself: parsing TypeScript takes typescript-eslint, which needs the compiler API TypeScript 7 no
// longer ships. acorn has no dependencies.
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { parse } from "acorn";

const MAX_LINES = 50;
const MAX_COMPLEXITY = 20;

// Each function over a limit when the gate began, at its size then. It may shrink but never grow,
// and a metric leaves its entry once it fits.
const grandfathered: Record<string, { lines?: number; complexity?: number }> = {
  "src/http/app.ts createApp": { lines: 318, complexity: 28 },
  "src/http/app.ts createApp > handleRequest": { lines: 168, complexity: 43 },
  "src/auth/routes.ts flowPage": { lines: 64 },
  "src/auth/routes.ts flowPage > anonymous": { lines: 62, complexity: 23 },
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
// so an entry above survives edits that move it.
export function measure(source: string): Measured[] {
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
// The drop-in mounts hold an operator's code, not this repo's; tests read top to bottom as a script.
const files = globSync("**/*.ts", {
  cwd: root,
  exclude: ["**/node_modules/**", "plugins/**", "config/**", "locales/**", "**/*.d.ts", "**/*.test.ts", "**/*.spec.ts"],
});
const measured = new Map<string, Measured>(
  files.flatMap((file) => measure(readFileSync(new URL(file, root), "utf8")).map((m) => [`${file} ${m.name}`, m] as const)),
);

test("measure counts lines and complexity as ESLint does", () => {
  const source = [
    "function outer(a = 1): void {",
    "  if (a && b?.c) {}",
    "  const inner = () => (a ? 1 : 2);",
    "  (function () { if (a) {} })();",
    "}",
  ].join("\n");
  assert.deepEqual(measure(source), [
    { name: "outer", lines: 5, complexity: 5 },
    { name: "outer > inner", lines: 1, complexity: 2 },
    { name: "outer > anonymous", lines: 0, complexity: 2 },
  ]);
});

test(`every function fits ${MAX_LINES} lines and complexity ${MAX_COMPLEXITY}, or its grandfathered ceiling`, () => {
  assert.ok(files.length > 50, "scans the repo's TypeScript");
  const over = [...measured].flatMap(([key, m]) => {
    const ceiling = grandfathered[key] ?? {};
    const lines = m.lines > (ceiling.lines ?? MAX_LINES) ? [`${key}: ${m.lines} lines`] : [];
    const complexity = m.complexity > (ceiling.complexity ?? MAX_COMPLEXITY) ? [`${key}: complexity ${m.complexity}`] : [];
    return [...lines, ...complexity];
  });
  assert.deepEqual(over, [], "split the function; never raise a ceiling");
});

test("every grandfathered metric is still over its limit", () => {
  const fits = Object.entries(grandfathered).flatMap(([key, ceiling]) => {
    const m = measured.get(key);
    if (!m) return [`${key}: gone`];
    const lines = ceiling.lines !== undefined && m.lines <= MAX_LINES ? [`${key}: lines fit`] : [];
    const complexity = ceiling.complexity !== undefined && m.complexity <= MAX_COMPLEXITY ? [`${key}: complexity fits`] : [];
    return [...lines, ...complexity];
  });
  assert.deepEqual(fits, [], "delete what fits from the grandfathered list");
});
