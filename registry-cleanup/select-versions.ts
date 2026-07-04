const hashTag = /^[0-9a-f]{40}$/;
const manifestVersion = /^sha256:[0-9a-f]{64}$/;

export type HashTagPlan = {
  deletions: string[];
  keptTags: string[];
};

export function planHashTagDeletions(input: {
  branchHeadShas: string[];
  releaseTagShas: string[];
  versions: string[];
}): HashTagPlan {
  const keep = new Set([...input.branchHeadShas, ...input.releaseTagShas]);
  const deletions: string[] = [];
  const keptTags: string[] = [];
  for (const version of input.versions) {
    if (manifestVersion.test(version)) continue;
    if (hashTag.test(version) && !keep.has(version)) deletions.push(version);
    else keptTags.push(version);
  }
  return { deletions, keptTags };
}

export function selectOrphanedManifests(input: {
  referencedDigests: string[];
  versions: string[];
}): string[] {
  const referenced = new Set(input.referencedDigests);
  return input.versions.filter((v) => manifestVersion.test(v) && !referenced.has(v));
}
