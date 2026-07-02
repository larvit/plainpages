// OAuth2 clients admin screen: register / list / delete the OAuth2 clients other
// apps log in *through* us with (Ory Hydra, the login+consent handlers). A client is an Ory Hydra
// OAuth2 client; writes go only to Hydra. Hydra returns the client_secret once, on create — so the
// register POST renders the new client's detail page (with the one-time secret) directly instead of a
// PRG redirect (mirrors the Users "trigger recovery" one-time code). Below the builders are thin
// per-route handlers (keyed on ctx.params) over a shared `withClients` gate — admin-only, CSRF-guarded.

import { type HydraAdmin, HydraError, type OAuth2Client, paginate, parseListQuery, type RequestContext, type RouteHandler, type RouteResult, type User } from "#plugin-api";
import { ADMIN_CLIENTS_BASE, buildConfirmModel, guardedForm, notFound, requireAdmin, unavailable } from "./admin-shared.ts";
import type { FieldConfig } from "./admin-users.ts";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];
// One Hydra page is fetched and filtered/paged in memory — its list API has no search. Ample for an
// admin tool (the OAuth2 clients of a deployment number in the dozens); raise if one outgrows it.
const LIST_FETCH_SIZE = 250;
const DEFAULT_SCOPE = "openid offline_access";

export interface ClientView {
  firstParty: boolean;
  id: string; // client_id
  name: string;
  public: boolean; // public (PKCE, no secret) vs confidential
  redirectUris: string[];
  scopes: string[];
}

export interface ClientInput {
  firstParty: boolean;
  name: string;
  public: boolean;
  redirectUris: string[];
  scope: string;
}

export function toClientView(client: OAuth2Client): ClientView {
  const id = client.client_id ?? "";
  return {
    firstParty: (client.metadata as { first_party?: unknown } | undefined)?.first_party === true,
    id,
    name: client.client_name?.trim() || id || "(unnamed)",
    public: client.token_endpoint_auth_method === "none",
    redirectUris: client.redirect_uris ?? [],
    scopes: (client.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

// Split a textarea value into redirect URIs (one per line / whitespace / comma), dropping empties.
export function parseRedirectUris(raw: string): string[] {
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

// Hydra's create body. We register a standard authorization-code web/native client (+ refresh);
// the type (confidential vs public/PKCE) and auto-consent ride the auth method + metadata.
export function clientPayload(input: ClientInput): Record<string, unknown> {
  return {
    client_name: input.name,
    grant_types: ["authorization_code", "refresh_token"],
    metadata: { first_party: input.firstParty },
    redirect_uris: input.redirectUris,
    response_types: ["code"],
    scope: input.scope,
    token_endpoint_auth_method: input.public ? "none" : "client_secret_basic",
  };
}

export function validateClientInput(input: ClientInput): string | null {
  if (!input.name) return "Enter a name for the client.";
  if (!input.redirectUris.length) return "Add at least one redirect URI.";
  for (const uri of input.redirectUris) {
    try {
      new URL(uri); // must be an absolute URL — any scheme (public/native clients use custom ones)
    } catch {
      return `"${uri}" is not a valid redirect URI — use an absolute URL like https://app.example.com/callback.`;
    }
  }
  return null;
}

// ---- list view model ----

interface ListState {
  page: number;
  pageSize: number;
  q: string;
}

function detailHref(id: string): string {
  return `${ADMIN_CLIENTS_BASE}/${encodeURIComponent(id)}`;
}

function listHref(state: ListState, overrides: Partial<ListState> = {}): string {
  const s = { ...state, ...overrides };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.page > 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(s.pageSize));
  const qs = p.toString();
  return qs ? `${ADMIN_CLIENTS_BASE}?${qs}` : ADMIN_CLIENTS_BASE;
}

export function buildClientsListModel(opts: {
  clients: OAuth2Client[];
  csrfToken?: string;
  url: URL | URLSearchParams | string;
}) {
  const query = parseListQuery(opts.url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const needle = query.q.toLowerCase();

  const all = opts.clients.map(toClientView);
  const list = all.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle));

  const page = paginate(list.length, query.page, query.pageSize, { boundaries: 1, siblings: 1 });
  const start = (page.page - 1) * page.pageSize;
  const rows = list.slice(start, start + page.pageSize);
  const state: ListState = { page: page.page, pageSize: page.pageSize, q: query.q };

  return {
    breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "Admin" }, { label: "OAuth2 clients" }],
    filterBar: listFilterBar(state),
    pagination: listPagination(state, page),
    table: listTable(rows),
    title: "OAuth2 clients",
  };
}

