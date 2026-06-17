// Kratos admin-API client (todo §4): typed `fetch` wrappers over Ory Kratos' admin
// endpoints — identity CRUD and the surgical `metadata_public` update login completion
// projects Keto roles into (README). Built-in `fetch` only, no SDK dep (AGENTS.md);
// `fetchImpl`-injectable like kratos-public.ts. Reuses that module's `KratosError` so a
// caller can branch on `.status`. Admin endpoints listen on the internal-only admin port.
import { KratosError } from "./kratos-public.ts";

export interface Identity {
  id: string;
  metadata_admin?: unknown;
  metadata_public?: unknown;
  schema_id?: string;
  state?: string;
  traits?: Record<string, unknown>;
}

export interface IdentityList {
  identities: Identity[];
  nextPageToken: string | null; // keyset cursor for the next page; null on the last page
}

export interface ListOptions {
  credentialsIdentifier?: string; // exact-match filter on a login identifier (e.g. email)
  ids?: string[];
  pageSize?: number;
  pageToken?: string;
}

export interface KratosAdmin {
  createIdentity(payload: unknown): Promise<Identity>;
  deleteIdentity(id: string): Promise<void>;
  getIdentity(id: string): Promise<Identity | null>;
  listIdentities(opts?: ListOptions): Promise<IdentityList>;
  updateIdentity(id: string, payload: unknown): Promise<Identity>;
  updateMetadataPublic(id: string, metadata: unknown): Promise<Identity>;
}

// Kratos paginates with a Link header; pull the page_token of rel="next" (the href is a
// relative path, so resolve it against a throwaway base just to read the query param).
function nextPageToken(link: string | null): string | null {
  const href = link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
  return href ? new URL(href, "http://kratos").searchParams.get("page_token") : null;
}

export function createKratosAdmin(config: { baseUrl: string; fetchImpl?: typeof fetch }): KratosAdmin {
  const base = config.baseUrl.replace(/\/+$/, "");
  const http = config.fetchImpl ?? fetch;
  const json = { "content-type": "application/json" };
  const identity = (id: string) => `${base}/admin/identities/${encodeURIComponent(id)}`;

  async function fail(action: string, res: Response): Promise<never> {
    throw new KratosError(`Kratos admin ${action} failed (${res.status})`, res.status, await res.text());
  }

  return {
    async createIdentity(payload) {
      const res = await http(`${base}/admin/identities`, { body: JSON.stringify(payload), headers: json, method: "POST" });
      if (res.status !== 201) return fail("create identity", res);
      return (await res.json()) as Identity;
    },

    async deleteIdentity(id) {
      const res = await http(identity(id), { method: "DELETE" });
      if (res.status !== 204) await fail("delete identity", res);
    },

    async getIdentity(id) {
      const res = await http(identity(id));
      if (res.status === 404) return null;
      if (res.status !== 200) return fail("get identity", res);
      return (await res.json()) as Identity;
    },

    async listIdentities(opts = {}) {
      const url = new URL(`${base}/admin/identities`);
      if (opts.credentialsIdentifier) url.searchParams.set("credentials_identifier", opts.credentialsIdentifier);
      for (const id of opts.ids ?? []) url.searchParams.append("ids", id);
      if (opts.pageSize !== undefined) url.searchParams.set("page_size", String(opts.pageSize));
      if (opts.pageToken) url.searchParams.set("page_token", opts.pageToken);
      const res = await http(url);
      if (res.status !== 200) return fail("list identities", res);
      return { identities: (await res.json()) as Identity[], nextPageToken: nextPageToken(res.headers.get("link")) };
    },

    async updateIdentity(id, payload) {
      const res = await http(identity(id), { body: JSON.stringify(payload), headers: json, method: "PUT" });
      if (res.status !== 200) return fail("update identity", res);
      return (await res.json()) as Identity;
    },

    // JSON Patch `add` sets metadata_public whether it's currently absent, null, or set, and
    // touches nothing else — so the login role projection never clobbers traits/state.
    // (metadata_public, not _admin: the session the tokenizer sees carries only public metadata.)
    async updateMetadataPublic(id, metadata) {
      const patch = [{ op: "add", path: "/metadata_public", value: metadata }];
      const res = await http(identity(id), { body: JSON.stringify(patch), headers: json, method: "PATCH" });
      if (res.status !== 200) return fail("update metadata_public", res);
      return (await res.json()) as Identity;
    },
  };
}
