// Prunes the app's container package in the Gitea registry: a commit-hash tag survives only
// while its commit is a branch head or carries a vX.Y.Z release tag. Untagged sha256:* package
// versions are CHILD manifests (arch image + provenance) of the tagged OCI indexes — deleting
// one that a surviving tag still references breaks that image, so only the ones no kept tag
// references are removed. Named tags (1.2.3, latest, …) are never touched.
import { planHashTagDeletions, selectOrphanedManifests } from "./select-versions.ts";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing env var ${name}`);
  return value;
}

const registryToken = env("REGISTRY_TOKEN");
const registryUser = env("REGISTRY_USER");
const repoToken = env("REPO_TOKEN");
const repository = env("REPOSITORY");
const serverUrl = env("SERVER_URL").replace(/\/+$/, "");

const [owner, name] = repository.split("/");
if (owner === undefined || name === undefined || owner === "" || name === "") {
  throw new Error(`REPOSITORY must be owner/name, got "${repository}"`);
}

async function fetchOk(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status}: ${await res.text()}`);
  return res;
}

async function apiGetAllPages<T>(path: string, token: string): Promise<T[]> {
  const all: T[] = [];
  const limit = 50;
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetchOk(`${serverUrl}/api/v1${path}${sep}limit=${limit}&page=${page}`, {
      headers: { authorization: `token ${token}` },
    });
    const batch = (await res.json()) as T[];
    // Stop on an empty page, not a short one — a lowered server page-size cap would otherwise
    // silently truncate the list, and a truncated branch/tag list deletes protected images.
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function childDigests(tag: string): Promise<string[]> {
  const res = await fetchOk(`${serverUrl}/v2/${owner}/${name}/manifests/${tag}`, {
    headers: {
      accept: [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
      ].join(", "),
      authorization: `Basic ${Buffer.from(`${registryUser}:${registryToken}`).toString("base64")}`,
    },
  });
  const manifest = (await res.json()) as { manifests?: { digest: string }[] };
  return (manifest.manifests ?? []).map((m) => m.digest);
}

async function deleteVersion(version: string): Promise<void> {
  const url = `${serverUrl}/api/v1/packages/${owner}/container/${name}/${encodeURIComponent(version)}`;
  const res = await fetch(url, { headers: { authorization: `token ${registryToken}` }, method: "DELETE" });
  if (res.status === 404) {
    console.log(`already gone: ${version}`);
    return;
  }
  if (!res.ok) throw new Error(`DELETE ${url} -> ${res.status}: ${await res.text()}`);
  console.log(`deleted: ${version}`);
}

const branches = await apiGetAllPages<{ commit: { id: string } }>(`/repos/${owner}/${name}/branches`, repoToken);
if (branches.length === 0) throw new Error("no branches returned — refusing to prune with an empty keep-set");
const tags = await apiGetAllPages<{ commit: { sha: string }; name: string }>(`/repos/${owner}/${name}/tags`, repoToken);
const packages = await apiGetAllPages<{ name: string; version: string }>(
  `/packages/${owner}?type=container&q=${encodeURIComponent(name)}`,
  registryToken,
);

const versions = packages.filter((p) => p.name === name).map((p) => p.version);
const plan = planHashTagDeletions({
  branchHeadShas: branches.map((b) => b.commit.id),
  releaseTagShas: tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t.name)).map((t) => t.commit.sha),
  versions,
});

const referenced = new Set<string>();
for (const tag of plan.keptTags) {
  for (const digest of await childDigests(tag)) referenced.add(digest);
}
const orphans = selectOrphanedManifests({ referencedDigests: [...referenced], versions });

for (const version of [...plan.deletions, ...orphans]) await deleteVersion(version);
console.log(
  `kept ${plan.keptTags.length} tags; deleted ${plan.deletions.length} hash tags and ${orphans.length} orphaned manifests`,
);
