// The plugin contract version and the release version are one number (README → Contract
// versioning). This is the gate that keeps them one: a tag whose major.minor disagrees with
// HOST_API_VERSION would ship a host that misreports itself to every plugin's compatibility check.
// Pure and unit tested; the git/tag side lives in the workflows that call the CLI below.

export type ContractCheck = { ok: true } | { ok: false; error: string };

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function readHostApiVersion(source: string): string | null {
  return /HOST_API_VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1] ?? null;
}

// Patch is deliberately not compared: checkApiVersion ignores it, and auto-release cuts patch
// releases with no commit to bump the constant in.
export function checkTagMatchesContract(tag: string, hostApiVersion: string | null): ContractCheck {
  if (hostApiVersion === null) {
    return { error: "HOST_API_VERSION not found", ok: false };
  }
  const t = SEMVER.exec(tag);
  if (!t) return { error: `tag must be vX.Y.Z, got ${JSON.stringify(tag)}`, ok: false };
  const h = SEMVER.exec(hostApiVersion);
  if (!h) return { error: `HOST_API_VERSION must be X.Y.Z, got ${JSON.stringify(hostApiVersion)}`, ok: false };
  if (t[1] === h[1] && t[2] === h[2]) return { ok: true };
  return {
    error:
      `${tag} does not match HOST_API_VERSION ${hostApiVersion} — the contract version IS the release ` +
      `version. Set HOST_API_VERSION to ${t[1]}.${t[2]}.0 in src/plugin-host/plugin.ts, merge that, ` +
      "then tag.",
    ok: false,
  };
}

// CLI: node release-tooling/contract-version.ts <tag> <path/to/plugin.ts | -> → exits 1 on
// mismatch. `-` reads the source on stdin, so a caller checking a ref other than its checkout
// (`git show origin/main:… | …`) needs no scratch file in the workspace.
if (process.argv[1]?.endsWith("/contract-version.ts")) {
  const [, , tag, pluginPath = "src/plugin-host/plugin.ts"] = process.argv;
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(pluginPath === "-" ? 0 : pluginPath, "utf8");
  const result = checkTagMatchesContract(tag ?? "", readHostApiVersion(source));
  if (!result.ok) {
    process.stderr.write(`${pluginPath}: ${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write(`${tag} matches HOST_API_VERSION\n`);
}
