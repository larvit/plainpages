// Dev-only mock upstream for the reference plugin (examples/scheduling-plugin) — a stand-in for the
// customer's real backend, ready for when you copy the reference plugin into plugins/. NOT part
// of the app: stdlib only, in-memory (state resets on restart), no auth. Point SCHEDULING_UPSTREAM
// at your real service in production.
//
//   GET  /shifts  → 200 [ { id, title, assignee, start, end }, … ]
//   POST /shifts  → 201 { id, … }   (body: { title, assignee, start, end })

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4000);

const shifts = [
  { id: randomUUID(), title: "Morning — Front desk", assignee: "Avery Kline", start: "2026-06-22 08:00", end: "2026-06-22 12:00" },
  { id: randomUUID(), title: "Afternoon — Support", assignee: "Blair Mora", start: "2026-06-22 12:00", end: "2026-06-22 17:00" },
  { id: randomUUID(), title: "Evening — On-call", assignee: "Casey Nguyen", start: "2026-06-22 17:00", end: "2026-06-22 22:00" },
];

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/shifts" && req.method === "GET") return json(res, 200, shifts);
  if (url.pathname === "/shifts" && req.method === "POST") {
    const b = await readBody(req);
    const shift = { id: randomUUID(), assignee: String(b.assignee ?? ""), end: String(b.end ?? ""), start: String(b.start ?? ""), title: String(b.title ?? "") };
    shifts.push(shift);
    return json(res, 201, shift);
  }
  json(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`shifts-upstream listening on :${PORT}`));
