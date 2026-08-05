// Permission grants, shared by the Users and Groups screens. A permission is held by a user
// (`Permission:<name>#granted@user:<id>`) or by a whole group (`…@Group:<name>#members`), and Keto
// resolves a group's grant transitively at login.
//
// The set of permissions that *exist* is `ctx.declaredPermissions` — the host's catalog, built from
// what the installed plugins declare in code. Nothing here invents a name, which is why the old
// Permissions screen is gone: a grant is a property of a user or a group, edited where they are.

import type { KetoClient, PermissionDecl, RelationTuple, SubjectSet, Translate } from "#plugin-api";

const PERMISSION_NS = "Permission";
const GRANTED = "granted";
export const PERMISSIONS_FIELD = "permission"; // the checkbox name the two forms post

export type GrantSubject = { subject_id: string } | { subject_set: SubjectSet };

export const userSubject = (id: string): GrantSubject => ({ subject_id: `user:${id}` });
export const groupSubject = (name: string): GrantSubject => ({ subject_set: { namespace: "Group", object: name, relation: "members" } });

export function grantTuple(permission: string, subject: GrantSubject): RelationTuple {
  return { namespace: PERMISSION_NS, object: permission, relation: GRANTED, ...subject };
}

// The permissions this subject holds *directly* — one Keto read filtered by the subject, not one per
// declared name. This is the edge the picker edits; `effectivePermissions` adds what a group confers.
export async function heldPermissions(keto: KetoClient, subject: GrantSubject): Promise<string[]> {
  const held = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await keto.listRelations({ namespace: PERMISSION_NS, relation: GRANTED, ...subject, ...(pageToken ? { pageToken } : {}) });
    for (const tuple of page.tuples) held.add(tuple.object);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return [...held].sort();
}

// Every declared permission the subject effectively holds — direct grants *plus* anything reached
// through a group, which is what actually lands in their JWT. One Keto check per declared name;
// the catalog is small and this is an admin screen (login does the same walk).
export async function effectivePermissions(keto: KetoClient, subject: GrantSubject, declared: readonly PermissionDecl[]): Promise<string[]> {
  const held = await Promise.all(declared.map((decl) => keto.check({ namespace: PERMISSION_NS, object: decl.name, relation: GRANTED, ...subject })));
  return declared.filter((_, i) => held[i]).map((decl) => decl.name);
}

export interface PermissionChoice {
  checked: boolean; // held directly — the only state this form can change
  description: string;
  // Effective through a group, not granted directly. Rendered ticked but disabled: the grant is real
  // (it reaches the JWT), and it is removed by editing the group, not this subject.
  inherited: boolean;
  name: string;
}

export interface PermissionPicker {
  action: string;
  choices: PermissionChoice[];
  empty: string | undefined; // set when no plugin declares a permission — the picker has nothing to offer
  error?: string; // a rejected save (e.g. the self-revoke guard), rendered above the list
  field: string;
  hint: string;
  inheritedNote: string | undefined; // set when at least one choice is group-held, to explain the disabled row
  legend: string;
  // Set for a group: its members hold these transitively, so a change reaches them at their next
  // re-mint rather than at once. The user picker revokes live tokens, so it says nothing.
  pending: string | undefined;
  readOnly: boolean; // the viewer holds :read but not :write — show the state, offer no save
  submit: string;
}

// The checkbox list: every declared permission, ticked where this subject holds it. A fixed list
// means the form is the whole truth — what it posts back *is* the desired set of *direct* grants
// (grantDiff). An inherited row is disabled, so it never posts and can never be diffed into a revoke.
export function buildPermissionPicker(opts: {
  action: string;
  declared: readonly PermissionDecl[];
  direct: string[];
  effective?: string[]; // omit when the caller can't resolve group-held grants; then only direct shows
  readOnly?: boolean;
  t?: Translate;
  transitive?: boolean; // a group: its members inherit, so the change lands at their next re-mint
}): PermissionPicker {
  const t = opts.t ?? ((k: string) => k);
  const directSet = new Set(opts.direct);
  const effectiveSet = new Set(opts.effective ?? opts.direct);
  const choices = opts.declared.map((decl) => ({
    checked: directSet.has(decl.name) || effectiveSet.has(decl.name),
    description: decl.description ?? "",
    inherited: !directSet.has(decl.name) && effectiveSet.has(decl.name),
    name: decl.name,
  }));
  return {
    action: opts.action,
    choices,
    empty: opts.declared.length === 0 ? t("admin.grants.none") : undefined,
    field: PERMISSIONS_FIELD,
    hint: t("admin.grants.hint"),
    inheritedNote: choices.some((c) => c.inherited) ? t("admin.grants.inherited") : undefined,
    legend: t("admin.grants.legend"),
    pending: opts.transitive === true ? t("admin.grants.pending") : undefined,
    readOnly: opts.readOnly === true,
    submit: t("admin.grants.save"),
  };
}

// What a submitted set changes. Pure so the diff is testable without Keto: only declared names are
// considered, so a crafted POST cannot grant something no plugin gates on, and a held-but-undeclared
// name (left over from an uninstalled plugin) is never silently revoked by an unrelated save.
export function grantDiff(declared: readonly PermissionDecl[], held: string[], wanted: string[]): { grant: string[]; revoke: string[] } {
  const offered = new Set(declared.map((d) => d.name));
  const heldSet = new Set(held);
  const wantedSet = new Set(wanted.filter((name) => offered.has(name)));
  return {
    grant: [...wantedSet].filter((name) => !heldSet.has(name)).sort(),
    revoke: [...heldSet].filter((name) => offered.has(name) && !wantedSet.has(name)).sort(),
  };
}

export async function applyGrants(keto: KetoClient, subject: GrantSubject, diff: { grant: string[]; revoke: string[] }): Promise<void> {
  for (const name of diff.grant) await keto.writeTuple(grantTuple(name, subject));
  for (const name of diff.revoke) await keto.deleteTuple(grantTuple(name, subject));
}
