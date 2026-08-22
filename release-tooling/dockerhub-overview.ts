// Publishes the Docker Hub repository overview from dockerhub-overview.md.tmpl, rendering
// `{{VERSION}}` to the release being published.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const HUB = "https://hub.docker.com/v2";
const TIMEOUT_MS = 30_000;
const VERSION = /^\d+\.\d+\.\d+$/;

export function renderOverview(source: string, version: string): string {
  return source.replaceAll("{{VERSION}}", version);
}

// A typo'd placeholder would publish literal braces to a public page, so fail the release instead.
export function leftoverPlaceholders(rendered: string): string[] {
  return [...new Set(rendered.match(/\{\{[^}]*\}\}/g) ?? [])];
}

export function jwtFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("token" in body)) return null;
  return typeof body.token === "string" && body.token !== "" ? body.token : null;
}

type Fetched = { error: string } | { json: unknown; ok: boolean; status: number; text: string };

// fetch and its body readers throw; this is the one edge that converts that into a value.
async function post(url: string, init: RequestInit): Promise<Fetched> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { json, ok: res.ok, status: res.status, text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<number> {
  const fail = (message: string): number => {
    process.stderr.write(`${message}\n`);
    return 1;
  };
  const [, , version] = process.argv;
  const repo = process.env["DOCKERHUB_REPO"];
  const user = process.env["DOCKERHUB_USER"];
  const token = process.env["DOCKERHUB_OVERVIEW_TOKEN"];
  if (!version || !repo || !user || !token) {
    return fail(
      "usage: dockerhub-overview.ts <X.Y.Z>; needs DOCKERHUB_REPO, DOCKERHUB_USER and " +
        "DOCKERHUB_OVERVIEW_TOKEN (README -> CI/CD)",
    );
  }
  // The page is public, so never render a version that resolves to no image.
  if (!VERSION.test(version)) return fail(`version must be X.Y.Z, got ${JSON.stringify(version)}`);

  const templatePath = join(import.meta.dirname, "dockerhub-overview.md.tmpl");
  let template = "";
  try {
    template = readFileSync(templatePath, "utf8");
  } catch (err) {
    return fail(`${templatePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = renderOverview(template, version);
  const leftover = leftoverPlaceholders(body);
  if (leftover.length > 0) return fail(`${templatePath} has unrendered placeholders: ${leftover.join(", ")}`);

  const login = await post(`${HUB}/users/login`, {
    body: JSON.stringify({ password: token, username: user }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if ("error" in login) return fail(`Docker Hub login unreachable: ${login.error}`);
  if (!login.ok) return fail(`Docker Hub login failed: ${login.status} ${login.text}`);
  const jwt = jwtFrom(login.json);
  if (!jwt) return fail("Docker Hub login returned no token");

  const res = await post(`${HUB}/repositories/${repo}/`, {
    body: JSON.stringify({ full_description: body }),
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    method: "PATCH",
  });
  if ("error" in res) return fail(`Docker Hub unreachable: ${res.error}`);
  if (!res.ok) {
    return fail(
      `Docker Hub overview PATCH failed: ${res.status} ${res.text}` +
        (res.status === 403
          ? "\n403 means DOCKERHUB_OVERVIEW_TOKEN lacks the delete scope — editing the overview needs " +
            "read/write/delete, which pushing images does not (README -> CI/CD)."
          : ""),
    );
  }
  process.stdout.write(`Docker Hub overview updated for ${repo} at ${version}\n`);
  return 0;
}

if (process.argv[1]?.endsWith("/dockerhub-overview.ts")) {
  process.exitCode = await main();
}
