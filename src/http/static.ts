import { createHash, type Hash } from "node:crypto";
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
// URL-safe (no %-encoding), so the raw segment compares directly to the id set; the caller decodes
// and traversal-guards the sub-path.
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
// repeat page view downloads no asset; a changed file gets a new hash, and with it a new URL. Any other
// request — an href a plugin's own markup emits, a stale `v` mid-deploy — is cached for five minutes,
// then revalidated against the ETag (that same hash) or Last-Modified. A plugin has no way to version
// its own hrefs yet: `assetHref` is a reserved local but not contract, since offering it is a minor.
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";

// An entry holds while the file's mtime and size match, so a file edited in place (a dev bind mount)
// gets a new hash.
const hashes = new Map<string, { hash: string; mtimeMs: number; size: number }>();

function memoized(filePath: string, info: Stats): string | undefined {
  const known = hashes.get(filePath);
  return known?.mtimeMs === info.mtimeMs && known.size === info.size ? known.hash : undefined;
}

// The one definition of a version. Two readers feed it. A view renders synchronously, so hashFileSync
// reads the file whole; hashFile streams it, so a large file doesn't stall every other request.
function remember(filePath: string, info: Stats, sha256: Hash): string {
  const hash = sha256.digest("base64url").slice(0, 16);
  hashes.set(filePath, { hash, mtimeMs: info.mtimeMs, size: info.size });
  return hash;
}

function hashFileSync(filePath: string, info: Stats): string {
  return memoized(filePath, info) ?? remember(filePath, info, createHash("sha256").update(readFileSync(filePath)));
}

async function hashFile(filePath: string, info: Stats): Promise<string> {
  const known = memoized(filePath, info);
  if (known !== undefined) return known;
  const sha256 = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) sha256.update(chunk);
  return remember(filePath, info, sha256);
}

// Without `cache`, a stat per href picks up an edited file. With it, a known version skips the stat:
// an edit reaches the hrefs once a request for the file hashes it again.
function versioned(href: string, route: StaticRoute, cache: boolean): string {
  try {
    const filePath = resolveStaticPath(route.dir, decodeURIComponent(route.subPath));
    if (filePath === null) return href;
    const known = cache ? hashes.get(filePath) : undefined;
    if (known) return `${href}?v=${known.hash}`;
    const info = statSync(filePath);
    return info.isFile() ? `${href}?v=${hashFileSync(filePath, info)}` : href;
  } catch {
    return href; // malformed %-encoding, or a missing or unreadable file: serving it answers the error
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
    const hash = await hashFile(filePath, info);
    const etag = `"${hash}"`;
    const validators = { "cache-control": route.version === hash ? IMMUTABLE : SHORT, etag, "last-modified": info.mtime.toUTCString() };
    if (notModified(req, etag, info)) return void res.writeHead(304, validators).end();
    res.writeHead(200, { ...validators, "content-length": info.size, "content-type": contentTypeFor(filePath) });
    if (req.method === "HEAD") return void res.end();
    // Headers are already sent, so a mid-stream read error can't become an HTTP status —
    // log and destroy the response to signal a truncated body, not a hung socket.
    createReadStream(filePath)
      .on("error", (err) => {
        onError(err);
        res.destroy();
      })
      .pipe(res);
  } catch (err) {
    const { code } = err as NodeJS.ErrnoException;
    if (code === "ENOENT" || code === "ENOTDIR") return plain(res, 404, "Not Found");
    onError(err as Error);
    plain(res, 500, "Internal Server Error");
  }
}

export interface PublicAssets {
  href: (href: string) => string; // a /public/ href with its version; any other href unchanged
  // onError receives every failure to read a file except a missing one, which answers 404.
  serve: (url: URL, req: IncomingMessage, res: ServerResponse, onError: (err: Error) => void) => Promise<void>;
}

export function publicAssets(publicDir: string, pluginsDir: string, pluginIds: Set<string>, { cache }: { cache: boolean }): PublicAssets {
  const route = (pathname: string): StaticRoute => routePublic(pathname.slice("/public/".length), publicDir, pluginsDir, pluginIds);
  return {
    href: (href) => (href.startsWith("/public/") && !/[?#]/.test(href) ? versioned(href, route(href), cache) : href),
    serve: (url, req, res, onError) => serveStatic({ ...route(url.pathname), version: url.searchParams.get("v") }, req, res, onError),
  };
}
