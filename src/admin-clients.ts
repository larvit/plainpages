// Built-in OAuth2 clients admin screen (todo §6): register / list / delete the OAuth2 clients other
// apps log in *through* us with (Ory Hydra, the §6 login+consent handlers). A client is an Ory Hydra
// OAuth2 client; writes go only to Hydra. Hydra returns the client_secret once, on create — so the
// register POST renders the new client's detail page (with the one-time secret) directly instead of a
// PRG redirect (mirrors the Users "trigger recovery" one-time code). `handleAdminClients` is the
// imperative shell app.ts dispatches to — gated admin-only, CSRF-guarded.

import { ADMIN_CLIENTS_BASE, adminNav, buildConfirmModel, guardedForm, requireAdmin } from "./admin-nav.ts";
import { safeDecode } from "./admin-groups.ts";
import type { FieldConfig } from "./admin-users.ts";
import type { RequestContext, User } from "./context.ts";
import { HydraError, type HydraAdmin, type OAuth2Client } from "./hydra-admin.ts";
import { parseListQuery } from "./list-query.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import { paginate } from "./paginate.ts";
import type { RouteResult } from "./plugin.ts";
import { buildShellContext } from "./shell-context.ts";

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
  menu?: MenuConfig;
  url: URL | URLSearchParams | string;
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const query = parseListQuery(opts.url, { defaultPageSize: DEFAULT_PAGE_SIZE });
  const needle = query.q.toLowerCase();

  const all = opts.clients.map(toClientView);
  const list = all.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle));

  const page = paginate(list.length, query.page, query.pageSize, { boundaries: 1, siblings: 1 });
  const start = (page.page - 1) * page.pageSize;
  const rows = list.slice(start, start + page.pageSize);
  const state: ListState = { page: page.page, pageSize: page.pageSize, q: query.q };

  return {
    filterBar: listFilterBar(state),
    nav: adminNav(opts.user?.roles ?? [], menu, "clients"),
    pagination: listPagination(state, page),
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "Admin" }, { label: "OAuth2 clients" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "OAuth2 clients",
      user: opts.user ?? null,
    }),
    table: listTable(rows),
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
  menu?: MenuConfig;
  user?: User | null;
  values?: Partial<ClientInput>;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const v = opts.values;
  const nameField: FieldConfig = {
    autocomplete: "off", icon: "i-box", id: "name", label: "Name", name: "name", required: true, value: v?.name ?? "",
  };
  const scopeField: FieldConfig = {
    hint: "Space-separated scopes the client may request.", id: "scope", label: "Scopes", name: "scope",
    value: v?.scope ?? DEFAULT_SCOPE,
  };
  return {
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
    nav: adminNav(opts.user?.roles ?? [], menu, "clients"),
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "OAuth2 clients" }, { label: "Register" }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: "Register client",
      user: opts.user ?? null,
    }),
  };
}

export function buildClientDetailModel(opts: {
  client: ClientView;
  created?: boolean; // just registered → success banner + the one-time secret (if any)
  csrfToken?: string;
  menu?: MenuConfig;
  secret?: string; // one-time client_secret (confidential clients), shown once right after create
  user?: User | null;
}) {
  const menu = opts.menu ?? DEFAULT_MENU;
  const base = detailHref(opts.client.id);
  return {
    client: opts.client,
    created: opts.created ?? false,
    csrfToken: opts.csrfToken ?? "",
    delete: { action: `${base}/delete` },
    nav: adminNav(opts.user?.roles ?? [], menu, "clients"),
    secret: opts.secret,
    shell: buildShellContext({
      breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "OAuth2 clients" }, { label: opts.client.name }],
      csrfToken: opts.csrfToken ?? "",
      menu,
      title: opts.created ? "Client registered" : opts.client.name,
      user: opts.user ?? null,
    }),
  };
}

// ---- request handler (imperative shell) ----

export interface AdminClientsDeps {
  csrfSecret: string;
  hydra: HydraAdmin;
  menu: MenuConfig;
  render: (view: string, data: Record<string, unknown>) => Promise<string>;
}

function readClientInput(form: URLSearchParams): ClientInput {
  return {
    firstParty: form.get("firstParty") === "on",
    name: (form.get("name") ?? "").trim(),
    public: form.get("public") === "on",
    redirectUris: parseRedirectUris(form.get("redirectUris") ?? ""),
    scope: (form.get("scope") ?? "").trim(),
  };
}