function listTable(rows: ClientView[]) {
  return {
    caption: "OAuth2 clients",
    columns: [{ label: "Name" }, { label: "Client ID" }, { label: "Type" }],
    rows: rows.map((c) => ({
      cells: [
        { rowHeader: { href: detailHref(c.id), text: c.name } },
        { className: "cell-muted", text: c.id },
        { badge: { label: c.public ? "Public" : "Confidential", tone: c.public ? "warn" : "info" } },
      ],
      name: c.name,
    })),
  };
}

function listFilterBar(state: ListState) {
  const pills: { label: string; remove: string; value: string }[] = [];
  if (state.q) pills.push({ label: "Search", remove: listHref(state, { page: 1, q: "" }), value: state.q });
  return {
    applyLabel: "Apply",
    clearHref: ADMIN_CLIENTS_BASE,
    label: "Filter clients",
    pills,
    rows: [[
      { label: "Search clients", name: "q", placeholder: "Search name or client ID…", type: "search", value: state.q },
      { type: "spacer" },
    ]],
  };
}

function listPagination(state: ListState, page: ReturnType<typeof paginate>) {
  const hidden: { name: string; value: string }[] = [];
  if (state.q) hidden.push({ name: "q", value: state.q });
  return {
    label: "Clients pagination",
    next: { href: page.next ? listHref(state, { page: page.next }) : undefined },
    pages: page.pages.map((p) =>
      p.ellipsis ? { ellipsis: true }
        : p.current ? { current: true, label: String(p.page) }
          : { href: listHref(state, { page: p.page as number }), label: String(p.page) }),
    prev: { href: page.prev ? listHref(state, { page: page.prev }) : undefined },
    rows: { hidden, label: "Rows", name: "pageSize", options: PAGE_SIZES, submitLabel: "Go", value: state.pageSize },
    summary: { from: page.from, to: page.to, total: page.total },
  };
}

// ---- register form + detail view models ----

export function buildClientFormModel(opts: {
  csrfToken?: string;
  error?: string;
  values?: Partial<ClientInput>;
}) {
  const v = opts.values;
  const nameField: FieldConfig = {
    autocomplete: "off", icon: "i-box", id: "name", label: "Name", name: "name", required: true, value: v?.name ?? "",
  };
  const scopeField: FieldConfig = {
    hint: "Space-separated scopes the client may request.", id: "scope", label: "Scopes", name: "scope",
    value: v?.scope ?? DEFAULT_SCOPE,
  };
  return {
    breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "OAuth2 clients" }, { label: "Register" }],
    error: opts.error,
    form: {
      action: ADMIN_CLIENTS_BASE,
      cancelHref: ADMIN_CLIENTS_BASE,
      csrfToken: opts.csrfToken ?? "",
      firstParty: v?.firstParty ?? false,
      nameField,
      public: v?.public ?? false,
      redirectUris: (v?.redirectUris ?? []).join("\n"),
      scopeField,
      submitLabel: "Register client",
    },
    title: "Register client",
  };
}

export function buildClientDetailModel(opts: {
  client: ClientView;
  created?: boolean; // just registered → success banner + the one-time secret (if any)
  csrfToken?: string;
  secret?: string; // one-time client_secret (confidential clients), shown once right after create
}) {
  const base = detailHref(opts.client.id);
  return {
    breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "OAuth2 clients" }, { label: opts.client.name }],
    client: opts.client,
    created: opts.created ?? false,
    csrfToken: opts.csrfToken ?? "",
    delete: { action: `${base}/delete` },
    secret: opts.secret,
    title: opts.created ? "Client registered" : opts.client.name,
  };
}

// ---- request handler (imperative shell) ----

function readClientInput(form: URLSearchParams): ClientInput {
  return {
    firstParty: form.get("firstParty") === "on",
    name: (form.get("name") ?? "").trim(),
    public: form.get("public") === "on",
    redirectUris: parseRedirectUris(form.get("redirectUris") ?? ""),
    scope: (form.get("scope") ?? "").trim(),
  };
}

