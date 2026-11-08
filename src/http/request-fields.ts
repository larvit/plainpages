import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

export type TrustedProxies = BlockList;

// Each entry is an IP address or a CIDR range (`10.0.0.0/8`). Fails loud: a typo here would
// silently log a proxy's address for every caller, or trust a stranger's header.
export function parseTrustedProxies(entries: readonly string[] = []): TrustedProxies {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = "", prefix, ...rest] = entry.split("/");
    const family = isIP(address);
    const length = prefix === undefined ? undefined : Number(prefix);
    const maxLength = family === 4 ? 32 : 128;
    if (family === 0 || rest.length > 0 || (length !== undefined && !(Number.isInteger(length) && length >= 0 && length <= maxLength))) {
      throw new Error(`config: TRUSTED_PROXIES entry "${entry}" is not an IP address or CIDR range`);
    }
    const kind = family === 4 ? "ipv4" : "ipv6";
    if (length === undefined) list.addAddress(address, kind);
    else list.addSubnet(address, length, kind);
  }
  return list;
}

// A dual-stack socket reports an IPv4 peer as `::ffff:a.b.c.d`; log the plain form.
const plain = (address: string): string => (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address);

// The socket's peer, unless the peer is a listed proxy: then the nearest address in X-Forwarded-For
// that is not itself a listed proxy. Reading from the right is what makes a forged leftmost entry
// harmless — only a hop a trusted proxy appended is believed.
export function clientAddress(peer: string | undefined, forwardedFor: string | undefined, trusted: TrustedProxies): string | undefined {
  if (peer === undefined) return undefined;
  const isTrusted = (address: string): boolean => trusted.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  const direct = plain(peer);
  if (!isTrusted(direct)) return direct;
  const hops = (forwardedFor ?? "").split(",").map((hop) => plain(hop.trim())).filter(Boolean);
  let client = direct;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (isIP(hop) === 0) return direct;
    client = hop;
    if (!isTrusted(hop)) break;
  }
  return client;
}

// OpenTelemetry HTTP semantic-convention attributes every request carries on its span and `request`
// line. The path only: the query may carry tokens.
export function requestFields(req: IncomingMessage, trusted: TrustedProxies): Record<string, string> {
  const fields: Record<string, string> = {
    "http.request.method": req.method ?? "GET",
    "url.path": (req.url ?? "/").split("?", 1)[0] ?? "/",
  };
  const client = clientAddress(req.socket.remoteAddress, headerValue(req.headers["x-forwarded-for"]), trusted);
  if (client !== undefined) fields["client.address"] = client;
  const host = headerValue(req.headers.host);
  if (host !== undefined) {
    try { fields["server.address"] = new URL(`http://${host}`).hostname; } catch { /* malformed Host: leave it off */ }
  }
  const agent = headerValue(req.headers["user-agent"]);
  if (agent !== undefined) fields["user_agent.original"] = agent;
  return fields;
}

const headerValue = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value.join(", ") : value);
