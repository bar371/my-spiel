// Tiny stand-in for the Firebase Realtime Database REST API (GET / PUT / event
// stream) used by tests/sync-e2e.js. Like Firebase, it drops nulls and empty objects.
const http = require("http");

function prune(v) {
  if (Array.isArray(v)) { const a = v.map(prune).filter(x => x !== null); return a.length ? a : null; }
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p !== null) o[k] = p; }
    return Object.keys(o).length ? o : null;
  }
  return v === undefined ? null : v;
}

module.exports = function startMock(port) {
  let root = null;
  const streams = new Set();
  const get = parts => parts.reduce((n, k) => (n && typeof n === "object" ? n[k] ?? null : null), root);
  function set(parts, value) {
    value = prune(value);
    if (!parts.length) { root = value; return; }
    root = root && typeof root === "object" ? root : {};
    let n = root;
    parts.slice(0, -1).forEach(k => { if (!n[k] || typeof n[k] !== "object") n[k] = {}; n = n[k]; });
    if (value === null) delete n[parts.at(-1)]; else n[parts.at(-1)] = value;
    root = prune(root);
  }
  const send = (res, path, data) => res.write(`event: put\ndata: ${JSON.stringify({ path, data })}\n\n`);

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") return res.end();
    const url = new URL(req.url, "http://x");
    if (!url.pathname.endsWith(".json")) { res.statusCode = 404; return res.end(); }
    const parts = url.pathname.slice(0, -5).split("/").filter(Boolean).map(decodeURIComponent);
    if (req.method === "GET" && (req.headers.accept || "").includes("text/event-stream")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const s = { res, parts };
      streams.add(s);
      send(res, "/", get(parts));
      req.on("close", () => streams.delete(s));
      return;
    }
    if (req.method === "GET") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(get(parts))); }
    if (req.method === "PUT") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let value; try { value = JSON.parse(body); } catch (_) { res.statusCode = 400; return res.end(); }
        set(parts, value);
        for (const s of streams) {
          const sp = s.parts;
          if (sp.every((k, i) => parts[i] === k)) send(s.res, "/" + parts.slice(sp.length).join("/"), get(parts));
          else if (parts.every((k, i) => sp[i] === k)) send(s.res, "/", get(sp));
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(get(parts)));
      });
      return;
    }
    res.statusCode = 405; res.end();
  });
  return new Promise(r => server.listen(port, () => r({ server, dump: () => root, close: () => { streams.forEach(s => s.res.end()); server.close(); } })));
};
