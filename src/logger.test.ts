import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger, requestLogger, SERVICE_NAME } from "./logger.ts";

// A capture pair so a test reads exactly what hit stdout/stderr without touching the console.
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { err, out, stderr: (m: string) => err.push(m), stdout: (m: string) => out.push(m) };
}

test("createLogger: tags service.name, routes by severity, gates on level, honours format", () => {
  const c = capture();
  const log = createLogger({ format: "json", level: "info", stderr: c.stderr, stdout: c.stdout });

  assert.equal(log.context["service.name"], SERVICE_NAME); // every line/record/span is attributed to the app
  log.info("hello", { n: 1 });
  log.warn("careful");
  log.debug("below the level"); // info level → debug is dropped

  assert.equal(c.out.length, 1); // info → stdout
  assert.equal(c.err.length, 1); // warn → stderr; debug suppressed entirely
  const rec = JSON.parse(c.out[0]!);
  assert.equal(rec["service.name"], SERVICE_NAME);
  assert.equal(rec.msg, "hello");
  assert.equal(rec.n, 1); // metadata kept native in JSON
});

test("createLogger: level none silences every severity", () => {
  const c = capture();
  const log = createLogger({ level: "none", stderr: c.stderr, stdout: c.stdout });
  log.error("nope");
  log.info("nope");
  assert.equal(c.out.length + c.err.length, 0);
});

test("createLogger: OTLP wired only when an endpoint is given", () => {
  assert.equal(createLogger({}).conf.otlpHttpBaseURI, undefined); // console-only by default
  const otlp = createLogger({ otlpEndpoint: "http://collector:4318", otlpProtocol: "http/protobuf" });
  assert.equal(otlp.conf.otlpHttpBaseURI, "http://collector:4318");
  assert.equal(otlp.conf.otlpProtocol, "http/protobuf");
});

test("createLogger: a set endpoint actually exports log records over OTLP/HTTP", async () => {
  const orig = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response("{}", { status: 200 });
  };
  try {
    const log = createLogger({ otlpEndpoint: "http://collector:4318", stderr: () => {}, stdout: () => {} });
    log.info("exported");
    await new Promise((r) => setTimeout(r, 50)); // export is fire-and-forget in the background
  } finally {
    globalThis.fetch = orig;
  }
  assert.ok(urls.some((u) => u === "http://collector:4318/v1/logs"), "POSTs the log record to /v1/logs");
});

test("requestLogger: merges service.name + requestId, inherits the parent's streams + format", () => {
  const c = capture();
  const app = createLogger({ format: "json", level: "info", stderr: c.stderr, stdout: c.stdout });
  const req = requestLogger(app, { requestId: "req-1" });

  assert.equal(req.context["service.name"], SERVICE_NAME);
  assert.equal(req.context["requestId"], "req-1");
  req.info("request", { status: 200 });
  const rec = JSON.parse(c.out[0]!); // inherited the parent's json stdout
  assert.equal(rec.requestId, "req-1");
  assert.equal(rec.status, 200);
});

test("requestLogger: each request is its own root trace; a valid upstream traceparent continues it", () => {
  const app = createLogger({ stderr: () => {}, stdout: () => {} });

  // No upstream header → two requests get two distinct fresh traces.
  const a = requestLogger(app, { requestId: "a" }).traceparent();
  const b = requestLogger(app, { requestId: "b" }).traceparent();
  assert.match(a, /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  assert.notEqual(a.split("-")[1], b.split("-")[1]); // different trace ids

  // A valid incoming traceparent is adopted: same trace id, fresh span id (distributed continuation).
  const upstream = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  const cont = requestLogger(app, { requestId: "c", traceparent: upstream }).traceparent();
  assert.equal(cont.split("-")[1], "0af7651916cd43dd8448eb211c80319c");
  assert.notEqual(cont.split("-")[2], "b7ad6b7169203331");
});

test("requestLogger: a malformed traceparent is ignored, not thrown (starts a fresh trace)", () => {
  const app = createLogger({ stderr: () => {}, stdout: () => {} });
  const tp = requestLogger(app, { requestId: "x", traceparent: "garbage" }).traceparent();
  assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
});
