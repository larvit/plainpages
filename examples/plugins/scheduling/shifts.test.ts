import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
// Import only from the @plainpages/plugin-api barrel — the same contract boundary shifts.ts uses (the host may
// refactor any deeper src/* freely behind it); the test models the dev/test story the contract preaches.
import { englishTranslator, GuardError, Log, type PageChrome, type RequestContext, type RouteResult, type User } from "@plainpages/plugin-api";
import enUS from "./i18n/en-US.ts";
import {
  buildFormModel, createShift, createUpstream, listShifts, myShifts, newShiftForm, overview, readInput,
  SHIFTS_PATH, type Shift, type ShiftInput, type ShiftsUpstream, UpstreamError, validate,
} from "./shifts.ts";

const t = englishTranslator(enUS); // this plugin's catalog then the host's, as the host would chain them
const CHROME: PageChrome = { brand: { name: "Test" }, csrfToken: "tok", nav: [], signInHref: "/login", user: { email: "", initials: "T", name: "Tester" } };

function fakeCtx(opts: { body?: string; permissions?: string[]; url?: string; user?: User; verifyCsrf?: (s: string | null | undefined) => boolean } = {}): RequestContext {
  const url = new URL(opts.url ?? "http://localhost/scheduling/shifts");
  const req = Readable.from(opts.body != null ? [Buffer.from(opts.body)] : []) as unknown as IncomingMessage;
  return {
    chrome: CHROME, declaredPermissions: [], declaredSettings: [], user: opts.user ?? null, locale: "en-US", localeHref: (href) => href, locales: ["en-US"], log: new Log("none"), params: {},
    query: url.searchParams, req, res: {} as ServerResponse, permissions: opts.permissions ?? [], t, url,
    verifyCsrf: opts.verifyCsrf ?? (() => true),
  };
}

const SHIFTS: Shift[] = [
  { assignee: "Avery Kline", end: "12:00", id: "1", start: "08:00", title: "Morning desk" },
  { assignee: "Blair Mora", end: "17:00", id: "2", start: "12:00", title: "Afternoon support" },
];
const fakeUpstream = (over: Partial<ShiftsUpstream> = {}): ShiftsUpstream => ({ create: async () => {}, list: async () => SHIFTS, ...over });

const asView = (r: RouteResult | void) => {
  assert.ok(r && "view" in r, "expected a view result");
  return r as { data: Record<string, unknown>; status?: number; view: string };
};

// ---- the upstream URL as a declared setting ----

test("the manifest declares its upstream as a URL setting the host validates", async () => {
  const manifest = (await import("./plugin.ts")).default;
  assert.deepEqual(manifest.settings?.map((s) => s.key), ["upstream"]);
  assert.equal(manifest.settings?.[0]?.type, "url"); // so a typo'd URL fails the boot, not every request
  assert.equal(manifest.settings?.[0]?.default, "http://shifts-upstream:4000"); // the dev compose's mock
  assert.equal(typeof manifest.hooks?.onBoot, "function"); // without it the resolved value never arrives
});

test("the client re-reads its base URL, so onBoot can bind it after the manifest is built", async () => {
  let baseUrl = "http://first:4000";
  const seen: string[] = [];
  const http = (async (url) => { seen.push(String(url)); return new Response("[]", { status: 200 }); }) as typeof fetch;
  const upstream = createUpstream(() => baseUrl, http);
  await upstream.list();
  baseUrl = "http://second:4000";
  await upstream.list();
  assert.deepEqual(seen, ["http://first:4000/shifts", "http://second:4000/shifts"]);
});

// ---- upstream client (fetch injected) ----

test("createUpstream.list fetches /shifts, asks for JSON, and maps the rows", async () => {
  let seen = "";
  const http = (async (url, init) => {
    seen = String(url);
    assert.equal((init?.headers as Record<string, string>).accept, "application/json");
    return new Response(JSON.stringify([{ assignee: "A", end: "2", id: "x", start: "1", title: "T", extra: "ignored" }]), { status: 200 });
  }) as typeof fetch;
  const shifts = await createUpstream(() => "http://up:4000/", http).list(); // trailing slash trimmed
  assert.equal(seen, "http://up:4000/shifts");
  assert.deepEqual(shifts, [{ assignee: "A", end: "2", id: "x", start: "1", title: "T" }]);
});

test("createUpstream throws UpstreamError carrying the status on a non-2xx", async () => {
  const http = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  await assert.rejects(createUpstream(() => "http://up:4000", http).list(), (e: unknown) => e instanceof UpstreamError && e.status === 503);
});

test("createUpstream.create POSTs the input as JSON", async () => {
  let body: unknown, method = "";
  const http = (async (_url, init) => { method = init?.method ?? ""; body = JSON.parse(String(init?.body)); return new Response(null, { status: 201 }); }) as typeof fetch;
  const input: ShiftInput = { assignee: "A", end: "2", start: "1", title: "T" };
  await createUpstream(() => "http://up:4000", http).create(input);
  assert.equal(method, "POST");
  assert.deepEqual(body, input);
});

// ---- input + validation ----

test("readInput trims; validate requires title + assignee", () => {
  assert.deepEqual(readInput(new URLSearchParams("title=%20Shift%20&assignee=Bo&start=1&end=2")), { assignee: "Bo", end: "2", start: "1", title: "Shift" });
  assert.equal(validate({ assignee: "Bo", end: "", start: "", title: "Shift" }), null);
  assert.deepEqual(Object.keys(validate({ assignee: "", end: "", start: "", title: "" }) ?? {}), ["title", "assignee"]);
});

// ---- list handler ----