export async function handleAdminClients(ctx: RequestContext, csrfToken: string, deps: AdminClientsDeps): Promise<RouteResult | null> {
  const path = ctx.url.pathname;
  if (path !== ADMIN_CLIENTS_BASE && !path.startsWith(`${ADMIN_CLIENTS_BASE}/`)) return null;

  const user = requireAdmin(ctx); // signed-in admin only (else GuardError → /login or 403)
  const { hydra, menu, render } = deps;
  const method = (ctx.req.method ?? "GET").toUpperCase();
  const seg = path.slice(ADMIN_CLIENTS_BASE.length).split("/").filter(Boolean);
  const form = await guardedForm(ctx, deps.csrfSecret); // parsed + CSRF-verified on POST, else undefined

  const renderForm = async (extra: { error?: string; values?: Partial<ClientInput> }): Promise<RouteResult> =>
    ({ html: await render("admin/client-form", { model: buildClientFormModel({ csrfToken, menu, user, ...extra }) }) });
  const renderDetail = async (client: OAuth2Client, extra: { created?: boolean; secret?: string } = {}): Promise<RouteResult> =>
    ({ html: await render("admin/client-detail", { model: buildClientDetailModel({ client: toClientView(client), csrfToken, menu, user, ...extra }) }) });
  const notFound = async (): Promise<RouteResult> => ({ html: await render("404", { title: "Not found" }), status: 404 });

  // /admin/clients — list (GET) · register (POST)
  if (seg.length === 0) {
    if (method === "GET") {
      const { clients } = await hydra.listClients({ pageSize: LIST_FETCH_SIZE });
      return { html: await render("admin/clients", { model: buildClientsListModel({ clients, csrfToken, menu, url: ctx.url, user }) }) };
    }
    if (method === "POST") {
      const input = readClientInput(form!);
      const error = validateClientInput(input);
      if (error) return { ...(await renderForm({ error, values: input })), status: 400 };
      let created: OAuth2Client;
      try {
        created = await hydra.createClient(clientPayload(input));
      } catch (err) {
        // A Hydra 4xx (bad redirect/scope it rejects) is the operator's input — re-render the form;
        // a 5xx (Hydra down) rethrows → 500. Mirrors the §6 challenge-handler degrade.
        if (err instanceof HydraError && err.status < 500) {
          return { ...(await renderForm({ error: "Hydra rejected the client — check the redirect URIs and scopes.", values: input })), status: 400 };
        }
        throw err;
      }
      // Show the one-time secret now (Hydra never returns it again) — render the detail directly.
      ctx.log.info("admin: oauth2 client registered", { actor: user.id, client: created.client_id ?? "" });
      return renderDetail(created, { created: true, ...(created.client_secret ? { secret: created.client_secret } : {}) });
    }
    return null;
  }

  // /admin/clients/new — register form
  if (seg.length === 1 && seg[0] === "new" && method === "GET") return renderForm({});

  // /admin/clients/:id …
  const id = safeDecode(seg[0]!);
  if (id === null) return notFound();
  const client = await hydra.getClient(id);
  if (!client) return notFound();
  const base = detailHref(id);

  if (seg.length === 1 && method === "GET") return renderDetail(client);

  if (seg.length === 2 && seg[1] === "delete" && method === "GET") {
    const name = toClientView(client).name;
    return { html: await render("admin/confirm", { model: buildConfirmModel({
      breadcrumbs: [{ href: ADMIN_CLIENTS_BASE, label: "OAuth2 clients" }, { href: base, label: name }, { label: "Delete" }],
      cancelHref: base, confirmAction: `${base}/delete`, confirmLabel: "Delete client", csrfToken,
      current: "clients", menu, message: `Delete client ${name}? Apps using it can no longer sign in through Plainpages.`, title: "Delete client", user,
    }) }) };
  }
  if (seg.length === 2 && seg[1] === "delete" && method === "POST") {
    await hydra.deleteClient(id);
    ctx.log.info("admin: oauth2 client deleted", { actor: user.id, client: id });
    return { redirect: ADMIN_CLIENTS_BASE };
  }
  return null;
}
