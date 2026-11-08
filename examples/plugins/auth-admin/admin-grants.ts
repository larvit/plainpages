// Permission grants, shared by the Users and Groups screens. A permission is held by a user
// (`Permission:<name>#granted@user:<id>`) or by a whole group (`…@Group:<name>#members`), and Keto
// resolves a group's grant transitively at login.
//
// The set of permissions that *exist* is `ctx.declaredPermissions` — the host's catalog, built from
// what the installed plugins declare in code. Nothing here invents a name: a grant is a property of a
// user or a group, edited where they are.

import { createHash } from "node:crypto";
import type { KetoClient, PermissionDecl, RelationTuple, SubjectSet, Translate } from "@plainpages/plugin-api";

const PERMISSION_NS = "Permission";
const GRANTED = "granted";
export const PERMISSIONS_FIELD = "permission"; // the checkbox name the two forms post
export const REMOVE_FIELD = "remove"; // the hidden field naming the undeclared grant a Remove form drops
export const BASELINE_FIELD = "baseline"; // the hidden field carrying baselineToken
export const SAVED_NOTICE = "permissions-saved"; // the `info-msg` a successful save redirects with
export const REMOVED_NOTICE = "permission-removed"; // the `info-msg` a Remove redirects with; its own words, since the checkboxes were not saved

// Only these exact values count, so a crafted link can't put words on the page.
export function grantsNotice(url: URL, t: Translate): string | undefined {
  const msg = url.searchParams.get("info-msg");
  if (msg === SAVED_NOTICE) return t("admin.grants.saved");
  return msg === REMOVED_NOTICE ? t("admin.grants.removed") : undefined;
}

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
  baseline: string; // baselineToken of the direct grants this form was rendered from
  choices: PermissionChoice[];
  empty: string | undefined; // set when no plugin declares a permission — the picker has nothing to offer
  error?: string; // a rejected save (e.g. the self-revoke guard), rendered above the list
  field: string;
  hint: string;
  inheritedNote: string | undefined; // set when at least one choice is group-held, to explain the disabled row
  legend: string;
  notice?: string; // a confirmation, rendered above the list
  // Set for a group: its members hold these transitively, so a change reaches them at their next
  // re-mint rather than at once. The user picker revokes live tokens, so it says nothing.
  pending: string | undefined;
  readOnly: boolean; // the viewer holds :read but not :write — show the state, offer no save
  submit: string;
  undeclared: UndeclaredGrants | undefined; // set when the subject holds a name no installed plugin declares
}

// Direct grants of names nobody declares (their plugin was uninstalled, or the name was written to
// Keto by hand). grantDiff never touches them, so they get their own list and a Remove per name.
export interface UndeclaredGrants {
  action: string; // where each Remove posts
  field: string;
  hint: string;
  legend: string;
  names: string[];
  remove: string | undefined; // the button label; unset for a reader, who is shown the names only
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
  const undeclared = undeclaredHeld(opts.declared, opts.direct);
  const effectiveSet = new Set(opts.effective ?? opts.direct);
  const choices = opts.declared.map((decl) => ({
    checked: directSet.has(decl.name) || effectiveSet.has(decl.name),
    description: decl.description ?? "",
    inherited: !directSet.has(decl.name) && effectiveSet.has(decl.name),
    name: decl.name,
  }));
  return {
    action: opts.action,
    baseline: baselineToken(opts.declared, opts.direct),
    choices,
    empty: opts.declared.length === 0 ? t("admin.grants.none") : undefined,
    field: PERMISSIONS_FIELD,
    // A reader sees every row disabled, so "tick to grant" is false and "greyed-out means group-held"
    // is worse than false — it would misattribute a *direct* grant to a group that doesn't hold it.
    hint: t(opts.readOnly === true ? "admin.grants.hintReadOnly" : "admin.grants.hint"),
    inheritedNote: opts.readOnly !== true && choices.some((c) => c.inherited) ? t("admin.grants.inherited") : undefined,
    legend: t("admin.grants.legend"),
    pending: opts.transitive === true ? t("admin.grants.pending") : undefined,
    readOnly: opts.readOnly === true,
    submit: t("admin.grants.save"),
    undeclared: undeclared.length === 0 ? undefined : {
      action: `${opts.action}/remove`,
      field: REMOVE_FIELD,
      hint: t("admin.grants.undeclaredHint"),
      legend: t("admin.grants.undeclaredLegend"),
      names: undeclared,
      remove: opts.readOnly === true ? undefined : t("admin.grants.remove"),
    },
  };
}

const undeclaredHeld = (declared: readonly PermissionDecl[], held: readonly string[]): string[] => {
  const offered = new Set(declared.map((d) => d.name));
  return held.filter((name) => !offered.has(name)).sort();
};

// What a submitted set changes. Pure so the diff is testable without Keto: only declared names are
// considered, so a crafted POST cannot grant something no plugin gates on, and a held-but-undeclared
// name (left over from an uninstalled plugin) is never silently revoked by an unrelated save.
export function grantDiff(declared: readonly PermissionDecl[], held: string[], wanted: string[]): GrantChange {
  const offered = new Set(declared.map((d) => d.name));
  const heldSet = new Set(held);
  const wantedSet = new Set(wanted.filter((name) => offered.has(name)));
  return {
    grant: [...wantedSet].filter((name) => !heldSet.has(name)).sort(),
    revoke: [...heldSet].filter((name) => offered.has(name) && !wantedSet.has(name)).sort(),
  };
}

// Deletes one held grant of a name no plugin declares and returns the name. Deletes nothing for a
// declared name, which the picker owns (so a Remove can't take away this plugin's own gates and needs
// no self-lockout guard), or for one not held, as after a double click.
export async function removeUndeclaredGrant(keto: KetoClient, subject: GrantSubject, declared: readonly PermissionDecl[], name: string | null): Promise<string | undefined> {
  if (name === null || declared.some((d) => d.name === name)) return undefined;
  if (!(await heldPermissions(keto, subject)).includes(name)) return undefined;
  await keto.deleteTuple(grantTuple(name, subject));
  return name;
}

// A token for the direct grants a form was rendered from. Like grantDiff it covers only the declared
// names the form offered. It is a digest so an empty set is still a token; it is a guard against a
// stale page, not a secret, since anyone who can read the page can compute it.
export function baselineToken(declared: readonly PermissionDecl[], held: string[]): string {
  const offered = new Set(declared.map((d) => d.name));
  return createHash("sha256").update(held.filter((name) => offered.has(name)).sort().join("\n")).digest("hex").slice(0, 16);
}

// True when the form's token is missing or no longer matches Keto *and* the save would change
// something. A save that changes nothing, such as a double-clicked Save whose first POST landed, is
// harmless, so it is not refused.
export const isStale = (form: { get(name: string): string | null }, declared: readonly PermissionDecl[], held: string[], diff: GrantChange): boolean =>
  (diff.grant.length > 0 || diff.revoke.length > 0) && form.get(BASELINE_FIELD) !== baselineToken(declared, held);

export interface GrantChange { grant: string[]; revoke: string[] }

export const applyGrants = (keto: KetoClient, subject: GrantSubject, diff: GrantChange): Promise<void> =>
  keto.transactTuples({ delete: diff.revoke.map((name) => grantTuple(name, subject)), insert: diff.grant.map((name) => grantTuple(name, subject)) });
