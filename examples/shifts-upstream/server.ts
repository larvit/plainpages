// Dev-only mock upstream for the reference plugin (examples/plugins/scheduling) — a stand-in for the
// customer's real backend, ready for when you copy the reference plugin into plugins/. NOT part
// of the app: stdlib only, in-memory (state resets on restart), no auth. Point PLUGIN_SETTING_SCHEDULING_UPSTREAM
// at your real service in production.
//
//   GET  /shifts  → 200 [ { id, title, assigneeId, assignee, start, end }, … ]   (?assigneeId=<id> → only theirs)
//   POST /shifts  → 201 { id, … }   (body: { title, assignee, assigneeId?, start, end })

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4000);

// `assigneeId` is the identity the rows are owned by — an opaque, stable subject id, which is what
// `ctx.user.id` carries. These are this demo's own people; a real backend joins on your IdP's ids.
const shifts = [
  { id: randomUUID(), title: "Morning — Front desk", assigneeId: "019bdc1a-3f27-7c41-9a6e-2b1d4f8e05a3", assignee: "Avery Kline", start: "2026-06-22 08:00", end: "2026-06-22 12:00" },
  { id: randomUUID(), title: "Afternoon — Support", assigneeId: "019bdc1a-4a83-7de2-8f05-6c93a71be4d8", assignee: "Blair Mora", start: "2026-06-22 12:00", end: "2026-06-22 17:00" },
  { id: randomUUID(), title: "Evening — On-call", assigneeId: "019bdc1a-5b6e-7a90-b3c7-84f01d2ea9b6", assignee: "Casey Nguyen", start: "2026-06-22 17:00", end: "2026-06-22 22:00" },
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
  if (url.pathname === "/shifts" && req.method === "GET") {
    const assigneeId = url.searchParams.get("assigneeId");
    if (assigneeId === null) return json(res, 200, shifts);
    return json(res, 200, shifts.filter((s) => s.assigneeId === assigneeId));
  }
  if (url.pathname === "/shifts" && req.method === "POST") {
    const b = await readBody(req);
    const shift = { id: randomUUID(), assignee: String(b.assignee ?? ""), assigneeId: String(b.assigneeId ?? ""), end: String(b.end ?? ""), start: String(b.start ?? ""), title: String(b.title ?? "") };
    shifts.push(shift);
    return json(res, 201, shift);
  }
  json(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`shifts-upstream listening on :${PORT}`));
