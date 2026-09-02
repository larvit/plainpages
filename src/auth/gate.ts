// One home for the gate rule, so the router and the menu can never disagree about what a visitor
// may reach. README → Public pages & menu items.
import type { User } from "../http/context.ts";

const GATES = ["public", "session", "permission"] as const;

export interface Gate {
  permission?: string; // the Keto Permission the caller must hold, `<resource>:<action>`
  public?: boolean; // anyone, signed in or not
  session?: boolean; // any signed-in user, no grant to hold; anonymous is sent to /login
}

export function allows(gate: Gate, user: User | null): boolean {
  if (gate.public === true) return true;
  if (gate.session === true) return user !== null;
  return gate.permission == null || (user?.permissions.includes(gate.permission) ?? false);
}

export function gatesSet(gate: Gate | null | undefined): string[] {
  if (gate == null) return [];
  return GATES.filter((name) => (name === "permission" ? gate.permission != null : gate[name] === true));
}
