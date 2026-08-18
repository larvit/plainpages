// Kratos flow → themed view model. Pure: turns a fetched self-service Flow
// (src/auth/kratos-public.ts) into the data views/auth.ejs renders — hidden inputs (incl. the
// CSRF token), themed fields, submit buttons, tone-mapped messages, and one SSO button per
// configured `oidc` provider. The form posts straight back to `flow.ui.action`, so Kratos
// owns its CSRF; we only render and map errors. No providers configured ⇒ no SSO buttons.

import { ENGLISH } from "../i18n/english.ts";
import type { Translate } from "../i18n/translate.ts";
import type { Flow, FlowType, UiNode } from "./kratos-public.ts";

export interface FlowField {
  autocomplete?: string;
  error?: { text: string };
  hint?: string; // muted helper text under the input
  icon?: string; // Lucide sprite id for the input
  id: string;
  inputmode?: string; // virtual-keyboard hint (e.g. "numeric" for the OTP code)
  label: string;
  name: string;
  pattern?: string; // client-side validity regex; blocks a pasted space before it reaches Kratos
  required?: boolean;
  type: string;
  value?: string;
}

export interface FlowButton {
  label: string;
  name?: string;
  value?: string;
}

// An OIDC provider, rendered as a submit button (name/value) posting to the same Kratos form.
export interface SsoProvider {
  label: string; // Kratos' own label, e.g. "Sign in with Google"
  logo: string; // text logo (provider initial) — lucide ships no brand marks
  name: string; // submit field (Kratos: "provider")
  value: string; // provider id (Kratos: "google")
}

export interface FlowMessage {
  text: string;
  tone: "info" | "neg" | "pos" | "warn";
}

interface FlowChrome {
  alt?: { href: string; label: string; text: string };
  back?: { href: string; label: string };
  sub?: string;
  title: string;
}

export interface FlowView extends FlowChrome {
  action: string;
  buttons: FlowButton[];
  fields: FlowField[];
  hidden: { name: string; value: string }[];
  messages: FlowMessage[];
  method: string;
  recoverHref?: string; // login only: a "Forgot password?" link to the recovery flow
  sso: SsoProvider[]; // one per configured oidc provider; empty ⇒ no SSO section
}

// Themed route → Kratos flow type. The routes mirror kratos.yml's flow ui_urls.
export const AUTH_FLOWS: Record<string, FlowType> = {
  "/login": "login",
  "/recovery": "recovery",
  "/registration": "registration",
  "/settings": "settings",
  "/verification": "verification",
};

// Where each flow's card links; its words come from the catalog under `auth.<flow>.*`.
const LINKS: Record<FlowType, { alt?: string; back?: boolean }> = {
  login: { alt: "/registration" },
  recovery: { alt: "/login", back: true },
  registration: { alt: "/login" },
  settings: {},
  verification: { back: true },
};

function chromeFor(type: FlowType, t: Translate): FlowChrome {
  const links = LINKS[type];
  return {
    ...(links.alt ? { alt: { href: links.alt, label: t(`auth.${type}.altLabel`), text: t(`auth.${type}.altText`) } } : {}),
    ...(links.back ? { back: { href: "/login", label: t(`auth.${type}.back`) } } : {}),
    sub: t(`auth.${type}.sub`),
    title: t(`auth.${type}.title`),
  };
}

// A string Kratos authored (a field label, a button, a validation message). Kratos writes English
// and tags it with a stable numeric id, so the first key we hold a translation for wins and
// anything unmapped keeps Kratos' own words — never a bare key on screen.
function kratosText(t: Translate, fallback: string, ...keys: (string | undefined)[]): string {
  for (const key of keys) {
    if (key === undefined) continue;
    const text = t(key);
    if (text !== key) return text;
  }
  return fallback;
}

