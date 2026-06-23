// Keto client: typed `fetch` wrappers over Ory Keto's relation-tuple APIs —
// `check` a permission, `listRelations`/`expand` to inspect them (read API), `writeTuple`/
// `deleteTuple` to grant/revoke them (write API). Built-in `fetch` only, no SDK dep (AGENTS.md);
// `fetchImpl`-injectable like the kratos clients. Read/write split onto the two ports config.ts
// targets (ketoReadUrl 4466 / ketoWriteUrl 4467).

// A subject set: a relation on another object (e.g. Group:eng#members), resolved
// transitively. The other Keto subject form is a direct `subject_id` string.
export interface SubjectSet {
  namespace: string;
  object: string;
  relation: string;
}

// A relationship tuple — the wire shape for writes and the filter shape for reads. Subject
// is `subject_id` xor `subject_set` (never both). Mirrors bootstrap.ts's roleTuple.
export interface RelationTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_id?: string;
  subject_set?: SubjectSet;
}

// Any subset of a tuple's fields filters a list query; the rest paginate.
export type RelationQuery = Partial<RelationTuple> & { pageSize?: number; pageToken?: string };

export interface RelationList {
  nextPageToken: string | null; // keyset cursor for the next page; null on the last page
  tuples: RelationTuple[];
}

// Keto's expand tree: a node is a set operation (union/…) or a leaf. The resolved subject
// (subject_id xor subject_set) rides on `tuple`, not the node itself — verified against Keto
// v26.2.0. A `subject_set` node carries its members as `children` ("effective access" view).
export interface ExpandTree {
  children?: ExpandTree[];
  tuple?: RelationTuple;
  type: string;
}

// Carries the HTTP status so a caller can branch (parallels KratosError).
export class KetoError extends Error {
  body: string;
  status: number;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.body = body;
    this.name = "KetoError";
    this.status = status;
  }
}

export interface KetoClient {
  check(tuple: RelationTuple, opts?: { maxDepth?: number }): Promise<boolean>;
  deleteTuple(tuple: RelationTuple): Promise<void>;
  expand(set: SubjectSet, opts?: { maxDepth?: number }): Promise<ExpandTree>;
  listRelations(query?: RelationQuery): Promise<RelationList>;
  writeTuple(tuple: RelationTuple): Promise<void>;
}

// namespace/object/relation + the chosen subject form → query params (Keto's read API and
// tuple delete both filter this way; subject sets use dotted `subject_set.*` keys).
function tupleParams(t: Partial<RelationTuple>): URLSearchParams {
  const p = new URLSearchParams();
  if (t.namespace !== undefined) p.set("namespace", t.namespace);
  if (t.object !== undefined) p.set("object", t.object);
  if (t.relation !== undefined) p.set("relation", t.relation);
  if (t.subject_id !== undefined) p.set("subject_id", t.subject_id);
  if (t.subject_set) {
    p.set("subject_set.namespace", t.subject_set.namespace);
    p.set("subject_set.object", t.subject_set.object);
    p.set("subject_set.relation", t.subject_set.relation);
  }
  return p;
}

export function createKetoClient(config: { fetchImpl?: typeof fetch; readUrl: string; writeUrl: string }): KetoClient {
  const read = config.readUrl.replace(/\/+$/, "");
  const write = config.writeUrl.replace(/\/+$/, "");
  const http = config.fetchImpl ?? fetch;
  const tuples = `${write}/admin/relation-tuples`;

  async function fail(action: string, res: Response): Promise<never> {
    throw new KetoError(`Keto ${action} failed (${res.status})`, res.status, await res.text());
  }

  return {
    async check(tuple, opts = {}) {
      const params = tupleParams(tuple);
      if (opts.maxDepth !== undefined) params.set("max-depth", String(opts.maxDepth));
      const res = await http(`${read}/relation-tuples/check?${params}`);
      // Keto answers 200 {allowed:true} or 403 {allowed:false}; both carry the verdict.
      if (res.status !== 200 && res.status !== 403) return fail("check", res);
      return ((await res.json()) as { allowed?: boolean }).allowed === true;
    },

    async deleteTuple(tuple) {
      const res = await http(`${tuples}?${tupleParams(tuple)}`, { method: "DELETE" });
      if (res.status !== 204) await fail("delete tuple", res);
    },

    async expand(set, opts = {}) {
      const params = tupleParams(set);
      if (opts.maxDepth !== undefined) params.set("max-depth", String(opts.maxDepth));
      const res = await http(`${read}/relation-tuples/expand?${params}`);
      if (res.status !== 200) return fail("expand", res);
      return (await res.json()) as ExpandTree;
    },

    async listRelations(query = {}) {
      const params = tupleParams(query);
      if (query.pageSize !== undefined) params.set("page_size", String(query.pageSize));
      if (query.pageToken) params.set("page_token", query.pageToken);
      const res = await http(`${read}/relation-tuples?${params}`);
      if (res.status !== 200) return fail("list relations", res);
      const body = (await res.json()) as { next_page_token?: string; relation_tuples?: RelationTuple[] };
      return { nextPageToken: body.next_page_token || null, tuples: body.relation_tuples ?? [] };
    },

    // PUT is idempotent — re-asserting an existing tuple is a no-op grant.
    async writeTuple(tuple) {
      const res = await http(tuples, { body: JSON.stringify(tuple), headers: { "content-type": "application/json" }, method: "PUT" });
      if (!res.ok) await fail("write tuple", res);
    },
  };
}
