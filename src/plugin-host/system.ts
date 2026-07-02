// System capabilities: privileged host services a first-party/system plugin (the built-in admin
// screens are the reference consumer) needs but an ordinary domain plugin does not — the Ory admin
// clients and the instant-revoke hook. Exposed on ctx.system and re-exported via #plugin-api.
//
// Every field is optional: it is present only when the host wired that dependency (Ory configured,
// denylist enabled), and ctx.system itself is undefined when the host wired none. A plugin must
// treat each as optional and degrade when absent — the host does not fail a request over it.

import type { HydraAdmin } from "../auth/hydra-admin.ts";
import type { KetoClient } from "../auth/keto-client.ts";
import type { KratosAdmin } from "../auth/kratos-admin.ts";

// Grouping criterion (keep this cohesive — it's a contract, so the "no catch-all bucket" rule that
// governs folders governs this bag too): every field is a *privileged, host-owned, wire-dependent*
// capability for administering Plainpages' own identity/permission stack. Add a field only when it
// meets all three; if unrelated privileged concerns accrete (mailer, metrics, flags), sub-group
// rather than pile them in flat.
export interface SystemCapabilities {
  hydra?: HydraAdmin; // OAuth2 client admin (Hydra); present when the Hydra admin client is wired
  keto?: KetoClient; // relationship read/write (Keto); present when Keto is wired
  kratosAdmin?: KratosAdmin; // identity admin (Kratos); present when the Kratos admin client is wired
  revoke?: (sub: string) => void; // instant-revoke a subject's live tokens; present when the denylist is on
}
