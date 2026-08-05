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
// declared name. A group's members hold them transitively; that expansion is Keto's job at login,
// and this screen edits the direct edge only.
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

export interface PermissionChoice {
  checked: boolean;
  description: string;
  name: string;
}

export interface PermissionPicker {
  action: string;
  choices: PermissionChoice[];
  empty: string | undefined; // set when no plugin declares a permission — the picker has nothing to offer
  field: string;
  legend: string;
  submit: string;
}

// The checkbox list: every declared permission, ticked where this subject already holds it. A fixed
// list means the form is the whole truth — what it posts back *is* the desired set (applyGrants).
export function buildPermissionPicker(opts: {
  action: string;
  declared: PermissionDecl[];
  held: string[];
  t?: Translate;
}): PermissionPicker {
  const t = opts.t ?? ((k: string) => k);
  const heldSet = new Set(opts.held);
  return {
    action: opts.action,
    choices: opts.declared.map((decl) => ({ checked: heldSet.has(decl.name), description: decl.description ?? "", name: decl.name })),
    empty: opts.declared.length === 0 ? t("admin.grants.none") : undefined,
    field: PERMISSIONS_FIELD,
    legend: t("admin.grants.legend"),
    submit: t("admin.grants.save"),
  };
}

// What a submitted set changes. Pure so the diff is testable without Keto: only declared names are
// considered, so a crafted POST cannot grant something no plugin gates on, and a held-but-undeclared
// name (left over from an uninstalled plugin) is never silently revoked by an unrelated save.
export function grantDiff(declared: PermissionDecl[], held: string[], wanted: string[]): { grant: string[]; revoke: string[] } {
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
