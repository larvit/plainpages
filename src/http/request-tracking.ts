import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type Log, requestLogger, runWithLog } from "../logger.ts";
import { requestFields, type TrustedProxies } from "./request-fields.ts";

// Gives one request its own logger and span, runs `handle` under it, and writes the `request` line
// when the response closes. The handler adds `http.route` to the logger's context once routing has
// matched.
export function trackRequest(
  log: Log,
  trusted: TrustedProxies,
  req: IncomingMessage,
  res: ServerResponse,
  handle: (req: IncomingMessage, res: ServerResponse, reqLog: Log) => Promise<void>,
): void {
  const reqLog = requestLogger(log, {
    attributes: requestFields(req, trusted),
    requestId: randomUUID(),
    ...(typeof req.headers.traceparent === "string" ? { traceparent: req.headers.traceparent } : {}),
  });
  // end() must run exactly once, after BOTH the handler has unwound AND the response has closed.
  // Earlier would throw "already ended" from a still-running handler's ctx.log on a client abort,
  // or drop the access line on the happy path (the handler settles before close).
  let settled = false;
  let closed = false;
  const finalize = (): void => { if (settled && closed) void reqLog.end().catch(() => {}); };
  // "close" (not "finish") fires on both a completed response and a premature disconnect, so an
  // aborted request is still logged and its span flushed.
  res.on("close", () => {
    closed = true;
    try {
      // The context is what the span exports, so the status goes there.
      reqLog.context["http.response.status_code"] = res.statusCode;
      reqLog.info("request");
    } catch { /* never let logging crash a served request */ }
    finalize();
  });
  // Make reqLog ambient for the whole handler so all outbound fetch is traced. The .catch logs a
  // pathological escape via the app logger — not reqLog, which may be the thing that broke.
  void runWithLog(reqLog, () => handle(req, res, reqLog))
    .catch((err) => log.error("request handler escaped its try/catch", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) }))
    .finally(() => { settled = true; finalize(); });
}
