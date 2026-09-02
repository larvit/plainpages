// The coarse gate a route or nav node declares. One home for the rule, so the router and the menu
// can never disagree about what a visitor may reach.
import type { User } from "../http/context.ts";

// Widest first: whoever passes an earlier gate passes it without holding anything.
const GATES = ["public", "session", "permission"] as const;

// A route or nav node names exactly one of these; discovery refuses two. Omitting all three is the
// same as `public`, which is why stating it outright makes an open gate a choice, not an oversight.
export interface Gate {
  permission?: string | undefined; // the Keto Permission the caller must hold, `<resource>:<action>`
  public?: boolean | undefined; // anyone, signed in or not
  session?: boolean | undefined; // any signed-in user, no grant to hold; anonymous is sent to /login
}

export function allows(gate: Gate, user: User | null): boolean {
  if (gate.public === true) return true;
  if (gate.session === true) return user !== null;
  return gate.permission == null || (user?.permissions.includes(gate.permission) ?? false);
}

// Which gates a declaration sets — discovery refuses more than one, since they contradict.
export function gatesSet(gate: Gate | null | undefined): string[] {
  if (gate == null) return [];
  return GATES.filter((name) => (name === "permission" ? gate.permission != null : gate[name] === true));
}
