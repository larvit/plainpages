// Publishes the Docker Hub repository overview from dockerhub-overview.md.tmpl. The page is the
// first thing an adopter copies, so `{{VERSION}}` is rendered from the release being published
// rather than written by hand.

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
  const token = process.env["DOCKERHUB_OVERVIEW_TOKEN"];
  if (!version || !repo || !user || !token) {
    process.stderr.write(
      "usage: dockerhub-overview.ts <version>; needs DOCKERHUB_REPO, DOCKERHUB_USER, DOCKERHUB_OVERVIEW_TOKEN\n",
    );
    return 1;
  }

  const body = renderOverview(readFileSync("release-tooling/dockerhub-overview.md.tmpl", "utf8"), version);
  const leftover = leftoverPlaceholders(body);
  if (leftover.length > 0) {
    process.stderr.write(`release-tooling/dockerhub-overview.md.tmpl has unrendered placeholders: ${leftover.join(", ")}\n`);
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
          ? "403 means DOCKERHUB_OVERVIEW_TOKEN cannot edit repository metadata — that is a separate " +
            "permission from pushing images, which is why it is its own secret (README -> CI/CD).\n"
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
