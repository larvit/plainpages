import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { buildContext } from "./context.ts";
import { buildDashboardModel } from "./dashboard.ts";
import { serveStatic } from "./static.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface AppOptions {
  // Cache compiled templates; caller decides (server passes config.cacheTemplates).
  // Off by default so edits show live; the app itself never inspects the environment.
  cache?: boolean;
  publicDir?: string;
  viewsDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const cache = options.cache ?? false;
  const publicDir = options.publicDir ?? join(rootDir, "public");
  const viewsDir = options.viewsDir ?? join(rootDir, "views");

  const render = (view: string, data: Record<string, unknown>): Promise<string> =>
    ejs.renderFile(join(viewsDir, `${view}.ejs`), data, { cache });

  const sendHtml = (res: ServerResponse, status: number, html: string): void => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };

  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
        return;
      }

      // The request shape handlers receive (§2/§4 router passes it on); routing
      // reuses its parsed URL instead of building a throwaway.
      const { url } = buildContext(req, res);
      const pathname = url.pathname;

      if (pathname.startsWith("/public/")) {
        await serveStatic(publicDir, pathname.slice("/public/".length), res, req.method === "HEAD");
        return;
      }

      if (pathname === "/") {
        // Mock data + no roles until the plugin host (§2) and auth (§4) land.
        sendHtml(res, 200, await render("index", { model: buildDashboardModel(url) }));
        return;
      }

      sendHtml(res, 404, await render("404", { title: "Not found" }));
    } catch (err) {
      console.error(err);
      if (res.headersSent) return void res.end(); // a partial body is already on the wire
      try {
        // Render before writing: if the 500 page itself throws, headers stay unsent
        // and we fall back to plain text below instead of a half-written response.
        sendHtml(res, 500, await render("500", { title: "Server error" }));
      } catch (renderErr) {
        console.error(renderErr);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Internal Server Error");
      }
    }
  });
}
