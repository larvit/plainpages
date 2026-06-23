// Same-origin gateway for the browser E2E. The themed login form posts straight to
// Kratos' flow action and Kratos sets the session cookie for its own base_url host — so for a real
// browser, web and Kratos must look like ONE origin (cookies are host-scoped). This tiny stdlib
// reverse proxy fronts both on a single host (the browser's only origin), exactly as a production
// reverse proxy would: Kratos-owned paths → kratos, everything else → web. NOT app code; dev/test only.
import { createServer, request } from "node:http";

const WEB = new URL(process.env.WEB_URL ?? "http://web:3000");
const KRATOS = new URL(process.env.KRATOS_URL ?? "http://kratos:4433");
const PORT = Number(process.env.PORT ?? 80);

// Kratos public owns these prefixes (self-service flows, sessions, its well-known/schemas); the
// browser hits them via the flow action + OIDC callbacks. Everything else is the web app.
const toKratos = (path) => ["/self-service", "/sessions", "/.well-known/ory", "/schemas"].some((p) => path === p || path.startsWith(`${p}/`));

createServer((req, res) => {
  const target = toKratos(req.url ?? "/") ? KRATOS : WEB;
  const upstream = request(
    { headers: req.headers, host: target.hostname, method: req.method, path: req.url, port: target.port },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
  );
  upstream.on("error", (err) => { res.writeHead(502, { "content-type": "text/plain" }).end(`gateway: ${err.message}`); });
  req.pipe(upstream);
}).listen(PORT, () => console.log(`e2e gateway on :${PORT} → web ${WEB.host} / kratos ${KRATOS.host}`));
