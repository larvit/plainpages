import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative } from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export function contentTypeFor(filePath: string): string {
  return contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// Resolves a request path inside `dir`, or null if it would escape (traversal) or
// carries a control char (NUL etc.) — rejecting those here makes the guard explicit
// rather than relying on a downstream `stat` to throw.
export function resolveStaticPath(dir: string, requestedPath: string): string | null {
  if (/[\x00-\x1f]/.test(requestedPath)) return null;
  const filePath = join(dir, requestedPath);
  const rel = relative(dir, filePath);
  return rel.startsWith("..") || isAbsolute(rel) ? null : filePath;
}

function plain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(body);
}

export async function serveStatic(dir: string, requestedPath: string, res: ServerResponse, head = false): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    return plain(res, 400, "Bad Request");
  }

  const filePath = resolveStaticPath(dir, decoded);
  if (filePath === null) return plain(res, 403, "Forbidden");

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return plain(res, 404, "Not Found");
    res.writeHead(200, { "content-length": info.size, "content-type": contentTypeFor(filePath) });
    if (head) return void res.end(); // headers only — skip opening the file
    // Headers are already sent, so a mid-stream read error can't become an HTTP error —
    // log it and destroy the response to signal a truncated body, not a hung socket.
    createReadStream(filePath)
      .on("error", (err) => {
        console.error(err);
        res.destroy();
      })
      .pipe(res);
  } catch {
    plain(res, 404, "Not Found");
  }
}
