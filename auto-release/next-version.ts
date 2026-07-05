// Pure release-version math for the Renovate auto-release (see renovate.yml → auto-release job,
// README → CI/CD). Renovate stamps each commit with a `Release-Bump: <updateType>` trailer; the
// workflow feeds those values here to pick the next `vX.Y.Z` tag. Kept side-effect-free and unit
// tested (next-version.test.ts) — the git/tag/push side lives in the workflow shell.

export type Bump = "major" | "minor" | "patch";

// A dependency change is always at least a patch; only a real major/minor escalates.
export function bumpFromUpdateType(updateType: string): Bump {
  if (updateType === "major") return "major";
  if (updateType === "minor") return "minor";
  return "patch";
}

export function maxLevel(updateTypes: string[]): Bump {
  let level: Bump = "patch";
  for (const updateType of updateTypes) {
    const bump = bumpFromUpdateType(updateType);
    if (bump === "major") return "major";
    if (bump === "minor") level = "minor";
  }
  return level;
}

// Pre-1.0 (major===0) shifts every level down one notch, so a dependency major only bumps the 0.x
// minor and we never auto-cross into 1.0.0 — that stays a deliberate human milestone.
export function nextVersion(latestTag: string, level: Bump): string {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(latestTag);
  if (!match) throw new Error(`latest tag must be vX.Y.Z, got ${JSON.stringify(latestTag)}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const effective: Bump = major === 0 ? (level === "major" ? "minor" : "patch") : level;
  if (effective === "major") return `v${major + 1}.0.0`;
  if (effective === "minor") return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

// CLI: node auto-release/next-version.ts <latestTag> [updateType...] → prints the next tag.
if (process.argv[1]?.endsWith("/next-version.ts")) {
  const [, , latestTag, ...updateTypes] = process.argv;
  process.stdout.write(nextVersion(latestTag ?? "", maxLevel(updateTypes)));
}
