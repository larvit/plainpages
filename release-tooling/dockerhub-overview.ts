// Publishes README-dockerhub.md as the Docker Hub repository overview. The page is the first thing
// an adopter copies, and its image tags were maintained by hand — they pointed at a version that no
// longer existed. `{{VERSION}}` is rendered from the tag being promoted, so they cannot go stale.

const HUB = "https://hub.docker.com/v2";

export function renderOverview(source: string, version: string): string {
  return source.replaceAll("{{VERSION}}", version);
}

// A typo'd placeholder would publish literal braces to a public page, so fail the release instead.
export function leftoverPlaceholders(rendered: string): string[] {
  return [...new Set(rendered.match(/\{\{[^}]*\}\}/g) ?? [])];
}

async function main(): Promise<number> {
  const [, , version] = process.argv;
  const { readFileSync } = await import("node:fs");
  const repo = process.env["DOCKERHUB_REPO"];
  const user = process.env["DOCKERHUB_USER"];
  const token = process.env["DOCKERHUB_TOKEN"];
  if (!version || !repo || !user || !token) {
    process.stderr.write("usage: dockerhub-overview.ts <version>; needs DOCKERHUB_REPO/USER/TOKEN\n");
    return 1;
  }

  const body = renderOverview(readFileSync("README-dockerhub.md", "utf8"), version);
  const leftover = leftoverPlaceholders(body);
  if (leftover.length > 0) {
    process.stderr.write(`README-dockerhub.md has unrendered placeholders: ${leftover.join(", ")}\n`);
    return 1;
  }

  const login = await fetch(`${HUB}/users/login`, {
    body: JSON.stringify({ password: token, username: user }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!login.ok) {
    process.stderr.write(`Docker Hub login failed: ${login.status} ${await login.text()}\n`);
    return 1;
  }
  const { token: jwt } = (await login.json()) as { token?: string };
  if (!jwt) {
    process.stderr.write("Docker Hub login returned no token\n");
    return 1;
  }

  const res = await fetch(`${HUB}/repositories/${repo}/`, {
    body: JSON.stringify({ full_description: body }),
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    method: "PATCH",
  });
  if (!res.ok) {
    const detail = await res.text();
    process.stderr.write(
      `Docker Hub overview PATCH failed: ${res.status} ${detail}\n` +
        (res.status === 403
          ? "403 usually means the token is scoped to the repository's images only — publishing the " +
            "overview edits repository metadata and needs a token with that permission (README -> CI/CD).\n"
          : ""),
    );
    return 1;
  }
  process.stdout.write(`Docker Hub overview updated for ${repo} at ${version}\n`);
  return 0;
}

if (process.argv[1]?.endsWith("/dockerhub-overview.ts")) {
  process.exit(await main());
}
