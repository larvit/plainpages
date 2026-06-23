// Read an application/x-www-form-urlencoded request body. Our own POST forms are
// tiny, so cap the size and reject anything larger rather than buffer unbounded. Consumes the
// stream once; never throws on an empty body. The CSRF gate + admin forms read fields here.
import type { IncomingMessage } from "node:http";

const DEFAULT_LIMIT = 1024 * 1024; // 1 MiB

export async function readFormBody(req: IncomingMessage, options: { limit?: number } = {}): Promise<URLSearchParams> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error("request body exceeds limit");
    chunks.push(buf);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