const idKey = (id: number | undefined): string | undefined => (id === undefined ? undefined : `kratos.${id}`);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// Themed input icon by field semantics; undefined ⇒ no icon.
function iconFor(name: string, type: string): string | undefined {
  if (type === "email" || name === "identifier" || name.endsWith(".email")) return "i-mail";
  if (type === "password") return "i-lock";
  if (name.includes("name")) return "i-user";
  if (name === "code") return "i-shield";
  return undefined;
}

function tone(type: string): FlowMessage["tone"] {
  if (type === "error") return "neg";
  if (type === "success") return "pos";
  return "info";
}

const ssoLogo = (value: string): string => (value.charAt(0) || "?").toUpperCase();

function toField(node: UiNode, name: string, type: string, t: Translate): FlowField {
  const value = str(node.attributes["value"]);
  // The recovery/verification one-time code: numeric, and Kratos doesn't trim it, so a stray pasted
  // space makes it reject the code as "invalid". A digits-only pattern + numeric keypad block that in
  // the browser; one-time-code enables OS/email autofill (Kratos sends no autocomplete for the node).
  const isCode = name === "code";
  const autocomplete = str(node.attributes["autocomplete"]) ?? (isCode ? "one-time-code" : undefined);
  const icon = iconFor(name, type);
  const errorMsg = node.messages.find((m) => m.type === "error");
  return {
    id: "field-" + name.replace(/[^a-z0-9]+/gi, "-"),
    // Kratos' generic trait label (id 1070002) is "Email" here and "First name" on a schema with
    // that trait, so a field falls back to its input name — the one thing that is unambiguous.
    label: kratosText(t, node.meta.label?.text ?? name, idKey(node.meta.label?.id), `auth.field.${name}`),
    name,
    type,
    ...(autocomplete ? { autocomplete } : {}),
    ...(errorMsg ? { error: { text: kratosText(t, errorMsg.text, idKey(errorMsg.id)) } } : {}),
    ...(icon ? { icon } : {}),
    ...(isCode ? { hint: t("auth.field.code.hint"), inputmode: "numeric", pattern: "[0-9]*" } : {}),
    ...(node.attributes["required"] === true ? { required: true } : {}),
    ...(value ? { value } : {}),
  };
}

export function buildFlowView(flow: Flow, type: FlowType, t: Translate = ENGLISH): FlowView {
  const hidden: { name: string; value: string }[] = [];
  const fields: FlowField[] = [];
  const buttons: FlowButton[] = [];
  const sso: SsoProvider[] = [];

  for (const node of flow.ui.nodes) {
    if (node.type !== "input") continue;
    const name = str(node.attributes["name"]) ?? "";
    const inputType = str(node.attributes["type"]) ?? "text";
    if (node.group === "oidc") {
      // One submit button per configured provider; posts provider=<value> to the same form.
      if (inputType === "submit" || inputType === "button") {
        const value = str(node.attributes["value"]) ?? "";
        sso.push({ label: node.meta.label?.text ?? value, logo: ssoLogo(value), name, value });
      }
    } else if (inputType === "hidden") {
      hidden.push({ name, value: str(node.attributes["value"]) ?? "" });
    } else if (inputType === "submit" || inputType === "button") {
      const value = str(node.attributes["value"]);
      const label = kratosText(t, node.meta.label?.text ?? t("auth.continue"), idKey(node.meta.label?.id));
      buttons.push({ label, ...(name ? { name } : {}), ...(value != null ? { value } : {}) });
    } else {
      fields.push(toField(node, name, inputType, t));
    }
  }

  return {
    action: flow.ui.action,
    buttons,
    fields,
    hidden,
    messages: (flow.ui.messages ?? []).map((m) => ({ text: kratosText(t, m.text, idKey(m.id)), tone: tone(m.type) })),
    method: flow.ui.method || "post",
    sso,
    ...(type === "login" ? { recoverHref: "/recovery" } : {}),
    ...chromeFor(type, t),
  };
}