test("listShifts renders the upstream rows; q filters; canWrite reflects the permission", async () => {
  const r = asView(await listShifts(fakeUpstream())(fakeCtx({ permissions: ["scheduling:write"] })));
  assert.equal(r.view, "shifts");
  const table = r.data["table"] as { rows: { name: string }[] };
  assert.deepEqual(table.rows.map((x) => x.name), ["Morning desk", "Afternoon support"]);
  assert.equal(r.data["canWrite"], true);
  assert.equal(r.data["chrome"], CHROME);

  const filtered = asView(await listShifts(fakeUpstream())(fakeCtx({ url: "http://localhost/scheduling/shifts?q=afternoon" })));
  assert.deepEqual((filtered.data["table"] as { rows: { name: string }[] }).rows.map((x) => x.name), ["Afternoon support"]);
  assert.equal(filtered.data["canWrite"], false); // no scheduling:write
});

test("listShifts degrades to a recoverable error page when the upstream is down (no throw)", async () => {
  const r = asView(await listShifts(fakeUpstream({ list: async () => { throw new UpstreamError("down", 503); } }))(fakeCtx()));
  assert.match(String(r.data["error"]), /scheduling service/i);
  assert.deepEqual((r.data["table"] as { rows: unknown[] }).rows, []);
});

// ---- public overview handler (a page anyone can reach, gated data stays behind the permission) ----

test("overview renders a public page for anyone; it links straight to Shifts only for a reader", async () => {
  const anon = asView(await overview()(fakeCtx())); // user null, no permissions
  assert.equal(anon.view, "overview");
  assert.equal(anon.data["chrome"], CHROME);
  assert.equal(anon.data["canRead"], false); // anonymous → prompt to sign in, no shifts link

  const reader = asView(await overview()(fakeCtx({ permissions: ["scheduling:read"] })));
  assert.equal(reader.data["canRead"], true); // a reader gets a link straight to the shifts list
});

// ---- create handler ----

test("newShiftForm renders the empty form", async () => {
  const r = asView(await newShiftForm()(fakeCtx()));
  assert.equal(r.view, "shift-new");
  assert.equal((r.data["form"] as { csrfToken: string }).csrfToken, "tok");
});

test("createShift rejects a bad CSRF token with a 403 GuardError", async () => {
  await assert.rejects(
    async () => { await createShift(fakeUpstream())(fakeCtx({ body: "title=T&assignee=A", verifyCsrf: () => false })); },
    (e: unknown) => e instanceof GuardError && e.status === 403,
  );
});

test("createShift re-renders the form (400) on a validation error, never touching the upstream", async () => {
  let created = false;
  const r = asView(await createShift(fakeUpstream({ create: async () => { created = true; } }))(fakeCtx({ body: "title=&assignee=" })));
  assert.equal(r.status, 400);
  assert.equal(r.view, "shift-new");
  assert.equal(created, false);
});

test("createShift forwards a valid write upstream then POST-redirect-GETs", async () => {
  let got: ShiftInput | undefined;
  const r = await createShift(fakeUpstream({ create: async (i) => { got = i; } }))(fakeCtx({ body: "title=Night&assignee=Casey&start=22%3A00&end=06%3A00" }));
  assert.deepEqual(got, { assignee: "Casey", end: "06:00", start: "22:00", title: "Night" });
  assert.deepEqual(r, { redirect: SHIFTS_PATH });
});

test("createShift surfaces an upstream failure as a recoverable 502 form, keeping the input", async () => {
  const r = asView(await createShift(fakeUpstream({ create: async () => { throw new UpstreamError("boom", 500); } }))(fakeCtx({ body: "title=Night&assignee=Casey" })));
  assert.equal(r.status, 502);
  assert.match(String(r.data["formError"]), /unavailable/i);
  const fields = (r.data["form"] as { fields: { name: string; value: string }[] }).fields;
  assert.equal(fields.find((f) => f.name === "title")?.value, "Night"); // input preserved for retry
});

test("buildFormModel marks title/assignee required and attaches field errors", () => {
  const model = buildFormModel({ chrome: CHROME, errors: { title: "needed" }, values: { title: "x" } });
  const fields = model.form.fields as { error?: string; name: string; required?: boolean; value: string }[];
  const title = fields.find((f) => f.name === "title")!;
  assert.equal(title.required, true);
  assert.equal(title.error, "needed");
  assert.equal(fields.find((f) => f.name === "start")!.required, undefined);
});

// ---- the session-gated page: the visitor's own rows ----

test("my shifts renders only the signed-in visitor's own rows, and names them in the empty state", async () => {
  const user: User = { email: "Blair.Mora@example.test", id: "01a06091-baa3-71f4-a068-4879972979ff", permissions: [] };
  const mine: Shift = { assignee: "blair.mora@example.test", end: "22:00", id: "3", start: "17:00", title: "Evening on-call" };
  const listed = [...SHIFTS, mine]; // SHIFTS are assigned to other people

  const r = asView(await myShifts(fakeUpstream({ list: async () => listed }))(fakeCtx({ url: "http://localhost/scheduling/mine", user })));
  assert.equal(r.view, "mine");
  const table = r.data["table"] as { emptyText: string; rows: { name: string }[] };
  assert.deepEqual(table.rows.map((row) => row.name), ["Evening on-call"]); // matched case-insensitively
  assert.match(table.emptyText, /Blair\.Mora@example\.test/); // an empty page still says whose it is

  // The route carries `session: true`, but the handler asserts the session itself rather than trusting it.
  await assert.rejects(async () => { await myShifts(fakeUpstream())(fakeCtx()); }, GuardError);
});
