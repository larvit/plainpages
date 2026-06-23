// Structured logging + basic observability, on @larvit/log (zero-dependency, OTLP-native).
// One app-level Log holds the config (level/format/OTLP) and tags every line with service.name;
// each request clones it into a short-lived trace span. Console always; OTLP only when configured.
// An AsyncLocalStorage makes that per-request Log ambiently available, so every outbound `fetch`
// (`tracedFetch`) and any deep module (`currentLog()`) joins the request's trace with no threading.
import { AsyncLocalStorage } from "node:async_hooks";
import { Log, type LogLevel } from "@larvit/log";

export { Log };
export type { LogLevel };

export const SERVICE_NAME = "plainpages"; // default OTLP resource attribute — what Loki/Tempo group logs+traces by

export interface LoggerOptions {
  format?: "json" | "text";
  level?: LogLevel | "none"; // @larvit/log's LogLevel omits "none"; LogConf accepts it to silence all
  otlpEndpoint?: string | undefined; // OTLP/HTTP collector base URI; unset ⇒ console-only
  otlpProtocol?: "http/json" | "http/protobuf";
  serviceName?: string; // OTLP service.name (SERVICE_NAME env); an implementer brands their own logs/traces
  stderr?: (msg: string) => void; // injectable so tests read output without the console
  stdout?: (msg: string) => void;
}

// The app-level logger: a Log tagged service.name so every console line, OTLP log record and span is
// attributed to the service. Level + format + name are explicit toggles (LOG_LEVEL/LOG_FORMAT/
// SERVICE_NAME — environment-agnostic, AGENTS.md §4). With otlpEndpoint set, logs + spans also export
// to that OTLP/HTTP collector (e.g. an OpenTelemetry Collector fronting Tempo/Loki); unset ⇒ console
// only, at zero export cost. Conditional spreads keep exactOptionalPropertyTypes happy (no `key: undefined`).
export function createLogger(opts: LoggerOptions = {}): Log {
  return new Log({
    context: { "service.name": opts.serviceName || SERVICE_NAME },
    format: opts.format ?? "text",
    logLevel: opts.level ?? "info",
    ...(opts.otlpEndpoint ? { otlpHttpBaseURI: opts.otlpEndpoint, otlpProtocol: opts.otlpProtocol ?? "http/json" } : {}),
    ...(opts.stderr ? { stderr: opts.stderr } : {}),
    ...(opts.stdout ? { stdout: opts.stdout } : {}),
  });
}

// The ambient per-request Log (see the header); set by runWithLog, read by currentLog/tracedFetch.
const requestStore = new AsyncLocalStorage<Log>();

// Run `fn` with `log` as the ambient request logger (app.ts wraps each request). currentLog() reads
// it back; returns undefined outside any request (boot, tests) so callers use `currentLog()?.info(…)`.
export function runWithLog<T>(log: Log, fn: () => T): T {
  return requestStore.run(log, fn);
}
export function currentLog(): Log | undefined {
  return requestStore.getStore();
}

// A drop-in `fetch` that traces through the active request log — a client span nested under the
// request span, with a W3C `traceparent` injected so the downstream service continues the same
// trace. Outside a request (no ambient log) or for a non-string/URL input it's a plain `fetch`.
// server.ts wires this (under the Ory timeout) into every Kratos/Keto/Hydra/JWKS call; a plugin
// uses it for its upstream calls (exported via plugin-api.ts). The trace-setup adds no throw of its
// own, but log.fetch throws synchronously if the request log has already ended (app.ts ends it only
// after the handler unwinds, so a live handler never hits that).
export const tracedFetch: typeof fetch = (input, init) => {
  const log = currentLog();
  if (log && (typeof input === "string" || input instanceof URL)) return log.fetch(input, init);
  return fetch(input, init);
};

// A per-request child logger holding a "request" trace span. `clone` (not parentLog) gives the
// request its own root trace — so requests aren't all nested under one app-lifetime span — while
// inheriting the parent's level/format/streams/OTLP. A valid upstream W3C `traceparent` is adopted
// (the span continues that distributed trace across a reverse proxy/gateway; malformed ⇒ ignored, a
// fresh trace starts). `requestId` tags every line + the span for log↔trace correlation. Flush with
// `end()` on response finish to export the span — a no-op when OTLP is off.
export function requestLogger(appLog: Log, opts: { requestId: string; traceparent?: string | undefined }): Log {
  return appLog.clone({
    context: { ...appLog.context, requestId: opts.requestId },
    spanName: "request",
    ...(opts.traceparent ? { traceparent: opts.traceparent } : {}),
  });
}