// Shared per-request deps for the OAuth2-clients screen, resolved by `withClients`: the gate + the
// Hydra capability (else a themed 503). Each route below is a thin handler over these.
interface ClientsDeps { ctx: RequestContext; hydra: HydraAdmin; user: User; }

function withClients(inner: (deps: ClientsDeps) => Promise<RouteResult>): RouteHandler {
  return async (ctx) => {
    const user = requireAdmin(ctx);
    const hydra = ctx.system?.hydra;
    if (!hydra) return unavailable(ctx, "Hydra OAuth2 admin");
    return inner({ ctx, hydra, user });
  };
}

// Same, plus the target client from ctx.params.id (unknown → themed 404).
function withClient(inner: (deps: ClientsDeps, client: OAuth2Client, id: string) => Promise<RouteResult>): RouteHandler {
  return withClients(async (deps) => {
    const id = deps.ctx.params["id"] ?? "";
    const client = await deps.hydra.getClient(id);
    if (!client) return notFound(deps.ctx);
    return inner(deps, client, id);
  });
}

const clientFormResult = (ctx: RequestContext, extra: { error?: string; values?: Partial<ClientInput> }): RouteResult =>
  ({ data: { chrome: ctx.chrome, model: buildClientFormModel({ csrfToken: ctx.chrome.csrfToken, ...extra }) }, view: "client-form" });
const clientDetailResult = (ctx: RequestContext, client: OAuth2Client, extra: { created?: boolean; secret?: string } = {}): RouteResult =>
  ({ data: { chrome: ctx.chrome, model: buildClientDetailModel({ client: toClientView(client), csrfToken: ctx.chrome.csrfToken, ...extra }) }, view: "client-detail" });

// GET /admin/clients — the list.
export const clientsList = withClients(async ({ ctx, hydra }) => {
  const { clients } = await hydra.listClients({ pageSize: LIST_FETCH_SIZE });
  return { data: { chrome: ctx.chrome, model: buildClientsListModel({ clients, csrfToken: ctx.chrome.csrfToken, url: ctx.url }) }, view: "clients" };
});

// POST /admin/clients — register; on success show the one-time secret directly (no PRG, Hydra never
// returns it again). A Hydra 4xx (bad redirect/scope) re-renders the form (400); a 5xx rethrows → 500.
export const clientsCreate = withClients(async ({ ctx, hydra, user }) => {
  const input = readClientInput((await guardedForm(ctx))!);
  const error = validateClientInput(input);
  if (error) return { ...clientFormResult(ctx, { error, values: input }), status: 400 };
  let created: OAuth2Client;
  try {
    created = await hydra.createClient(clientPayload(input));
  } catch (err) {
    if (err instanceof HydraError && err.status < 500) return { ...clientFormResult(ctx, { error: "Hydra rejected the client — check the redirect URIs and scopes.", values: input }), status: 400 };
    throw err;
  }
  ctx.log.info("admin: oauth2 client registered", { actor: user.id, client: created.client_id ?? "" });
  return clientDetailResult(ctx, created, { created: true, ...(created.client_secret ? { secret: created.client_secret } : {}) });
});

// GET /admin/clients/new — the register form.
export const clientsNewForm = withClients(({ ctx }) => Promise.resolve(clientFormResult(ctx, {})));

// GET /admin/clients/:id — the detail (read-only; the secret is shown only once, at creation).
export const clientsDetail = withClient((deps, client) => Promise.resolve(clientDetailResult(deps.ctx, client)));

// GET /admin/clients/:id/delete — the deliberate confirm step.
export const clientsDeleteConfirm = withClient((deps, client, id) => {
  const base = detailHref(id);
  const name = toClientView(client).name;
  return Promise.resolve({ data: { chrome: deps.ctx.chrome, model: buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "OAuth2 clients" }, { href: base, label: name }, { label: "Delete" }],
    cancelHref: base, confirmAction: `${base}/delete`, confirmLabel: "Delete client",
    message: `Delete client ${name}? Apps using it can no longer sign in through Plainpages.`, title: "Delete client",
  }) }, view: "confirm" });
});

// POST /admin/clients/:id/delete — perform it.
export const clientsDelete = withClient(async ({ ctx, hydra, user }, _client, id) => {
  await guardedForm(ctx); // CSRF-verify the POST
  await hydra.deleteClient(id);
  ctx.log.info("admin: oauth2 client deleted", { actor: user.id, client: id });
  return { redirect: ADMIN_CLIENTS_BASE };
});
