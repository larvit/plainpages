import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_FLOWS, buildFlowView } from "./flow-view.ts";
import type { Flow, UiNode } from "./kratos-public.ts";

// Concise UiNode builder mirroring Kratos' shape.
function node(attrs: Record<string, unknown>, opts: { group?: string; label?: string; error?: string } = {}): UiNode {
  return {
    attributes: attrs,
    group: opts.group ?? "default",
    messages: opts.error ? [{ id: 4000002, text: opts.error, type: "error" }] : [],
    meta: opts.label ? { label: { id: 1, text: opts.label, type: "info" } } : {},
    type: "input",
  };
}

function flow(nodes: UiNode[], extra: Partial<Flow["ui"]> = {}): Flow {
  return { id: "f1", ui: { action: "http://127.0.0.1:4433/self-service/login?flow=f1", method: "post", nodes, ...extra } };
}

test("maps a password login flow: csrf hidden, themed email/password fields, a submit button + chrome", () => {
  const view = buildFlowView(
    flow([
      node({ name: "csrf_token", type: "hidden", value: "tok123" }),
      node({ name: "identifier", type: "email", required: true, autocomplete: "username", value: "" }, { label: "E-Mail", group: "password" }),
      node({ name: "password", type: "password", required: true, autocomplete: "current-password" }, { label: "Password", group: "password" }),
      node({ name: "method", type: "submit", value: "password" }, { label: "Sign in", group: "password" }),
    ]),
    "login",
  );

  // Form posts straight to Kratos (it owns CSRF); csrf travels as a hidden input.
  assert.equal(view.action, "http://127.0.0.1:4433/self-service/login?flow=f1");
  assert.equal(view.method, "post");
  assert.deepEqual(view.hidden, [{ name: "csrf_token", value: "tok123" }]);

  // Visible fields carry label, type, required, autocomplete + a themed input icon.
  assert.equal(view.fields.length, 2);
  assert.deepEqual(view.fields[0], { autocomplete: "username", icon: "i-mail", id: "field-identifier", label: "E-Mail", name: "identifier", required: true, type: "email" });
  assert.equal(view.fields[1]?.icon, "i-lock");
  assert.equal(view.fields[1]?.type, "password");

  // One submit button carrying its method name/value.
  assert.deepEqual(view.buttons, [{ label: "Sign in", name: "method", value: "password" }]);

  // No OIDC providers configured ⇒ no SSO buttons.
  assert.deepEqual(view.sso, []);

  // Chrome derived from the flow type.
  assert.equal(view.title, "Sign in");
  assert.equal(view.alt?.href, "/registration");
  assert.equal(view.recoverHref, "/recovery"); // login offers a path to password reset
  assert.equal(view.messages.length, 0);
});

test("maps field errors and flow-level messages by tone", () => {
  const view = buildFlowView(
    flow(
      [
        node({ name: "identifier", type: "email", value: "taken@example.com" }, { label: "E-Mail", error: "This email is already in use." }),
        node({ name: "method", type: "submit", value: "password" }, { label: "Sign in" }),
      ],
      { messages: [{ id: 4000006, text: "The provided credentials are invalid.", type: "error" }, { id: 1, text: "Check your email.", type: "info" }] },
    ),
    "login",
  );

  // Submitted value is preserved; the node's error rides on the field.
  assert.equal(view.fields[0]?.value, "taken@example.com");
  assert.deepEqual(view.fields[0]?.error, { text: "This email is already in use." });

  // Flow messages map error→neg, info→info (success→pos covered by the tone map).
  assert.deepEqual(view.messages, [
    { text: "The provided credentials are invalid.", tone: "neg" },
    { text: "Check your email.", tone: "info" },
  ]);
});

test("collects oidc nodes as SSO providers (text logo = initial), keeping csrf and the password submit separate", () => {
  const view = buildFlowView(
    flow([
      node({ name: "csrf_token", type: "hidden", value: "tok" }),
      node({ name: "provider", type: "submit", value: "google" }, { label: "Sign in with Google", group: "oidc" }),
      node({ name: "provider", type: "submit", value: "microsoft" }, { label: "Sign in with Microsoft", group: "oidc" }),
      node({ name: "method", type: "submit", value: "password" }, { label: "Sign in", group: "password" }),
    ]),
    "login",
  );
  // One provider button per oidc node — a submit (name/value) posting to the same Kratos form.
  assert.deepEqual(view.sso, [
    { label: "Sign in with Google", logo: "G", name: "provider", value: "google" },
    { label: "Sign in with Microsoft", logo: "M", name: "provider", value: "microsoft" },
  ]);
  // SSO nodes don't leak into hidden/buttons.
  assert.deepEqual(view.hidden, [{ name: "csrf_token", value: "tok" }]);
  assert.deepEqual(view.buttons, [{ label: "Sign in", name: "method", value: "password" }]);
});

test("the code field guards a pasted space: one-time-code autofill + numeric inputmode + digits-only pattern", () => {
  // Verification/recovery enter a numeric OTP. Kratos doesn't trim, so a stray pasted space makes it
  // reject the code as "invalid"; a digits-only pattern blocks that in the browser before submit.
  const view = buildFlowView(
    flow([
      node({ name: "csrf_token", type: "hidden", value: "tok" }),
      node({ name: "code", type: "text", required: true }, { label: "Verification code", group: "code" }),
      node({ name: "method", type: "submit", value: "code" }, { label: "Continue", group: "code" }),
    ]),
    "verification",
  );
  assert.deepEqual(view.fields.find((f) => f.name === "code"), {
    autocomplete: "one-time-code", // Kratos sends none for the OTP node — enable OS/email autofill
    icon: "i-shield",
    id: "field-code",
    inputmode: "numeric",
    label: "Verification code",
    name: "code",
    pattern: "[0-9]*",
    required: true,
    type: "text",
  });
});

test("chrome varies per flow type: registration alt, recovery back link", () => {
  const reg = buildFlowView(flow([]), "registration");
  assert.equal(reg.title, "Create account");
  assert.equal(reg.alt?.href, "/login");
  assert.equal(reg.recoverHref, undefined); // only login shows the reset link

  const rec = buildFlowView(flow([]), "recovery");
  assert.equal(rec.back?.href, "/login");
});

test("AUTH_FLOWS maps each themed path to its Kratos flow type", () => {
  assert.equal(AUTH_FLOWS["/login"], "login");
  assert.equal(AUTH_FLOWS["/registration"], "registration");
  assert.equal(AUTH_FLOWS["/recovery"], "recovery");
  assert.equal(AUTH_FLOWS["/verification"], "verification");
  assert.equal(AUTH_FLOWS["/settings"], "settings");
});
