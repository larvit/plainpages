import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
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

// Resolve a request path inside `dir`, or null if it escapes (traversal) or carries a
// control char (NUL etc.) — an explicit guard rather than relying on `stat` to throw.
export function resolveStaticPath(dir: string, requestedPath: string): string | null {
  if (/[\x00-\x1f]/.test(requestedPath)) return null;
  const filePath = join(dir, requestedPath);
  const rel = relative(dir, filePath);
  return rel.startsWith("..") || isAbsolute(rel) ? null : filePath;
}

export interface StaticRoute {
  dir: string;
  subPath: string;
}

// Route a `/public/<rest>` request to a base dir + sub-path: a leading segment naming a discovered
// plugin serves from plugins/<id>/public/, anything else from the core public/. Plugin ids are
// URL-safe (no %-encoding), so the raw segment compares directly to the id set; the sub-path is
// decoded and traversal-guarded after.
export function routePublic(restPath: string, publicDir: string, pluginsDir: string, pluginIds: Set<string>): StaticRoute {
  const slash = restPath.indexOf("/");
  const first = slash === -1 ? restPath : restPath.slice(0, slash);
  if (pluginIds.has(first)) {
    return { dir: join(pluginsDir, first, "public"), subPath: slash === -1 ? "" : restPath.slice(slash + 1) };
  }
  return { dir: publicDir, subPath: restPath };
}

// Caching: the host renders every /public/ href through assetHref, which appends `?v=<hash of the
// file's content>`. A request whose `v` is the current hash is cached for a year as immutable, so a
// repeat page view downloads no asset; a release changes the hash, and with it the URL. Any other
// request — an href a plugin's own markup emits, a stale `v` mid-deploy — is cached for five minutes,
// then revalidated against the ETag (that same hash) or Last-Modified.
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";

// Keyed on mtime and size, so a file edited in place (a dev bind mount) gets a new hash.
const hashes = new Map<string, { hash: string; mtimeMs: number; size: number }>();

function contentHash(filePath: string, info: Stats): string {
  const known = hashes.get(filePath);
  if (known?.mtimeMs === info.mtimeMs && known.size === info.size) return known.hash;
  const hash = createHash("sha256").update(readFileSync(filePath)).digest("base64url").slice(0, 16);
  hashes.set(filePath, { hash, mtimeMs: info.mtimeMs, size: info.size });
  return hash;
}

// Synchronous because EJS templates are: a view calls it mid-render. The stat per href is the
// price of picking up an edited file; the hash itself is read once per file version.
function versioned(href: string, route: StaticRoute): string {
  try {
    const filePath = resolveStaticPath(route.dir, decodeURIComponent(route.subPath));
    if (filePath === null) return href;
    const info = statSync(filePath);
    return info.isFile() ? `${href}?v=${contentHash(filePath, info)}` : href;
  } catch {
    return href; // malformed %-encoding or a missing file: the request answers 400/404 on its own
  }
}

// RFC 9110 §13.1.2, weak comparison: `W/"x"` matches `"x"`, and `*` matches any existing file.
function etagMatches(ifNoneMatch: string, etag: string): boolean {
  return ifNoneMatch.split(",").some((tag) => {
    const t = tag.trim();
    return t === "*" || t.replace(/^W\//, "") === etag;
  });
}

// RFC 9110 §13.2.2: If-None-Match, when present, decides alone; HTTP dates have whole seconds.
function notModified(req: IncomingMessage, etag: string, info: Stats): boolean {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch !== undefined) return etagMatches(ifNoneMatch, etag);
  const since = Date.parse(req.headers["if-modified-since"] ?? "");
  return !Number.isNaN(since) && Math.floor(info.mtimeMs / 1000) * 1000 <= since;
}

function plain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(body);
}

interface StaticRequest extends StaticRoute {
  version: string | null; // the request's `v` query parameter
}

async function serveStatic(route: StaticRequest, req: IncomingMessage, res: ServerResponse, onError: (err: Error) => void): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(route.subPath);
  } catch {
    return plain(res, 400, "Bad Request");
  }

  const filePath = resolveStaticPath(route.dir, decoded);
  if (filePath === null) return plain(res, 403, "Forbidden");

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return plain(res, 404, "Not Found");
    const hash = contentHash(filePath, info);
    const etag = `"${hash}"`;
    const validators = { "cache-control": route.version === hash ? IMMUTABLE : SHORT, etag, "last-modified": info.mtime.toUTCString() };
    if (notModified(req, etag, info)) return void res.writeHead(304, validators).end();
    res.writeHead(200, { ...validators, "content-length": info.size, "content-type": contentTypeFor(filePath) });
    if (req.method === "HEAD") return void res.end(); // headers only — skip opening the file
    // Headers are already sent, so a mid-stream read error can't become an HTTP status —
    // log and destroy the response to signal a truncated body, not a hung socket.
    createReadStream(filePath)
      .on("error", (err) => {
        onError(err);
        res.destroy();
      })
      .pipe(res);
  } catch {
    plain(res, 404, "Not Found");
  }
}

export interface PublicAssets {
  href: (href: string) => string; // a /public/ href with its version; any other href unchanged
  // onError handles a mid-stream read failure (headers already sent), e.g. with the request logger.
  serve: (url: URL, req: IncomingMessage, res: ServerResponse, onError: (err: Error) => void) => Promise<void>;
}

// The /public/ namespace both ways: the hrefs views render, and the requests those hrefs make.
export function publicAssets(publicDir: string, pluginsDir: string, pluginIds: Set<string>): PublicAssets {
  const route = (pathname: string): StaticRoute => routePublic(pathname.slice("/public/".length), publicDir, pluginsDir, pluginIds);
  return {
    href: (href) => (href.startsWith("/public/") && !/[?#]/.test(href) ? versioned(href, route(href)) : href),
    serve: (url, req, res, onError) => serveStatic({ ...route(url.pathname), version: url.searchParams.get("v") }, req, res, onError),
  };
}
