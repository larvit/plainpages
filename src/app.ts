import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { serveStatic } from "./static.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface AppOptions {
  publicDir?: string;
  viewsDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const publicDir = options.publicDir ?? join(rootDir, "public");
  const viewsDir = options.viewsDir ?? join(rootDir, "views");

  const render = (view: string, data: Record<string, unknown>): Promise<string> =>
    ejs.renderFile(join(viewsDir, `${view}.ejs`), data);

  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
        return;
      }

      const { pathname } = new URL(req.url ?? "/", "http://localhost");

      if (pathname.startsWith("/public/")) {
        await serveStatic(publicDir, pathname.slice("/public/".length), res);
        return;
      }

      if (pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await render("index", { title: "Plainpages" }));
        return;
      }

      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(await render("404", { title: "Not found" }));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    }
  });
}
