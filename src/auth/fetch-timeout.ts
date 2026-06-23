// Bound every outbound Ory call: a reachable-but-silent host — a hung container, a
// black-holed socket, an LB holding the connection — would otherwise park a request handler forever
// (and exhaust the pool under load). Wrap the injected `fetch` so each call aborts after `ms` unless
// the caller already passed its own signal. server.ts wires this into the Kratos/Keto/Hydra clients.

export function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  // A caller-supplied signal wins (so an explicit abort still works); otherwise inject the timeout.
  return (input, init) => fetchImpl(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
}
