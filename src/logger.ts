// Structured logging + basic observability (todo §9), on @larvit/log (zero-dependency, OTLP-native).
// One app-level Log holds the config (level/format/OTLP) and tags every line with service.name;
// each request clones it into a short-lived trace span. Console always; OTLP only when configured.
import { Log, type LogLevel } from "@larvit/log";

export { Log };
export type { LogLevel };

export const SERVICE_NAME = "plainpages"; // OTLP resource attribute — what Loki/Tempo group logs+traces by

export interface LoggerOptions {
  format?: "json" | "text";
  level?: LogLevel | "none"; // @larvit/log's LogLevel omits "none"; LogConf accepts it to silence all
  otlpEndpoint?: string | undefined; // OTLP/HTTP collector base URI; unset ⇒ console-only
  otlpProtocol?: "http/json" | "http/protobuf";
  stderr?: (msg: string) => void; // injectable so tests read output without the console
  stdout?: (msg: string) => void;
}

// The app-level logger: a Log tagged service.name so every console line, OTLP log record and span is
// attributed to "plainpages". Level + format are explicit toggles (LOG_LEVEL/LOG_FORMAT —
// environment-agnostic, AGENTS.md §4). With otlpEndpoint set, logs + spans also export to that
// OTLP/HTTP collector (e.g. an OpenTelemetry Collector fronting Tempo/Loki); unset ⇒ console only,
// at zero export cost. Conditional spreads keep exactOptionalPropertyTypes happy (no `key: undefined`).
export function createLogger(opts: LoggerOptions = {}): Log {
  return new Log({
    context: { "service.name": SERVICE_NAME },
    format: opts.format ?? "text",
    logLevel: opts.level ?? "info",
    ...(opts.otlpEndpoint ? { otlpHttpBaseURI: opts.otlpEndpoint, otlpProtocol: opts.otlpProtocol ?? "http/json" } : {}),
    ...(opts.stderr ? { stderr: opts.stderr } : {}),
    ...(opts.stdout ? { stdout: opts.stdout } : {}),
  });
}

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
