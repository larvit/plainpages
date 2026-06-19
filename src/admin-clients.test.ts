// Built-in OAuth2 clients admin screen (§6): the pure view-model + Hydra-payload builders. A client
// is an Ory Hydra OAuth2 client (apps that log in *through* us); writes go only to Hydra. The
// HTTP routing/gate/CSRF + live Hydra calls (incl. the one-time secret) are exercised in app.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClientDetailModel,
  buildClientFormModel,
  buildClientsListModel,
  type ClientInput,
  clientPayload,
  parseRedirectUris,
  toClientView,
  validateClientInput,
} from "./admin-clients.ts";

const input = (over: Partial<ClientInput> = {}): ClientInput =>
  ({ firstParty: false, name: "Acme", public: false, redirectUris: ["https://acme.example/cb"], scope: "openid offline_access", ...over });

test("toClientView maps Hydra fields → view (public from auth method, first-party from metadata, scopes split)", () => {
  assert.deepEqual(
    toClientView({ client_id: "c1", client_name: "Acme", metadata: { first_party: true }, redirect_uris: ["https://a/cb"], scope: "openid email", token_endpoint_auth_method: "client_secret_basic" }),
    { firstParty: true, id: "c1", name: "Acme", public: false, redirectUris: ["https://a/cb"], scopes: ["openid", "email"] },
  );
  // A public client + no name → falls back to the id; absent metadata/scope tolerated.
  assert.deepEqual(
    toClientView({ client_id: "c2", token_endpoint_auth_method: "none" }),
    { firstParty: false, id: "c2", name: "c2", public: true, redirectUris: [], scopes: [] },
  );
});

test("parseRedirectUris splits on newlines/whitespace/commas and drops empties", () => {
  assert.deepEqual(parseRedirectUris("https://a/cb\n https://b/cb \n\n, https://c/cb"), ["https://a/cb", "https://b/cb", "https://c/cb"]);
  assert.deepEqual(parseRedirectUris("   "), []);
});

test("clientPayload maps the input to Hydra's create body (auth-code + refresh, type via auth method)", () => {
  assert.deepEqual(clientPayload(input()), {
    client_name: "Acme",
    grant_types: ["authorization_code", "refresh_token"],
    metadata: { first_party: false },
    redirect_uris: ["https://acme.example/cb"],
    response_types: ["code"],
    scope: "openid offline_access",
    token_endpoint_auth_method: "client_secret_basic",
  });
  const pub = clientPayload(input({ firstParty: true, public: true }));
  assert.equal(pub.token_endpoint_auth_method, "none");
  assert.deepEqual(pub.metadata, { first_party: true });
});

test("validateClientInput requires a name, ≥1 redirect URI, and absolute redirect URLs", () => {
  assert.equal(validateClientInput(input()), null);
  assert.match(validateClientInput(input({ name: "" }))!, /name/i);
  assert.match(validateClientInput(input({ redirectUris: [] }))!, /redirect/i);
  assert.match(validateClientInput(input({ redirectUris: ["not a url"] }))!, /redirect URI/i);
});

test("buildClientsListModel filters by search, paginates; the name links to the detail page", () => {
  const clients = Array.from({ length: 30 }, (_, i) => ({ client_id: `id-${String(i).padStart(2, "0")}`, client_name: `app-${String(i).padStart(2, "0")}`, token_endpoint_auth_method: "client_secret_basic" }));

  const all = buildClientsListModel({ clients, url: "http://x/admin/clients" });
  assert.equal(all.pagination.summary.total, 30);
  assert.equal(all.table.rows.length, 25); // default page size
  assert.equal(all.shell.title, "OAuth2 clients");
  const first = all.table.rows[0]!.cells[0] as { rowHeader: { href: string; text: string } };
  assert.equal(first.rowHeader.text, "app-00");
  assert.equal(first.rowHeader.href, "/admin/clients/id-00");

  const one = buildClientsListModel({ clients, url: "http://x/admin/clients?q=app-07" });
  assert.equal(one.pagination.summary.total, 1);
  assert.deepEqual(one.filterBar.pills.map((p) => p.label), ["Search"]);
});

test("buildClientFormModel: a register form with name + scope fields; values reflected on error", () => {
  const m = buildClientFormModel({ csrfToken: "tok.sig" });
  assert.equal(m.shell.title, "Register client");
  assert.equal(m.form.action, "/admin/clients");
  assert.equal(m.form.submitLabel, "Register client");
  assert.equal(m.form.csrfToken, "tok.sig");
  assert.equal(m.form.nameField.required, true);
  assert.equal(m.form.scopeField.value, "openid offline_access"); // sensible default

  const err = buildClientFormModel({ error: "Add at least one redirect URI.", values: { firstParty: true, name: "Acme", public: true, redirectUris: ["https://a/cb"], scope: "openid" } });
  assert.equal(err.error, "Add at least one redirect URI.");
  assert.equal(err.form.nameField.value, "Acme");
  assert.equal(err.form.redirectUris, "https://a/cb");
  assert.equal(err.form.public, true);
  assert.equal(err.form.firstParty, true);
});

test("buildClientDetailModel: client info + delete action; the one-time secret + created banner show only right after create", () => {
  const client = toClientView({ client_id: "c1", client_name: "Acme", redirect_uris: ["https://a/cb"], scope: "openid", token_endpoint_auth_method: "client_secret_basic" });

  const plain = buildClientDetailModel({ client });
  assert.equal(plain.shell.title, "Acme");
  assert.equal(plain.delete.action, "/admin/clients/c1/delete");
  assert.equal(plain.created, false);
  assert.equal(plain.secret, undefined);

  const fresh = buildClientDetailModel({ client, created: true, secret: "s3cr3t" });
  assert.equal(fresh.created, true);
  assert.equal(fresh.secret, "s3cr3t");
  assert.equal(fresh.shell.title, "Client registered");
});
